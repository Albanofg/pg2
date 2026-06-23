import "server-only";
import { EvidenceLedger, SharedConsciousness } from "@/lib/modules/shared";
import { hasCheckpoint, sealCheckpoint } from "@/lib/modules/shared/checkpoint";
import type { ConceptObject } from "@/lib/modules/shared";
import {
  runDifferentiationFormalizer,
  runDisclosureCompiler,
  runGapFramer,
  runPohcScorer,
  runVerifier,
  type DisclosureResult,
  type PohcResult,
} from "./agents";
import { DIFFERENTIATION_HUMAN_SOURCE_TYPES, DISCLOSURE_SECTION_ORDER } from "./types";
import type {
  Certification,
  CertificationInput,
  ConceptLandscape,
  DifferentiatedConcept,
  DifferentiationDeps,
  InventionDisclosure,
  KeyConceptInput,
  Module4Card,
  Module4Phase,
  Module4View,
  NoveltyInput,
  ReviewActionInput,
} from "./types";

type PohcFactor = "conception" | "quality" | "known_concepts";

/** The fresh-ask the inventor sees when a PoHC factor is genuinely uncovered. */
const FACTOR_QUESTIONS: Record<PohcFactor, string> = {
  conception:
    "In your own words, how did you arrive at this — the moment or reasoning that led you to it?",
  quality:
    "What's the specific technical choice here that's yours — beyond what an assistant could merely organize?",
  known_concepts:
    "How does this go beyond what already existed — what can it do that the prior approaches could not?",
};

/**
 * Module 4 — the Differentiation flow engine (Slice A).
 *
 * Per Concept, one at a time (the heavy moment, paced): the Gap Framer lays out
 * what the art covers + the Concept's mechanism + where input is needed (facts
 * only); the inventor states what is genuinely NEW in their own words (verbatim,
 * inventor_conceived); the Formalizer cleans it into differentiation text the
 * inventor approves; a different agent (the Verifier) cross-checks it. Once every
 * Concept has differentiation, the inventor anchors which become Key Concepts.
 */

type Intent =
  | { kind: "novelty"; conceptId: string }
  | { kind: "differentiation"; conceptId: string; novelty: string }
  | { kind: "key_concept"; conceptId: string }
  | { kind: "certification"; conceptId: string; factor: PohcFactor };

export type DifferentiationSnapshot = {
  phase: Module4Phase;
  started: boolean;
  concepts: DifferentiatedConcept[];
  disclosure: InventionDisclosure | null;
  openCards: Module4Card[];
  intents: [string, Intent][];
  ledger: import("@/lib/modules/shared").LedgerEntry[];
};

export class DifferentiationModule {
  private readonly runAgent;
  private readonly now: () => string;
  private readonly genId: () => string;
  private readonly ledger: EvidenceLedger;
  private readonly consciousness: SharedConsciousness;

  private phase: Module4Phase = "framing";
  private started = false;
  private concepts = new Map<string, DifferentiatedConcept>();
  private disclosure: InventionDisclosure | null = null;
  private openCards = new Map<string, Module4Card>();
  private intents = new Map<string, Intent>();

  constructor(deps: DifferentiationDeps) {
    this.runAgent = deps.runAgent;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.genId = deps.genId ?? defaultGenId;
    this.ledger =
      deps.ledger ??
      new EvidenceLedger(DIFFERENTIATION_HUMAN_SOURCE_TYPES, this.now, this.genId);
    this.consciousness =
      deps.consciousness ?? new SharedConsciousness(this.now, this.genId);

    const byId = new Map<string, ConceptLandscape>(
      deps.landscape.map((l) => [l.conceptId, l]),
    );
    for (const c of deps.concepts) {
      if (c.status.state !== "active") continue;
      this.concepts.set(c.id, {
        ...cloneConcept(c),
        landscape: byId.get(c.id) ?? { conceptId: c.id, territory: "open", sources: [] },
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  async start(): Promise<Module4View> {
    if (this.started) return this.view();
    this.started = true;
    this.phase = "capturing";
    this.ledger.recordMachineEvent("differentiation_started", ["module4"], {
      conceptCount: this.concepts.size,
    });
    await this.frameNext();
    return this.view();
  }

  async act(
    cardId: string,
    input: NoveltyInput | ReviewActionInput | KeyConceptInput | CertificationInput,
  ): Promise<Module4View> {
    const card = this.openCards.get(cardId);
    const intent = this.intents.get(cardId);
    if (!card || !intent) return this.view();

    switch (card.type) {
      case "novelty_capture":
        await this.handleNovelty(cardId, intent, input as NoveltyInput);
        break;
      case "differentiation_review":
        await this.handleDifferentiation(cardId, intent, input as ReviewActionInput);
        break;
      case "key_concept":
        await this.handleKeyConcept(cardId, intent, input as KeyConceptInput);
        break;
      case "certification":
        await this.handleCertification(cardId, intent, input as CertificationInput);
        break;
    }
    this.maybeCheckpoint();
    return this.view();
  }

  /** The inventor types to the Helper — captured as a verbatim note. */
  async tell(text: string): Promise<Module4View> {
    const t = text.trim();
    if (t) this.ledger.recordInventorSource("inventor_note", t, ["differentiation", "note"]);
    return this.view();
  }

  view(): Module4View {
    return {
      phase: this.phase,
      cards: [...this.openCards.values()],
      concepts: [...this.concepts.values()].map(cloneDiff),
      ...(this.disclosure ? { disclosure: cloneDisclosure(this.disclosure) } : {}),
      ledger: this.ledger.serialize(),
      complete: this.isComplete(),
    };
  }

  /** The deliverable: the differentiated Key Concepts (anchors of the disclosure). */
  finish(): DifferentiatedConcept[] {
    return [...this.concepts.values()].filter((c) => c.isKeyConcept).map(cloneDiff);
  }

  /** The compiled Invention Disclosure, for handoff to Showcase. */
  getDisclosure(): InventionDisclosure | null {
    return this.disclosure ? cloneDisclosure(this.disclosure) : null;
  }

  ledgerEntries() {
    return this.ledger.serialize();
  }

  consciousnessInstance(): SharedConsciousness {
    return this.consciousness;
  }

  /* ------------------------------------------------------------------ *
   * Flow
   * ------------------------------------------------------------------ */

  /** Frame the next Concept that still needs the inventor's novelty call. */
  private async frameNext(): Promise<void> {
    const next = [...this.concepts.values()].find(
      (c) => c.status.state === "active" && !c.novelty && !c.differentiation_statement,
    );
    if (!next) {
      this.moveToAnchoring();
      return;
    }
    const verbatim = next.conception_trail.map((t) => t.verbatim_text);
    try {
      const framed = await runGapFramer(this.runAgent, {
        statement: next.formalized_statement,
        verbatim,
        landscape: next.landscape,
        consciousness: this.consciousness.renderForAgent({ part: `concept:${next.id}` }),
      });
      next.gap = {
        artSummary: framed.art_summary,
        mechanism: framed.mechanism,
        openPoints: framed.open_points,
      };
      this.ledger.recordMachineEvent("agent_framed_gap", ["differentiation"], {
        conceptId: next.id,
      });
    } catch (err) {
      console.error("[differentiation] gap-framer failed for", next.id, err);
      next.gap = {
        artSummary: "(couldn't summarize the prior art — proceed from your own view)",
        mechanism: next.formalized_statement,
        openPoints: ["What does your concept do that the closest prior art does not?"],
      };
    }
    this.emitGap(next);
    this.emitNoveltyCapture(next);
  }

  private async handleNovelty(cardId: string, intent: Intent, input: NoveltyInput): Promise<void> {
    if (intent.kind !== "novelty") return;
    const concept = this.concepts.get(intent.conceptId);
    this.resolveCard(cardId);
    const statement = input.statement.trim();
    if (!concept || !statement) return;

    // VERBATIM FIRST — the inventor's own statement of what's new (inventor_conceived).
    const e = this.ledger.recordInventorSource("novelty_statement", statement, [
      "differentiation",
      "inventor_conceived",
    ]);
    concept.novelty = { verbatim: statement, ledgerId: e.id };
    concept.conception_trail.push({
      ledgerId: e.id,
      verbatim_text: statement,
      timestamp: e.timestamp,
    });
    await this.formalizeDifferentiation(concept, statement);
  }

  /** Run the formalizer on the inventor's novelty, then a Differentiation-review card. */
  private async formalizeDifferentiation(concept: DifferentiatedConcept, novelty: string): Promise<void> {
    let text = novelty;
    try {
      const f = await runDifferentiationFormalizer(this.runAgent, {
        novelty,
        statement: concept.formalized_statement,
        artSummary: concept.gap?.artSummary ?? "",
        consciousness: this.consciousness.renderForAgent({ part: `concept:${concept.id}` }),
      });
      if (f.differentiation_statement?.trim()) text = f.differentiation_statement;
      this.ledger.recordMachineEvent("agent_formalized", ["differentiation"], {
        conceptId: concept.id,
        additions: f.added_substance.length,
      });
    } catch (err) {
      console.error("[differentiation] formalizer failed for", concept.id, err);
    }
    const id = this.genId();
    this.openCards.set(id, {
      id,
      type: "differentiation_review",
      conceptId: concept.id,
      body: text,
      actions: ["approve", "discard", "request_edit"],
    });
    this.intents.set(id, { kind: "differentiation", conceptId: concept.id, novelty });
  }

  private async handleDifferentiation(cardId: string, intent: Intent, input: ReviewActionInput): Promise<void> {
    if (intent.kind !== "differentiation") return;
    const concept = this.concepts.get(intent.conceptId);
    if (!concept) {
      this.resolveCard(cardId);
      return;
    }
    this.ledger.recordDecision("differentiation_action", ["differentiation", input.action], {
      conceptId: concept.id,
    });

    if (input.action === "approve") {
      const card = this.openCards.get(cardId);
      const body = card && card.type === "differentiation_review" ? card.body : intent.novelty;
      concept.differentiation_statement = body;
      concept.provenance.push({
        excerpt: body,
        provenance: "system_formalized",
        derivedFrom: [concept.novelty?.ledgerId].filter(Boolean) as string[],
      });
      this.resolveCard(cardId);
      await this.recordDifferentiationToConsciousness(concept);
      await this.frameNext();
    } else if (input.action === "discard") {
      concept.status = { state: "dropped" };
      this.resolveCard(cardId);
      await this.frameNext();
    } else {
      // request_edit — the inventor's correction IS their words; re-formalize from it.
      const correction = input.correction.trim();
      this.resolveCard(cardId);
      if (!correction) return;
      const e = this.ledger.recordInventorSource("inventor_edit", correction, [
        "differentiation",
        "correction",
      ]);
      concept.novelty = { verbatim: correction, ledgerId: e.id };
      concept.conception_trail.push({
        ledgerId: e.id,
        verbatim_text: correction,
        timestamp: e.timestamp,
      });
      await this.formalizeDifferentiation(concept, correction);
    }
  }

  private moveToAnchoring(): void {
    this.phase = "anchoring";
    for (const c of this.concepts.values()) {
      if (c.status.state !== "active" || !c.differentiation_statement) continue;
      const id = this.genId();
      this.openCards.set(id, {
        id,
        type: "key_concept",
        conceptId: c.id,
        statement: c.differentiation_statement,
        actions: ["anchor", "drop"],
      });
      this.intents.set(id, { kind: "key_concept", conceptId: c.id });
    }
    if (![...this.openCards.values()].some((c) => c.type === "key_concept")) {
      this.phase = "complete";
    }
  }

  private async handleKeyConcept(cardId: string, intent: Intent, input: KeyConceptInput): Promise<void> {
    if (intent.kind !== "key_concept") return;
    const concept = this.concepts.get(intent.conceptId);
    if (concept) {
      concept.isKeyConcept = input.action === "anchor";
      this.ledger.recordDecision("key_concept_action", ["differentiation", input.action], {
        conceptId: concept.id,
      });
      if (input.action === "anchor") {
        this.ledger.recordMachineEvent("key_concept_anchored", ["differentiation"], {
          conceptId: concept.id,
        });
      }
    }
    this.resolveCard(cardId);
    const anchoringLeft = [...this.openCards.values()].some((c) => c.type === "key_concept");
    if (!anchoringLeft && this.hasAnchor()) {
      await this.compileDisclosure();
    }
  }

  /** Compile the nine-section Invention Disclosure from the anchored Key Concepts. */
  private async compileDisclosure(): Promise<void> {
    this.phase = "compiling";
    const keyConcepts = [...this.concepts.values()].filter((c) => c.isKeyConcept);
    try {
      const out = await runDisclosureCompiler(this.runAgent, {
        keyConcepts: keyConcepts.map((c) => ({
          title: c.title,
          statement: c.formalized_statement,
          differentiation: c.differentiation_statement ?? "",
        })),
        verbatim: keyConcepts.flatMap((c) => c.conception_trail.map((t) => t.verbatim_text)),
        artSummary: keyConcepts
          .map((c) => c.gap?.artSummary)
          .filter(Boolean)
          .join("\n\n"),
        consciousness: this.consciousness.renderForAgent(),
      });
      this.disclosure = toDisclosure(out);
      this.ledger.recordMachineEvent("disclosure_compiled", ["differentiation"], {
        sections: this.disclosure.sections.length,
      });
      await this.recordDisclosureToConsciousness();
    } catch (err) {
      console.error("[differentiation] disclosure compile failed", err);
    }
    await this.moveToCertifying();
  }

  /* ------------------------------------------------------------------ *
   * Certify inventorship (Proof of Human Conception)
   * ------------------------------------------------------------------ */

  /** Score every Key Concept's PoHC factors from the ambient capture. */
  private async moveToCertifying(): Promise<void> {
    this.phase = "certifying";
    const keyConcepts = [...this.concepts.values()].filter((c) => c.isKeyConcept);
    for (const c of keyConcepts) await this.certifyOne(c);
    this.checkCertificationComplete();
  }

  /**
   * Assemble + score one Key Concept's certification from the inventor's recorded
   * words. Engagement-presumption means authored novelty usually certifies it
   * straight away; a genuinely-uncovered factor gets a single fresh ask.
   */
  private async certifyOne(concept: DifferentiatedConcept): Promise<void> {
    const verbatim = concept.conception_trail.map((t) => t.verbatim_text);
    const wasCertified = concept.certification?.status === "certified";
    let factors: PohcResult;
    try {
      factors = await runPohcScorer(this.runAgent, {
        title: concept.title,
        statement: concept.formalized_statement,
        differentiation: concept.differentiation_statement ?? "",
        verbatim,
      });
    } catch (err) {
      console.error("[differentiation] pohc-scorer failed for", concept.id, err);
      return;
    }
    const confidence =
      0.33 * factors.conception.score +
      0.33 * factors.quality.score +
      0.34 * factors.known_concepts.score;
    const status = statusFor(confidence);
    concept.certification = {
      conceptId: concept.id,
      conception: factors.conception,
      quality: factors.quality,
      known_concepts: factors.known_concepts,
      confidence,
      status,
    };

    if (status === "certified") {
      if (!wasCertified) {
        this.ledger.recordMachineEvent("inventorship_certified", ["differentiation"], {
          conceptId: concept.id,
          confidence,
          conception: factors.conception.record,
          quality: factors.quality.record,
          known_concepts: factors.known_concepts.record,
        });
      }
      return;
    }
    // Not certified — ask the inventor about the weakest factor, in their words.
    const ranked = (["conception", "quality", "known_concepts"] as PohcFactor[]).sort(
      (a, b) => factors[a].score - factors[b].score,
    );
    const factor = ranked.find((f) => factors[f].weak) ?? ranked[0];
    this.emitCertificationCard(concept, factor);
  }

  private emitCertificationCard(concept: DifferentiatedConcept, factor: PohcFactor): void {
    const already = [...this.intents.values()].some(
      (i) => i.kind === "certification" && i.conceptId === concept.id,
    );
    if (already) return;
    const id = this.genId();
    this.openCards.set(id, {
      id,
      type: "certification",
      conceptId: concept.id,
      title: concept.title,
      factor,
      question: FACTOR_QUESTIONS[factor],
    });
    this.intents.set(id, { kind: "certification", conceptId: concept.id, factor });
  }

  private async handleCertification(cardId: string, intent: Intent, input: CertificationInput): Promise<void> {
    if (intent.kind !== "certification") return;
    const concept = this.concepts.get(intent.conceptId);
    this.resolveCard(cardId);
    const answer = input.answer.trim();
    if (!concept || !answer) return;
    // VERBATIM — the inventor's own words for the uncovered factor (inventor_conceived).
    const e = this.ledger.recordInventorSource("certification_answer", answer, [
      "differentiation",
      intent.factor,
      "inventor_conceived",
    ]);
    concept.conception_trail.push({
      ledgerId: e.id,
      verbatim_text: answer,
      timestamp: e.timestamp,
    });
    await this.certifyOne(concept);
    this.checkCertificationComplete();
  }

  private checkCertificationComplete(): void {
    const open = [...this.openCards.values()].some((c) => c.type === "certification");
    const keyConcepts = [...this.concepts.values()].filter((c) => c.isKeyConcept);
    const allCertified =
      keyConcepts.length > 0 &&
      keyConcepts.every((c) => c.certification?.status === "certified");
    if (!open && allCertified) {
      this.phase = "complete";
      this.ledger.recordMachineEvent("module_completed", ["module4"], {
        keyConcepts: keyConcepts.length,
      });
    }
  }

  /** Record the compiled disclosure to the Shared Consciousness + cross-verify it. */
  private async recordDisclosureToConsciousness(): Promise<void> {
    if (!this.disclosure) return;
    const keyConcepts = [...this.concepts.values()].filter((c) => c.isKeyConcept);
    const body = this.disclosure.sections.map((s) => `## ${s.label}\n${s.body}`).join("\n\n");
    const derivedFrom = keyConcepts
      .map((c) => this.consciousness.current(`differentiation:${c.id}`)?.id)
      .filter(Boolean) as string[];
    const entry = this.consciousness.record({
      part: "disclosure",
      content: body,
      why: "the Invention Disclosure compiled from the owned Key Concepts",
      agent: "disclosure-compiler",
      derivedFrom,
    });
    try {
      const verdict = await runVerifier(this.runAgent, {
        piece: body,
        inventorMaterial: keyConcepts
          .flatMap((c) => c.conception_trail.map((t) => t.verbatim_text))
          .join("\n"),
        consciousness: this.consciousness.renderForAgent({ part: "disclosure" }),
      });
      this.consciousness.verify(entry.id, {
        by: "verifier",
        verdict: verdict.verdict,
        ...(verdict.note ? { note: verdict.note } : {}),
      });
    } catch (err) {
      console.error("[differentiation] disclosure verify failed", err);
    }
  }

  /** Record the approved differentiation to the Shared Consciousness + cross-verify. */
  private async recordDifferentiationToConsciousness(concept: DifferentiatedConcept): Promise<void> {
    if (!concept.differentiation_statement?.trim()) return;
    const conceptEntry = this.consciousness.current(`concept:${concept.id}`);
    const entry = this.consciousness.record({
      part: `differentiation:${concept.id}`,
      content: concept.differentiation_statement,
      why: `what concept "${concept.title}" does that the prior art does not`,
      agent: "differentiation-formalizer",
      derivedFrom: conceptEntry ? [conceptEntry.id] : [],
      tracesTo: [concept.novelty?.ledgerId].filter(Boolean) as string[],
    });
    try {
      const verdict = await runVerifier(this.runAgent, {
        piece: concept.differentiation_statement,
        inventorMaterial: concept.novelty?.verbatim ?? "",
        consciousness: this.consciousness.renderForAgent({ part: `differentiation:${concept.id}` }),
      });
      this.consciousness.verify(entry.id, {
        by: "verifier",
        verdict: verdict.verdict,
        ...(verdict.note ? { note: verdict.note } : {}),
      });
    } catch (err) {
      console.error("[differentiation] verifier failed for", concept.id, err);
    }
  }

  private maybeCheckpoint(): void {
    if (this.isComplete() && !hasCheckpoint(this.ledger, "module4")) {
      sealCheckpoint(this.ledger, "module4");
    }
  }

  private hasAnchor(): boolean {
    return [...this.concepts.values()].some((c) => c.isKeyConcept);
  }

  private isComplete(): boolean {
    const keyConcepts = [...this.concepts.values()].filter((c) => c.isKeyConcept);
    return (
      this.phase === "complete" &&
      keyConcepts.length > 0 &&
      this.disclosure !== null &&
      keyConcepts.every((c) => c.certification?.status === "certified")
    );
  }

  /* ------------------------------------------------------------------ *
   * Card emitters
   * ------------------------------------------------------------------ */

  private emitGap(concept: DifferentiatedConcept): void {
    const id = this.genId();
    this.openCards.set(id, {
      id,
      type: "gap",
      conceptId: concept.id,
      title: concept.title,
      artSummary: concept.gap?.artSummary ?? "",
      mechanism: concept.gap?.mechanism ?? "",
      openPoints: concept.gap?.openPoints ?? [],
    });
    // The gap card is read-only context; it carries no intent/action.
  }

  private emitNoveltyCapture(concept: DifferentiatedConcept): void {
    const id = this.genId();
    const points = concept.gap?.openPoints ?? [];
    this.openCards.set(id, {
      id,
      type: "novelty_capture",
      conceptId: concept.id,
      title: concept.title,
      context: points.length
        ? `Against the closest art, only you can say what's genuinely new here:\n- ${points.join("\n- ")}`
        : "In your own words, what does this concept do that the closest prior art does not?",
    });
    this.intents.set(id, { kind: "novelty", conceptId: concept.id });
  }

  private resolveCard(cardId: string): void {
    this.openCards.delete(cardId);
    this.intents.delete(cardId);
  }

  /* ------------------------------------------------------------------ *
   * Persistence
   * ------------------------------------------------------------------ */

  toSnapshot(): DifferentiationSnapshot {
    return {
      phase: this.phase,
      started: this.started,
      concepts: [...this.concepts.values()].map(cloneDiff),
      disclosure: this.disclosure ? cloneDisclosure(this.disclosure) : null,
      openCards: [...this.openCards.values()],
      intents: [...this.intents.entries()],
      ledger: this.ledger.serialize(),
    };
  }

  static fromSnapshot(snap: DifferentiationSnapshot, deps: DifferentiationDeps): DifferentiationModule {
    const now = deps.now ?? (() => new Date().toISOString());
    const genId = deps.genId ?? defaultGenId;
    const ledger = EvidenceLedger.fromEntries(
      snap.ledger,
      DIFFERENTIATION_HUMAN_SOURCE_TYPES,
      now,
      genId,
    );
    const m = new DifferentiationModule({ ...deps, concepts: [], landscape: [], ledger });
    m.phase = snap.phase;
    m.started = snap.started;
    m.concepts = new Map(snap.concepts.map((c) => [c.id, cloneDiff(c)]));
    m.disclosure = snap.disclosure ? cloneDisclosure(snap.disclosure) : null;
    m.openCards = new Map(snap.openCards.map((c) => [c.id, c]));
    m.intents = new Map(snap.intents);
    return m;
  }
}

/** Map the compiler's nine fields into ordered, non-empty disclosure sections. */
function toDisclosure(out: DisclosureResult): InventionDisclosure {
  const r = out as unknown as Record<string, string>;
  return {
    sections: DISCLOSURE_SECTION_ORDER.map(({ key, label }) => ({
      key,
      label,
      body: (r[key] ?? "").trim(),
    })).filter((s) => s.body),
  };
}

function cloneDisclosure(d: InventionDisclosure): InventionDisclosure {
  return { sections: d.sections.map((s) => ({ ...s })) };
}

/* ------------------------------------------------------------------ */

function cloneConcept(c: ConceptObject): ConceptObject {
  return {
    ...c,
    conception_trail: c.conception_trail.map((t) => ({ ...t })),
    provenance: c.provenance.map((p) => ({ ...p, derivedFrom: [...p.derivedFrom] })),
    status: { ...c.status },
  };
}

function cloneDiff(c: DifferentiatedConcept): DifferentiatedConcept {
  return {
    ...cloneConcept(c),
    landscape: {
      ...c.landscape,
      sources: c.landscape.sources.map((s) => ({ ...s })),
    },
    ...(c.gap ? { gap: { ...c.gap, openPoints: [...c.gap.openPoints] } } : {}),
    ...(c.novelty ? { novelty: { ...c.novelty } } : {}),
    ...(c.certification
      ? {
          certification: {
            ...c.certification,
            conception: { ...c.certification.conception },
            quality: { ...c.certification.quality },
            known_concepts: { ...c.certification.known_concepts },
          },
        }
      : {}),
  };
}

/** Map PoHC confidence to a certification status. */
function statusFor(confidence: number): Certification["status"] {
  if (confidence > 0.6) return "certified";
  if (confidence >= 0.4) return "needs_clarification";
  return "rejected";
}

function defaultGenId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `d_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}
