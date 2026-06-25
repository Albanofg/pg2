import "server-only";
import { applyGrade, EvidenceLedger, SharedConsciousness } from "@/lib/modules/shared";
import { hasCheckpoint, sealCheckpoint } from "@/lib/modules/shared/checkpoint";
import type { ConceptObject, HelperTurn } from "@/lib/modules/shared";
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
    await Promise.all([...this.concepts.values()].map((c) => this.deepenOne(c)));
    await this.maybeAdvanceToSelecting();
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

    await this.maybeAdvanceToSelecting();
    this.maybeCheckpoint();
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

  view(): Module2View {
    return {
      phase: this.phase,
      cards: [...this.openCards.values()],
      concepts: this.snapshotConcepts(),
      conversation: this.conversation.map((t) => ({ ...t })),
      ledger: this.ledger.serialize(),
      complete: this.isComplete(),
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
    return m;
  }

  /* ------------------------------------------------------------------ *
   * Deepen
   * ------------------------------------------------------------------ */

  private async deepenOne(concept: MaturedConcept): Promise<void> {
    const part = `concept:${concept.id}`;
    const statement = concept.formalized_statement;
    const verbatim = concept.conception_trail.map((t) => t.verbatim_text);
    let deepened = statement;
    let isDeepened = false;
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
      // One sharp inventive Spark, if any (not a wall).
      const gap = r.inventive_gaps[0];
      if (gap) this.emitSpark(concept.id, "leap", gap.missing_element, gap.why_routine_insufficient);
      // A clarify Spark when it isn't concrete enough to search.
      if (!r.search_ready && r.missing_for_search.trim()) {
        this.emitSpark(
          concept.id,
          "clarify",
          r.missing_for_search,
          "A search needs this to return relevant results rather than noise.",
        );
      }
    } catch (err) {
      console.error("[maturation] deepener failed for concept", concept.id, err);
      this.ledger.recordMachineEvent("agent_deepened", ["maturation", "error"], {
        conceptId: concept.id,
        error: String(err),
      });
    }
    concept.deepened_statement = deepened;
    this.emitDeepenReview(concept.id, statement, deepened, isDeepened);

    // Record the deepening to the Shared Consciousness and cross-verify it
    // (supersedes the Concept's core from Conception, propagating staleness).
    if (isDeepened) await this.syncDeepenedToConsciousness(concept);
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
    this.resolveCard(cardId);
    const answer = input.answer.trim();
    if (!concept || !answer) return;
    const type = intent.sparkKind === "leap" ? "leap_input" : "clarity_answer";
    const e = this.ledger.recordInventorSource(type, answer, [
      "maturation",
      intent.sparkKind,
    ]);
    // The inventor's words deepen the concept and make it search-ready.
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

  private async maybeAdvanceToSelecting(): Promise<void> {
    if (this.phase !== "maturing" || !this.started) return;
    const stillMaturing = [...this.intents.values()].some(
      (i) => i.kind === "deepen" || i.kind === "spark",
    );
    if (stillMaturing) return;
    this.phase = "selecting";
    for (const c of this.concepts.values()) {
      if (c.status.state !== "active") continue;
      this.emitSelection(c);
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
  ): void {
    const id = this.genId();
    const card: SparkCard = { id, type: "spark", conceptId, kind: sparkKind, prompt, missing };
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

  private isComplete(): boolean {
    if (this.phase === "maturing") return false;
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
