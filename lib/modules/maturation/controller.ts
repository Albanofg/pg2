import "server-only";
import { applyGrade, EvidenceLedger, SharedConsciousness } from "@/lib/modules/shared";
import { hasCheckpoint, sealCheckpoint } from "@/lib/modules/shared/checkpoint";
import type { ConceptObject, HelperTurn } from "@/lib/modules/shared";
import { renderScreenCards } from "@/lib/modules/shared/helper-agent";
import { runDeepener, runHelper, runVerifier } from "./agents";
import { MATURATION_HUMAN_SOURCE_TYPES } from "./types";
import type {
  DeepenReviewCard,
  DeepenReviewInput,
  MaturationDeps,
  MaturedConcept,
  Module2Card,
  Module2Phase,
  Module2View,
  SelectionCard,
  SelectionInput,
  SparkCard,
  SparkInput,
} from "./types";

/**
 * Module 2 — the Maturation flow engine. PER CONCEPT it: re-grounds on the
 * inventor's original words, deepens into a fuller technical statement, raises
 * single sharp Sparks for genuinely inventive gaps or missing search-specificity
 * (the inventor fills these, never the system), and finally lets the inventor
 * select which matured, search-ready concepts carry forward. Set-aside concepts
 * are retained, not destroyed.
 */

type Intent =
  | { kind: "deepen"; conceptId: string; proposed: string; deepened: boolean }
  | { kind: "spark"; conceptId: string; sparkKind: "clarify" | "leap" }
  | { kind: "selection"; conceptId: string };

export type MaturationSnapshot = {
  phase: Module2Phase;
  started: boolean;
  concepts: MaturedConcept[];
  openCards: Module2Card[];
  intents: [string, Intent][];
  conversation: HelperTurn[];
  ledger: import("@/lib/modules/shared").LedgerEntry[];
  // One-at-a-time flow state (optional for backward-compat with old snapshots).
  queue?: string[];
  maturingTotal?: number;
};

export class MaturationModule {
  private readonly runAgent;
  private readonly now: () => string;
  private readonly genId: () => string;
  private readonly ledger: EvidenceLedger;
  /** The cross-module draft memory. Persisted separately (top-level), not in this snapshot. */
  private readonly consciousness: SharedConsciousness;

  private phase: Module2Phase = "maturing";
  private started = false;
  private concepts = new Map<string, MaturedConcept>();
  private openCards = new Map<string, Module2Card>();
  private intents = new Map<string, Intent>();
  private conversation: HelperTurn[] = [];
  // Concept IDs still waiting to be matured, and the total, so the view can show
  // "concept N of M" instead of a wall.
  private queue: string[] = [];
  private maturingTotal = 0;

  constructor(deps: MaturationDeps) {
    this.runAgent = deps.runAgent;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.genId = deps.genId ?? defaultGenId;
    this.ledger =
      deps.ledger ??
      new EvidenceLedger(MATURATION_HUMAN_SOURCE_TYPES, this.now, this.genId);
    this.consciousness =
      deps.consciousness ?? new SharedConsciousness(this.now, this.genId);
    for (const c of deps.concepts) {
      if (c.status.state !== "active") continue;
      this.concepts.set(c.id, {
        ...cloneConcept(c),
        deepened_statement: "",
        searchReady: false,
        decision: "undecided",
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  async start(): Promise<Module2View> {
    if (this.started) return this.view();
    this.started = true;
    this.phase = "maturing";
    this.ledger.recordMachineEvent("maturation_started", ["module2"], {
      conceptCount: this.concepts.size,
    });
    // One concept at a time: queue them and deepen+surface only the FIRST. The
    // rest are matured as the inventor finishes each — no wall of 30+ cards, and
    // no long upfront load deepening everything at once.
    this.queue = [...this.concepts.values()]
      .filter((c) => c.status.state === "active")
      .map((c) => c.id);
    this.maturingTotal = this.queue.length;
    await this.surfaceNextConcept();
    return this.view();
  }

  async act(
    cardId: string,
    input: DeepenReviewInput | SparkInput | SelectionInput,
  ): Promise<Module2View> {
    const card = this.openCards.get(cardId);
    const intent = this.intents.get(cardId);
    if (!card || !intent) return this.view();

    if (card.type === "deepen_review")
      this.handleDeepen(cardId, intent, input as DeepenReviewInput);
    else if (card.type === "spark")
      this.handleSpark(cardId, intent, input as SparkInput);
    else if (card.type === "selection")
      this.handleSelection(cardId, intent, input as SelectionInput);

    if (this.phase === "maturing") {
      // Once this concept's card is resolved, move on — deepening the next ones,
      // auto-carrying those that need nothing, pausing on the next that does.
      const stillOnThisConcept = [...this.intents.values()].some(
        (i) => i.kind === "deepen" || i.kind === "spark",
      );
      if (!stillOnThisConcept) await this.surfaceNextConcept();
    }
    this.maybeCheckpoint();
    return this.view();
  }

  /**
   * The presentation step's picker: choose which matured concepts go on to the
   * prior-art search. All carry forward by default; leaving one behind is the same
   * as setting it aside — dropped from the rest of the process. Toggleable (the
   * inventor can re-include it) right up until they move on to Landscape.
   */
  setCarry(conceptId: string, carry: boolean): Module2View {
    const concept = this.concepts.get(conceptId);
    if (concept) {
      concept.decision = carry ? "carry_forward" : "set_aside";
      concept.status = { state: carry ? "active" : "dropped" };
      this.ledger.recordDecision(
        "concept_decision",
        ["selection", carry ? "carry_forward" : "set_aside"],
        { conceptId },
      );
    }
    return this.view();
  }

  /** Seal a Checkpoint to the Ledger the moment Maturation is finalized. */
  private maybeCheckpoint(): void {
    if (this.isComplete() && !hasCheckpoint(this.ledger, "module2")) {
      sealCheckpoint(this.ledger, "module2");
    }
  }

  /** The inventor types to the Helper — captured verbatim AND answered. */
  async tell(text: string): Promise<Module2View> {
    const t = text.trim();
    if (!t) return this.view();
    this.ledger.recordInventorSource("inventor_note", t, ["maturation", "note"]);
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
        text: helper.reply || "Tell me a bit more and I'll help you sharpen it.",
        ...(helper.question?.ask ? { question: helper.question } : {}),
        intent: helper.intent,
      });
    } catch (err) {
      console.error("[maturation] helper failed", err);
      this.pushTurn({ role: "helper", text: "I hit a snag answering that — try rephrasing?" });
    }
    return this.view();
  }

  private pushTurn(turn: Omit<HelperTurn, "timestamp">): void {
    this.conversation.push({ ...turn, timestamp: this.now() });
  }

  /** A compact description of the live Maturation state for the Helper. */
  private helperContext(): string {
    const active = [...this.concepts.values()].filter((c) => c.status.state === "active");
    return [
      `Phase: ${this.phase}.`,
      active.length
        ? `Concepts being matured:\n${active
            .map((c, i) => `[${i + 1}] ${c.title}: ${c.deepened_statement || c.formalized_statement}`)
            .join("\n")}`
        : "No active concepts yet.",
      "THE INVENTOR'S SCREEN RIGHT NOW (the cards they are looking at / deciding on):",
      renderScreenCards([...this.openCards.values()]),
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

  view(): Module2View {
    const progress = this.progress();
    return {
      phase: this.phase,
      cards: [...this.openCards.values()],
      concepts: this.snapshotConcepts(),
      conversation: this.conversation.map((t) => ({ ...t })),
      ledger: this.ledger.serialize(),
      complete: this.isComplete(),
      ...(progress ? { progress } : {}),
    };
  }

  /** The deliverable: the matured concepts the inventor carried forward. */
  finish(): MaturedConcept[] {
    if (!this.isComplete()) {
      throw new Error(
        "Module 2: cannot finish — not every concept has a decision, or none was carried forward.",
      );
    }
    return this.snapshotConcepts().filter((c) => c.decision === "carry_forward");
  }

  ledgerEntries() {
    return this.ledger.serialize();
  }

  /** The live Shared Consciousness — persisted at top-level so it is one
   *  continuous draft memory across modules. */
  consciousnessInstance(): SharedConsciousness {
    return this.consciousness;
  }

  /* ------------------------------------------------------------------ *
   * Persistence
   * ------------------------------------------------------------------ */

  toSnapshot(): MaturationSnapshot {
    return {
      phase: this.phase,
      started: this.started,
      concepts: this.snapshotConcepts(),
      openCards: [...this.openCards.values()],
      intents: [...this.intents.entries()],
      conversation: this.conversation.map((t) => ({ ...t })),
      ledger: this.ledger.serialize(),
      queue: [...this.queue],
      maturingTotal: this.maturingTotal,
    };
  }

  static fromSnapshot(snap: MaturationSnapshot, deps: MaturationDeps): MaturationModule {
    const now = deps.now ?? (() => new Date().toISOString());
    const genId = deps.genId ?? defaultGenId;
    const ledger = EvidenceLedger.fromEntries(
      snap.ledger,
      MATURATION_HUMAN_SOURCE_TYPES,
      now,
      genId,
    );
    const m = new MaturationModule({ ...deps, concepts: [], ledger });
    m.phase = snap.phase;
    m.started = snap.started;
    m.concepts = new Map(snap.concepts.map((c) => [c.id, c]));
    m.openCards = new Map(snap.openCards.map((c) => [c.id, c]));
    m.intents = new Map(snap.intents);
    m.conversation = (snap.conversation ?? []).map((t) => ({ ...t }));
    m.queue = snap.queue ?? [];
    m.maturingTotal = snap.maturingTotal ?? snap.concepts.length;
    return m;
  }

  /* ------------------------------------------------------------------ *
   * Deepen
   * ------------------------------------------------------------------ */

  /**
   * Deepen the next concept(s), AUTO-ACCEPTING the routine deepening, and pause
   * only when one genuinely needs the inventor (a single suggestion card). A
   * concept that needs nothing flows straight through to carried-forward — no card,
   * no click. So the inventor only ever sees the few concepts that need a look.
   */
  private async surfaceNextConcept(): Promise<void> {
    while (this.queue.length) {
      const id = this.queue.shift()!;
      const concept = this.concepts.get(id);
      if (!concept || concept.status.state !== "active") continue;
      const needsInventor = await this.deepenOne(concept);
      if (needsInventor) return; // pause on this concept's suggestion card
      // else: nothing needed — it carries forward; keep going
    }
    // Nothing left to deepen — carry everything forward.
    this.finalizeAll();
  }

  /**
   * Deepen ONE concept and auto-accept the result (deepening only formalizes the
   * inventor's own words, and the verifier cross-checks it — so no approve-click).
   * Returns true iff a genuine gap remains and a single suggestion card was
   * surfaced for the inventor (use the AI's suggested fill, tweak it, or skip).
   */
  private async deepenOne(concept: MaturedConcept): Promise<boolean> {
    const part = `concept:${concept.id}`;
    const statement = concept.formalized_statement;
    const verbatim = concept.conception_trail.map((t) => t.verbatim_text);
    let deepened = statement;
    let isDeepened = false;
    let gap: { kind: "leap" | "clarify"; missing: string; why: string; suggestion: string } | null =
      null;
    try {
      const r = await runDeepener(this.runAgent, {
        statement,
        verbatim,
        consciousness: this.consciousness.renderForAgent({ part }),
      });
      this.ledger.recordMachineEvent("agent_deepened", ["maturation"], {
        conceptId: concept.id,
        searchReady: r.search_ready,
        gaps: r.inventive_gaps.length,
      });
      if (r.deepened_statement?.trim()) {
        deepened = r.deepened_statement;
        isDeepened = true;
      }
      concept.searchReady = r.search_ready;
      // The reasons the deepening rests on — carried forward so the grade (and
      // downstream modules) can check the statement never drifts from them.
      if (r.reasons?.length) concept.reasons = [...r.reasons];
      // At most ONE card per concept: the inventive gap (more important) if there
      // is one, else the search-specificity gap. Each carries an AI suggestion.
      const inv = r.inventive_gaps[0];
      if (inv) {
        gap = {
          kind: "leap",
          missing: inv.missing_element,
          why: inv.why_routine_insufficient,
          suggestion: inv.suggestion ?? "",
        };
      } else if (!r.search_ready && r.missing_for_search.trim()) {
        gap = {
          kind: "clarify",
          missing: r.missing_for_search,
          why: "A search needs this to return relevant results rather than noise.",
          suggestion: r.search_suggestion ?? "",
        };
      }
    } catch (err) {
      console.error("[maturation] deepener failed for concept", concept.id, err);
      this.ledger.recordMachineEvent("agent_deepened", ["maturation", "error"], {
        conceptId: concept.id,
        error: String(err),
      });
    }
    // Auto-accept the deepened statement (it only formalizes the inventor's words).
    concept.deepened_statement = deepened;
    if (isDeepened) {
      concept.provenance.push({
        excerpt: deepened,
        provenance: "system_formalized",
        derivedFrom: concept.conception_trail.map((t) => t.ledgerId),
      });
      // Cross-verify the deepening (a DIFFERENT agent), propagating staleness.
      await this.syncDeepenedToConsciousness(concept);
    }
    if (gap) {
      this.emitSpark(concept.id, gap.kind, gap.missing, gap.why, gap.suggestion);
      return true;
    }
    return false; // no gap — carries forward by default
  }

  /**
   * Mirror a Concept's deepened statement into the Shared Consciousness and have
   * the verifier (a DIFFERENT agent than the deepener) cross-check it against the
   * inventor's own words for that Concept. Supersedes the Concept's prior entry.
   */
  private async syncDeepenedToConsciousness(concept: MaturedConcept): Promise<void> {
    if (!concept.deepened_statement.trim()) return;
    const part = `concept:${concept.id}`;
    const prior = this.consciousness.current(part);
    const reasons = concept.reasons ?? [];
    const entry = this.consciousness.record({
      part,
      content: concept.deepened_statement,
      why: `concept "${concept.title}" — deepened from the inventor's words for search-readiness`,
      reasons,
      agent: "deepener",
      tracesTo: concept.conception_trail.map((t) => t.ledgerId),
      ...(prior ? { supersedes: prior.id } : {}),
    });
    try {
      const verdict = await runVerifier(this.runAgent, {
        piece: concept.deepened_statement,
        inventorMaterial: concept.conception_trail.map((t) => t.verbatim_text).join("\n"),
        reasons,
        consciousness: this.consciousness.renderForAgent({ part }),
      });
      // Act on the grade (don't drop a fail): a pass settles the entry; a fail
      // leaves it a draft AND records a durable, surfaceable failure. The resolved
      // Grade rides on the concept to the view → the Live Draft panel.
      concept.grade = applyGrade(
        this.consciousness,
        this.ledger,
        entry,
        {
          verdict: verdict.verdict,
          ...(verdict.note ? { note: verdict.note } : {}),
          ...(verdict.violated_reasons?.length
            ? { violatedReasons: verdict.violated_reasons }
            : {}),
        },
        { by: "verifier", tags: ["maturation", part] },
      );
    } catch (err) {
      console.error("[maturation] verifier failed for concept", concept.id, err);
    }
  }

  /* ------------------------------------------------------------------ *
   * Action handlers
   * ------------------------------------------------------------------ */

  private handleDeepen(cardId: string, intent: Intent, input: DeepenReviewInput): void {
    if (intent.kind !== "deepen") return;
    const concept = this.concepts.get(intent.conceptId);
    if (!concept) return;
    this.ledger.recordDecision("deepen_action", ["maturation", input.action], {
      conceptId: concept.id,
    });

    if (input.action === "approve") {
      concept.deepened_statement = intent.proposed;
      if (intent.deepened) {
        concept.provenance.push({
          excerpt: intent.proposed,
          provenance: "system_formalized",
          derivedFrom: concept.conception_trail.map((t) => t.ledgerId),
        });
      }
    } else if (input.action === "discard") {
      concept.decision = "set_aside";
      concept.status = { state: "dropped" };
      // Setting the concept aside drops its open Sparks too — they're moot now.
      this.resolveConceptSparks(concept.id);
    } else {
      const correction = input.correction.trim();
      if (correction) {
        const e = this.ledger.recordInventorSource("inventor_edit", correction, [
          "maturation",
          "correction",
        ]);
        concept.deepened_statement = correction;
        concept.searchReady = true;
        concept.conception_trail.push({
          ledgerId: e.id,
          verbatim_text: correction,
          timestamp: e.timestamp,
        });
        concept.provenance.push({
          excerpt: correction,
          provenance: "inventor_conceived",
          derivedFrom: [e.id],
        });
      }
    }
    this.resolveCard(cardId);
  }

  private handleSpark(cardId: string, intent: Intent, input: SparkInput): void {
    if (intent.kind !== "spark") return;
    const concept = this.concepts.get(intent.conceptId);
    const card = this.openCards.get(cardId);
    const suggestion = card?.type === "spark" ? (card.suggestion ?? "") : "";
    this.resolveCard(cardId);
    if (!concept) return;

    // Set this concept aside — drop it.
    if ("action" in input && input.action === "set_aside") {
      concept.decision = "set_aside";
      concept.status = { state: "dropped" };
      this.ledger.recordDecision("concept_decision", ["maturation", "set_aside"], {
        conceptId: concept.id,
      });
      return;
    }
    // Skip — leave the concept as deepened; it carries forward by default.
    if ("action" in input && input.action === "skip") return;

    // Accept the AI's suggested fill — recorded HONESTLY as system_suggested_accepted
    // (the inventor accepted a suggestion; it is NOT logged as their own verbatim).
    if ("action" in input && input.action === "use_suggestion") {
      const answer = suggestion.trim();
      if (!answer) return;
      this.ledger.recordDecision("suggestion_accepted", ["maturation", intent.sparkKind], {
        conceptId: concept.id,
      });
      concept.deepened_statement = `${concept.deepened_statement} ${answer}`.trim();
      concept.searchReady = true;
      concept.provenance.push({
        excerpt: answer,
        provenance: "system_suggested_accepted",
        derivedFrom: [],
      });
      return;
    }

    // The inventor wrote their own — captured verbatim as theirs (inventor_conceived).
    if ("answer" in input) {
      const answer = input.answer.trim();
      if (!answer) return;
      const type = intent.sparkKind === "leap" ? "leap_input" : "clarity_answer";
      const e = this.ledger.recordInventorSource(type, answer, ["maturation", intent.sparkKind]);
      concept.deepened_statement = `${concept.deepened_statement} ${answer}`.trim();
      concept.searchReady = true;
      concept.conception_trail.push({
        ledgerId: e.id,
        verbatim_text: answer,
        timestamp: e.timestamp,
      });
      concept.provenance.push({
        excerpt: answer,
        provenance: "inventor_conceived",
        derivedFrom: [e.id],
      });
    }
  }

  private handleSelection(cardId: string, intent: Intent, input: SelectionInput): void {
    if (intent.kind !== "selection") return;
    const concept = this.concepts.get(intent.conceptId);
    if (!concept) return;
    this.ledger.recordDecision("concept_decision", ["selection", input.choice], {
      conceptId: concept.id,
    });
    concept.decision = input.choice;
    if (input.choice === "set_aside") concept.status = { state: "dropped" };
    else this.ledger.recordMachineEvent("concept_matured", ["selection"], { conceptId: concept.id });
    this.resolveCard(cardId);
  }

  /* ------------------------------------------------------------------ *
   * Phase progression
   * ------------------------------------------------------------------ */

  /**
   * Everything is deepened — carry ALL surviving concepts forward. There is no
   * per-concept "carry forward / set aside" wall: the inventor kept depth, so the
   * default is keep. Set-aside only happens when the inventor explicitly chose it
   * on a concept's suggestion card.
   */
  private finalizeAll(): void {
    this.phase = "complete";
    for (const c of this.concepts.values()) {
      if (c.status.state === "active" && c.decision === "undecided") {
        c.decision = "carry_forward";
        this.ledger.recordMachineEvent("concept_matured", ["auto_carry"], { conceptId: c.id });
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Cards
   * ------------------------------------------------------------------ */

  private emitDeepenReview(
    conceptId: string,
    original: string,
    deepened: string,
    isDeepened: boolean,
  ): void {
    const concept = this.concepts.get(conceptId);
    const id = this.genId();
    const card: DeepenReviewCard = {
      id,
      type: "deepen_review",
      conceptId,
      title: concept?.title ?? "Concept",
      original_statement: original,
      deepened_statement: deepened,
      actions: ["approve", "discard", "request_edit"],
    };
    this.openCards.set(id, card);
    this.intents.set(id, { kind: "deepen", conceptId, proposed: deepened, deepened: isDeepened });
  }

  private emitSpark(
    conceptId: string,
    sparkKind: "clarify" | "leap",
    missing: string,
    prompt: string,
    suggestion?: string,
  ): void {
    const id = this.genId();
    const card: SparkCard = {
      id,
      type: "spark",
      conceptId,
      kind: sparkKind,
      prompt,
      missing,
      ...(suggestion ? { suggestion } : {}),
    };
    this.openCards.set(id, card);
    this.intents.set(id, { kind: "spark", conceptId, sparkKind });
  }

  private emitSelection(concept: MaturedConcept): void {
    const id = this.genId();
    const card: SelectionCard = {
      id,
      type: "selection",
      conceptId: concept.id,
      title: concept.title,
      statement: concept.deepened_statement || concept.formalized_statement,
      searchReady: concept.searchReady,
      actions: ["carry_forward", "set_aside"],
    };
    this.openCards.set(id, card);
    this.intents.set(id, { kind: "selection", conceptId: concept.id });
  }

  /* ------------------------------------------------------------------ *
   * Bookkeeping
   * ------------------------------------------------------------------ */

  private resolveCard(cardId: string): void {
    this.openCards.delete(cardId);
    this.intents.delete(cardId);
  }

  /** Drop any open Spark cards for a concept (used when it's set aside). */
  private resolveConceptSparks(conceptId: string): void {
    for (const [id, intent] of [...this.intents.entries()]) {
      if (intent.kind === "spark" && intent.conceptId === conceptId) this.resolveCard(id);
    }
  }

  /** "Concept N of M" — progress through the concepts as they're matured. */
  private progress(): { current: number; total: number } | undefined {
    if (this.phase === "maturing" && this.maturingTotal > 0) {
      return { current: this.maturingTotal - this.queue.length, total: this.maturingTotal };
    }
    return undefined;
  }

  private isComplete(): boolean {
    if (this.phase !== "complete") return false;
    const open = [...this.intents.values()].some(
      (i) => i.kind === "deepen" || i.kind === "spark" || i.kind === "selection",
    );
    if (open) return false;
    return this.snapshotConcepts().some((c) => c.decision === "carry_forward");
  }

  private snapshotConcepts(): MaturedConcept[] {
    return [...this.concepts.values()].map((c) => ({
      ...c,
      conception_trail: c.conception_trail.map((t) => ({ ...t })),
      provenance: c.provenance.map((p) => ({ ...p, derivedFrom: [...p.derivedFrom] })),
      status: { ...c.status },
      ...(c.reasons ? { reasons: [...c.reasons] } : {}),
      ...(c.grade
        ? {
            grade: {
              ...c.grade,
              reasons: [...c.grade.reasons],
              ...(c.grade.violatedReasons
                ? { violatedReasons: [...c.grade.violatedReasons] }
                : {}),
            },
          }
        : {}),
    }));
  }
}

function cloneConcept(c: ConceptObject): ConceptObject {
  return {
    ...c,
    conception_trail: c.conception_trail.map((t) => ({ ...t })),
    provenance: c.provenance.map((p) => ({ ...p, derivedFrom: [...p.derivedFrom] })),
    status: { ...c.status },
  };
}

function defaultGenId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `m_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}
