import "server-only";
import { EvidenceLedger, SharedConsciousness } from "@/lib/modules/shared";
import { hasCheckpoint, sealCheckpoint } from "@/lib/modules/shared/checkpoint";
import {
  runAbstractRewriter,
  runBackgroundExtender,
  runDetailDescriptionExtender,
  runGenusExtractor,
  runHelper,
  runKeyConceptAppender,
  runKeyConceptBroadener,
  runSpeciesSynthesizer,
  runSummaryExtender,
  runVerifier,
  type ConceptAspect,
} from "./agents";
import { SHOWCASE_HUMAN_SOURCE_TYPES } from "./types";
import type {
  ChoiceInput,
  DisclosureSection,
  Genus,
  HelperTurn,
  Module5Card,
  Module5Phase,
  Module5View,
  ShowcaseDeps,
  ShowcaseKeyConcept,
  Species,
  SpeciesType,
  VariationInput,
  WidenedActionInput,
} from "./types";

/**
 * Module 5 — the Showcase flow engine (broadening slice; figures deferred).
 *
 * Broadening is optional and gated. Choose to broaden → extract a paradigm-neutral
 * genus → synthesize alternative species → keep which variations (Gate 1) →
 * broaden each Key Concept to cover them, meaning-preserving (Gate 2). The
 * verifier is the Boundary's guard at both gates: anything that would invent new
 * substance is withheld, never surfaced.
 */

const SPECIES_TYPES: SpeciesType[] = ["ai_assisted", "ai_native", "agentic"];

type Intent =
  | { kind: "choice" }
  | { kind: "variation"; speciesType: SpeciesType }
  | { kind: "widened"; conceptId: string };

export type ShowcaseSnapshot = {
  phase: Module5Phase;
  started: boolean;
  keyConcepts: ShowcaseKeyConcept[];
  genus: Genus | null;
  species: Species[];
  broadened: boolean;
  disclosure: DisclosureSection[] | null;
  openCards: Module5Card[];
  intents: [string, Intent][];
  conversation: HelperTurn[];
  ledger: import("@/lib/modules/shared").LedgerEntry[];
};

export class ShowcaseModule {
  private readonly runAgent;
  private readonly now: () => string;
  private readonly genId: () => string;
  private readonly ledger: EvidenceLedger;
  private readonly consciousness: SharedConsciousness;

  private phase: Module5Phase = "choosing";
  private started = false;
  private keyConcepts = new Map<string, ShowcaseKeyConcept>();
  private genus: Genus | null = null;
  private species: Species[] = [];
  private broadened = false;
  private disclosure: DisclosureSection[] | null = null;
  private openCards = new Map<string, Module5Card>();
  private intents = new Map<string, Intent>();
  private conversation: HelperTurn[] = [];

  constructor(deps: ShowcaseDeps) {
    this.runAgent = deps.runAgent;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.genId = deps.genId ?? defaultGenId;
    this.ledger =
      deps.ledger ??
      new EvidenceLedger(SHOWCASE_HUMAN_SOURCE_TYPES, this.now, this.genId);
    this.consciousness =
      deps.consciousness ?? new SharedConsciousness(this.now, this.genId);
    this.disclosure = deps.disclosure ?? null;
    for (const k of deps.keyConcepts) {
      this.keyConcepts.set(k.id, { ...k, verbatim: [...k.verbatim] });
    }
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  async start(): Promise<Module5View> {
    if (this.started) return this.view();
    this.started = true;
    this.phase = "choosing";
    this.ledger.recordMachineEvent("showcase_started", ["module5"], {
      keyConcepts: this.keyConcepts.size,
    });
    const id = this.genId();
    this.openCards.set(id, {
      id,
      type: "choice",
      question:
        "Want to broaden the disclosure across alternative implementations, so the mechanism is covered however it's built? You can also skip straight to the finished draft.",
    });
    this.intents.set(id, { kind: "choice" });
    return this.view();
  }

  async act(
    cardId: string,
    input: ChoiceInput | VariationInput | WidenedActionInput,
  ): Promise<Module5View> {
    const card = this.openCards.get(cardId);
    const intent = this.intents.get(cardId);
    if (!card || !intent) return this.view();

    switch (card.type) {
      case "choice":
        await this.handleChoice(cardId, input as ChoiceInput);
        break;
      case "variation":
        await this.handleVariation(cardId, intent, input as VariationInput);
        break;
      case "widened_review":
        await this.handleWidened(cardId, intent, input as WidenedActionInput);
        break;
    }
    this.maybeCheckpoint();
    return this.view();
  }

  async tell(text: string): Promise<Module5View> {
    const t = text.trim();
    if (!t) return this.view();
    this.ledger.recordInventorSource("inventor_note", t, ["showcase", "note"]);
    this.pushTurn({ role: "inventor", text: t });
    try {
      const helper = await runHelper(this.runAgent, {
        message: t,
        context: this.helperContext(),
        inventorMaterial: this.inventorMaterial(),
        conversation: this.conversation.slice(-6).map((tn) => ({ role: tn.role, text: tn.text })),
        consciousness: this.consciousness.renderForAgent(),
      });
      this.pushTurn({
        role: "helper",
        text: helper.reply || "Ask away — I can explain broadening or how this fits together.",
        ...(helper.question?.ask ? { question: helper.question } : {}),
        intent: helper.intent,
      });
    } catch (err) {
      console.error("[showcase] helper failed", err);
      this.pushTurn({ role: "helper", text: "I hit a snag answering that — try rephrasing?" });
    }
    return this.view();
  }

  private pushTurn(turn: Omit<HelperTurn, "timestamp">): void {
    this.conversation.push({ ...turn, timestamp: this.now() });
  }

  /** A compact description of the live Showcase state for the Helper. */
  private helperContext(): string {
    const kept = this.species.filter((s) => s.kept).map((s) => s.species_type);
    return [
      `Phase: ${this.phase}. Broadening ${this.broadened ? "applied" : "not yet applied"}.`,
      `Key Concepts: ${[...this.keyConcepts.values()].map((k) => k.title).join("; ") || "(none)"}.`,
      this.genus ? `Paradigm-neutral genus: ${this.genus.genus_name}.` : "",
      kept.length ? `Kept implementations: ${kept.join(", ")}.` : "",
      this.openCards.size ? `${this.openCards.size} card(s) open for the inventor's decision.` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  /** Everything the inventor has stated in their own words (the verbatim trail). */
  private inventorMaterial(): string {
    return this.ledger
      .humanVerbatim()
      .map((e) => e.verbatim_text)
      .filter(Boolean)
      .join("\n");
  }

  view(): Module5View {
    return {
      phase: this.phase,
      cards: [...this.openCards.values()],
      keyConcepts: [...this.keyConcepts.values()].map(cloneKC),
      ...(this.genus ? { genus: { ...this.genus } } : {}),
      species: this.species.map((s) => ({ ...s, key_components: [...s.key_components], technical_improvements: [...s.technical_improvements] })),
      broadened: this.broadened,
      conversation: this.conversation.map((t) => ({ ...t })),
      ledger: this.ledger.serialize(),
      complete: this.isComplete(),
    };
  }

  /** The finished Key Concepts (broadened where the inventor accepted it). */
  finish(): ShowcaseKeyConcept[] {
    return [...this.keyConcepts.values()].map(cloneKC);
  }

  /** The Invention Disclosure carried from Module 4 (for export). */
  getDisclosure(): DisclosureSection[] | null {
    return this.disclosure ? this.disclosure.map((s) => ({ ...s })) : null;
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

  private async handleChoice(cardId: string, input: ChoiceInput): Promise<void> {
    this.ledger.recordDecision("broaden_choice", ["showcase", input.choice]);
    this.resolveCard(cardId);
    if (input.choice === "skip") {
      this.broadened = false;
      this.complete();
      return;
    }
    await this.generateVariations();
  }

  private async generateVariations(): Promise<void> {
    // Genus — the paradigm-neutral mechanism beneath the Key Concepts.
    const kcs = [...this.keyConcepts.values()];
    try {
      this.genus = await runGenusExtractor(this.runAgent, {
        keyConcepts: kcs.map((k) => ({ title: k.title, statement: k.statement })),
        verbatim: kcs.flatMap((k) => k.verbatim),
      });
      this.ledger.recordMachineEvent("agent_genus", ["showcase"], {});
    } catch (err) {
      console.error("[showcase] genus extraction failed", err);
      this.complete(); // can't broaden without a genus
      return;
    }

    const inventorMaterial = kcs.flatMap((k) => k.verbatim).join("\n");
    // Synthesize one species per type; the verifier (Boundary) gates each.
    for (const t of SPECIES_TYPES) {
      try {
        const sp = await runSpeciesSynthesizer(this.runAgent, { genus: this.genus, speciesType: t });
        const verdict = await runVerifier(this.runAgent, {
          piece: `${sp.species_name}: ${sp.architectural_description}\n${sp.data_flow}`,
          inventorMaterial,
          consciousness: this.consciousness.renderForAgent(),
        });
        this.ledger.recordMachineEvent("agent_species", ["showcase", t], {});
        if (verdict.verdict === "pass") {
          this.species.push(sp);
          this.emitVariation(sp);
        } else {
          this.ledger.recordMachineEvent("broadening_withheld", ["showcase", "species", t], {
            reason: verdict.note,
          });
        }
      } catch (err) {
        console.error("[showcase] species synthesis failed for", t, err);
      }
    }

    if (![...this.openCards.values()].some((c) => c.type === "variation")) {
      // Nothing survived the Boundary — finish without broadening.
      this.broadened = false;
      this.complete();
      return;
    }
    this.phase = "selecting_variations";
  }

  private async handleVariation(cardId: string, intent: Intent, input: VariationInput): Promise<void> {
    if (intent.kind !== "variation") return;
    const sp = this.species.find((s) => s.species_type === intent.speciesType);
    if (sp) sp.kept = input.action === "keep";
    this.ledger.recordDecision("variation_action", ["showcase", input.action], {
      speciesType: intent.speciesType,
    });
    this.resolveCard(cardId);
    if (![...this.openCards.values()].some((c) => c.type === "variation")) {
      await this.applyBroadening();
    }
  }

  private async applyBroadening(): Promise<void> {
    const kept = this.species.filter((s) => s.kept);
    if (kept.length === 0 || !this.genus) {
      this.broadened = false;
      this.complete();
      return;
    }
    const inventorMaterial = (kc: ShowcaseKeyConcept) => kc.verbatim.join("\n");
    for (const kc of this.keyConcepts.values()) {
      try {
        const b = await runKeyConceptBroadener(this.runAgent, {
          original: kc.statement,
          genus: this.genus,
          approvedSpecies: kept,
          consciousness: this.consciousness.renderForAgent({ part: `differentiation:${kc.id}` }),
        });
        const verdict = await runVerifier(this.runAgent, {
          piece: b.broadened_concept_text,
          inventorMaterial: inventorMaterial(kc),
          consciousness: this.consciousness.renderForAgent({ part: `differentiation:${kc.id}` }),
        });
        this.ledger.recordMachineEvent("agent_broadened", ["showcase"], { conceptId: kc.id });
        if (verdict.verdict === "pass" && b.broadened_concept_text.trim()) {
          this.emitWidenedReview(kc, b.broadened_concept_text);
        } else {
          this.ledger.recordMachineEvent("broadening_withheld", ["showcase", "concept"], {
            conceptId: kc.id,
            reason: verdict.note,
          });
        }
      } catch (err) {
        console.error("[showcase] broadening failed for", kc.id, err);
      }
    }
    // The 5c second pass: enrich the disclosure prose across the kept
    // implementations and append the genus/species/hardware Key Concepts. This is
    // the multi-paradigm depth — it applies once species are kept, independent of
    // whether individual per-concept broadenings survive the Boundary.
    await this.enrichDisclosure(kept);
    this.broadened = true;

    if (![...this.openCards.values()].some((c) => c.type === "widened_review")) {
      this.complete();
      return;
    }
    this.phase = "approving_widened";
  }

  /**
   * The 5c "extender" pass — enrich the carried Invention Disclosure across the
   * approved implementations, mutating it in place so export + reload carry the
   * richer document, and append the genus/species/hardware Key Concepts.
   */
  private async enrichDisclosure(kept: Species[]): Promise<void> {
    if (!this.genus || kept.length === 0) return;
    const genus = this.genus;

    // Append the genus / species-spectrum / hardware Key Concepts (2–3 of V1's 7).
    await this.appendKeyConcepts(genus, kept);

    const sections = this.disclosure;
    if (!sections) return;
    const find = (key: string) => sections.find((s) => s.key === key);
    const bg = find("background");
    const sum = find("summary");
    const abs = find("abstract");

    // Append to background + summary, replace the abstract — each mutates a
    // different section object, so they run in parallel.
    await Promise.all([
      (async () => {
        if (!bg) return;
        try {
          const r = await runBackgroundExtender(this.runAgent, { genus, species: kept, existing: bg.body });
          if (r.additional.trim()) bg.body = `${bg.body}\n\n${r.additional.trim()}`;
        } catch (err) {
          console.error("[showcase] background-extender failed", err);
        }
      })(),
      (async () => {
        if (!sum) return;
        try {
          const r = await runSummaryExtender(this.runAgent, { genus, species: kept, existing: sum.body });
          if (r.additional.trim()) sum.body = `${sum.body}\n\n${r.additional.trim()}`;
        } catch (err) {
          console.error("[showcase] summary-extender failed", err);
        }
      })(),
      (async () => {
        if (!abs) return;
        try {
          const r = await runAbstractRewriter(this.runAgent, { genus, species: kept, existing: abs.body });
          if (r.abstract.trim()) abs.body = r.abstract.trim();
        } catch (err) {
          console.error("[showcase] abstract-rewriter failed", err);
        }
      })(),
    ]);

    // Add the new "Detailed Description — Across Implementations" section after
    // Operations (sequential — it splices the sections array).
    try {
      const dd = await runDetailDescriptionExtender(this.runAgent, { genus, species: kept });
      if (dd.body.trim()) {
        const sec: DisclosureSection = {
          key: "detail_across",
          label: "Detailed Description — Across Implementations",
          body: dd.body.trim(),
        };
        const opsIdx = sections.findIndex((s) => s.key === "operations");
        if (opsIdx >= 0) sections.splice(opsIdx + 1, 0, sec);
        else sections.push(sec);
      }
    } catch (err) {
      console.error("[showcase] detail-description-extender failed", err);
    }

    this.ledger.recordMachineEvent("disclosure_extended", ["showcase"], {
      sections: sections.length,
    });
  }

  /** Append the genus_mechanism / species_spectrum / hardware_optimization concepts. */
  private async appendKeyConcepts(genus: Genus, kept: Species[]): Promise<void> {
    const aspects: ConceptAspect[] = [
      "genus_mechanism",
      "species_spectrum",
      "hardware_optimization",
    ];
    for (const aspect of aspects) {
      try {
        const existingTitles = [...this.keyConcepts.values()].map((k) => k.title);
        const r = await runKeyConceptAppender(this.runAgent, {
          genus,
          species: kept,
          existingTitles,
          aspect,
        });
        if (r.key_concept_text.trim()) {
          const id = `appended:${aspect}`;
          this.keyConcepts.set(id, {
            id,
            title: r.title.trim() || aspect.replace(/_/g, " "),
            statement: r.key_concept_text.trim(),
            verbatim: [],
          });
          this.ledger.recordMachineEvent("agent_appended_concept", ["showcase", aspect], {});
        }
      } catch (err) {
        console.error("[showcase] key-concept-appender failed for", aspect, err);
      }
    }
  }

  private async handleWidened(cardId: string, intent: Intent, input: WidenedActionInput): Promise<void> {
    if (intent.kind !== "widened") return;
    const card = this.openCards.get(cardId);
    const kc = this.keyConcepts.get(intent.conceptId);
    this.ledger.recordDecision("widened_action", ["showcase", input.action], {
      conceptId: intent.conceptId,
    });
    if (kc && card && card.type === "widened_review") {
      if (input.action === "approve") {
        kc.broadened = card.broadened;
        await this.recordBroadenedToConsciousness(kc, card.broadened);
      } else if (input.action === "request_edit") {
        const correction = input.correction.trim();
        if (correction) {
          const e = this.ledger.recordInventorSource("inventor_edit", correction, [
            "showcase",
            "broadened-correction",
          ]);
          kc.broadened = correction;
          await this.recordBroadenedToConsciousness(kc, correction, e.id);
        }
      }
      // discard → leave the Key Concept unbroadened.
    }
    this.resolveCard(cardId);
    if (![...this.openCards.values()].some((c) => c.type === "widened_review")) {
      // The disclosure was already enriched across implementations in
      // applyBroadening, so the broadening path stays marked applied.
      this.broadened = true;
      this.complete();
    }
  }

  /** Record an accepted broadened Key Concept to the Shared Consciousness. */
  private async recordBroadenedToConsciousness(
    kc: ShowcaseKeyConcept,
    text: string,
    inventorLedgerId?: string,
  ): Promise<void> {
    const prior = this.consciousness.current(`differentiation:${kc.id}`);
    const entry = this.consciousness.record({
      part: `broadened:${kc.id}`,
      content: text,
      why: `broadened, meaning-preserving form of Key Concept "${kc.title}"`,
      agent: "key-concept-broadener",
      derivedFrom: prior ? [prior.id] : [],
      ...(inventorLedgerId ? { tracesTo: [inventorLedgerId] } : {}),
    });
    try {
      const verdict = await runVerifier(this.runAgent, {
        piece: text,
        inventorMaterial: kc.verbatim.join("\n"),
        consciousness: this.consciousness.renderForAgent({ part: `broadened:${kc.id}` }),
      });
      this.consciousness.verify(entry.id, {
        by: "verifier",
        verdict: verdict.verdict,
        ...(verdict.note ? { note: verdict.note } : {}),
      });
    } catch (err) {
      console.error("[showcase] broadened verify failed for", kc.id, err);
    }
  }

  private complete(): void {
    this.phase = "ready";
    this.ledger.recordMachineEvent("module_completed", ["module5"], {
      broadened: this.broadened,
    });
  }

  private maybeCheckpoint(): void {
    if (this.isComplete() && !hasCheckpoint(this.ledger, "module5")) {
      sealCheckpoint(this.ledger, "module5");
    }
  }

  private isComplete(): boolean {
    return this.phase === "ready";
  }

  /* ------------------------------------------------------------------ *
   * Card emitters
   * ------------------------------------------------------------------ */

  private emitVariation(sp: Species): void {
    const id = this.genId();
    this.openCards.set(id, {
      id,
      type: "variation",
      speciesType: sp.species_type,
      name: sp.species_name,
      description: sp.architectural_description,
      improvements: sp.technical_improvements,
      actions: ["keep", "drop"],
    });
    this.intents.set(id, { kind: "variation", speciesType: sp.species_type });
  }

  private emitWidenedReview(kc: ShowcaseKeyConcept, broadened: string): void {
    const id = this.genId();
    this.openCards.set(id, {
      id,
      type: "widened_review",
      conceptId: kc.id,
      title: kc.title,
      original: kc.statement,
      broadened,
      actions: ["approve", "discard", "request_edit"],
    });
    this.intents.set(id, { kind: "widened", conceptId: kc.id });
  }

  private resolveCard(cardId: string): void {
    this.openCards.delete(cardId);
    this.intents.delete(cardId);
  }

  /* ------------------------------------------------------------------ *
   * Persistence
   * ------------------------------------------------------------------ */

  toSnapshot(): ShowcaseSnapshot {
    return {
      phase: this.phase,
      started: this.started,
      keyConcepts: [...this.keyConcepts.values()].map(cloneKC),
      genus: this.genus ? { ...this.genus } : null,
      species: this.species.map((s) => ({ ...s })),
      broadened: this.broadened,
      disclosure: this.disclosure ? this.disclosure.map((s) => ({ ...s })) : null,
      openCards: [...this.openCards.values()],
      intents: [...this.intents.entries()],
      conversation: this.conversation.map((t) => ({ ...t })),
      ledger: this.ledger.serialize(),
    };
  }

  static fromSnapshot(snap: ShowcaseSnapshot, deps: ShowcaseDeps): ShowcaseModule {
    const now = deps.now ?? (() => new Date().toISOString());
    const genId = deps.genId ?? defaultGenId;
    const ledger = EvidenceLedger.fromEntries(snap.ledger, SHOWCASE_HUMAN_SOURCE_TYPES, now, genId);
    const m = new ShowcaseModule({ ...deps, keyConcepts: [], disclosure: snap.disclosure ?? undefined, ledger });
    m.phase = snap.phase;
    m.started = snap.started;
    m.keyConcepts = new Map(snap.keyConcepts.map((k) => [k.id, cloneKC(k)]));
    m.genus = snap.genus;
    m.species = snap.species.map((s) => ({ ...s }));
    m.broadened = snap.broadened;
    m.disclosure = snap.disclosure;
    m.openCards = new Map(snap.openCards.map((c) => [c.id, c]));
    m.intents = new Map(snap.intents);
    m.conversation = (snap.conversation ?? []).map((t) => ({ ...t }));
    return m;
  }
}

/* ------------------------------------------------------------------ */

function cloneKC(k: ShowcaseKeyConcept): ShowcaseKeyConcept {
  return { ...k, verbatim: [...k.verbatim] };
}

function defaultGenId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `s_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}
