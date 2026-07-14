import "server-only";
import {
  runAdvocate,
  runBoundaryClassifier,
  runBrainstorm,
  runCodeGenerator,
  runDecomposer,
  runDistiller,
  runExaminer,
  runFormalizer,
  runHelper,
  runReviser,
  runVerifier,
} from "./agents";

/** The Shared-Consciousness part key for the whole-idea core reading. */
const CORE_PART = "conception:core";
import {
  EvidenceLedger,
  SharedConsciousness,
  screen,
  type BoundaryClassifier,
} from "@/lib/modules/shared";
import { hasCheckpoint, sealCheckpoint } from "@/lib/modules/shared/checkpoint";
import { renderScreenCards } from "@/lib/modules/shared/helper-agent";
import { MODULE1_HUMAN_SOURCE_TYPES } from "./types";
import type {
  BrainstormCard,
  BrainstormInput,
  CandidateActionInput,
  CandidateConceptCard,
  ClarityAnswerInput,
  ClarityCard,
  CodeReviewCard,
  HelperTurn,
  LeapCard,
  ConceptObject,
  ConceptProvenancePart,
  ConceptionDeps,
  ConceptionTrailItem,
  LeapInput,
  Module1Card,
  Module1Phase,
  Module1View,
  ReviewActionInput,
  ReviewCard,
} from "./types";

/**
 * Module 1 — the Conception flow engine.
 *
 * The reconciled "start": the inventor drops a raw idea in plain words; the
 * Helper captures those exact words verbatim (the conception), produces a clean
 * formalized restatement, and hands it back as a Review card to Approve / Edit /
 * Discard. Only once the inventor agrees that's the right reading does the
 * Helper generate representative code and decompose the idea into the distinct
 * concepts that are this module's deliverable.
 *
 * Rules enforced in code (not just prompts):
 *  - Inventor input is recorded verbatim BEFORE any AI step runs.
 *  - The first response is the acknowledgment, never an interrogation — no
 *    clarity/Leap cards on turn one, and no prior-art logic anywhere (that is
 *    Module 3).
 *  - No AI-conceived substance reaches a card: decomposed pieces pass the
 *    Boundary Classifier, and anything inventive is withheld and turned into a
 *    Leap card (the only path for new inventive content).
 *  - Formalizer additions are surfaced and tagged system_suggested_accepted
 *    only on explicit approval. Nothing auto-accepts.
 *
 * The Helper drives it: `ingest(raw)`, render `view()`, `act(cardId, input)`,
 * then `finish()` when `view().complete`.
 *
 * This engine owns logic, prompts, and the ledger — NOT the screen, the
 * conversation surface, the model transport, or the rendering of cards.
 */

type SafeConcept = {
  title: string;
  restatement: string;
  source_excerpts: string[];
};

type Intent =
  | { kind: "statement" }
  | { kind: "code" }
  | { kind: "clarity" }
  | { kind: "leap"; inventiveElement: string }
  | { kind: "candidate"; conceptId: string }
  | { kind: "brainstorm" }
  | { kind: "confirm_addition"; conceptId: string; addition: string };

/** Full, JSON-serializable snapshot of a conception session (for the DB). */
export type ConceptionSnapshot = {
  material: string[];
  phase: Module1Phase;
  statementText: string;
  statementApproved: boolean;
  representativeCode: { language: string; code: string } | null;
  codeApproved: boolean;
  concepts: ConceptObject[];
  confirmed: string[];
  openCards: Module1Card[];
  intents: [string, Intent][];
  ledger: import("@/lib/modules/shared").LedgerEntry[];
  /** The Helper conversation (added later — optional for back-compat). */
  conversation?: HelperTurn[];
  /** The distiller's last read of the idea (added later — optional for back-compat). */
  strong?: string[];
  thin?: string[];
  setAside?: string[];
};

export class ConceptionModule {
  private readonly runAgent;
  private readonly now: () => string;
  private readonly genId: () => string;
  private readonly ledger: EvidenceLedger;
  /** The cross-module draft memory. Persisted separately (top-level), not in this snapshot. */
  private readonly consciousness: SharedConsciousness;

  /** The inventor's accumulated verbatim material, in order. */
  private material: string[] = [];
  private phase: Module1Phase = "ingesting";

  /** The Helper's formalized restatement of the whole idea, and its state. */
  private statementText = "";
  private statementApproved = false;

  /** Representative code generated after the statement is approved. */
  private representativeCode: { language: string; code: string } | null = null;
  private codeApproved = false;

  private concepts = new Map<string, ConceptObject>();
  private confirmed = new Set<string>();

  private openCards = new Map<string, Module1Card>();
  private intents = new Map<string, Intent>();

  /** The Helper conversation — its teaching replies and the inventor's messages. */
  private conversation: HelperTurn[] = [];

  /** The distiller's last read of the idea (so the Helper can teach about it). */
  private strong: string[] = [];
  private thin: string[] = [];
  private setAside: string[] = [];

  constructor(deps: ConceptionDeps) {
    this.runAgent = deps.runAgent;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.genId = deps.genId ?? defaultGenId;
    this.ledger =
      deps.ledger ??
      new EvidenceLedger(MODULE1_HUMAN_SOURCE_TYPES, this.now, this.genId);
    this.consciousness =
      deps.consciousness ?? new SharedConsciousness(this.now, this.genId);
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  /**
   * Step 1 — the inventor submits their raw idea in plain words. Captured
   * verbatim, then formalized and handed back as a single Review card. No
   * questions, no decomposition yet — acknowledgment first.
   */
  async ingest(
    rawInput: string,
    brainstormContext?: { path?: string[]; marketRead?: string },
  ): Promise<Module1View> {
    const text = rawInput.trim();
    if (!text) return this.view();

    // VERBATIM FIRST — the inventor's own key concept, before any AI step. This is the
    // conception; it gets sealed as inventor_input.
    this.ledger.recordInventorSource("inventor_input", text, [
      "module1",
      "conception",
    ]);
    this.material.push(text);

    // The BRAINSTORM JOURNEY that produced this key concept = CONTEXT, never conception. The
    // AI generated the directions + market read; the human chose and narrowed. Recorded as a
    // machine event so the notebook shows the path they took, WITHOUT treating any of it as
    // human-conceived substance (the boundary that keeps the proof clean).
    if (brainstormContext?.path?.length || brainstormContext?.marketRead) {
      this.ledger.recordMachineEvent("agent_distilled", ["brainstorm-context"], {
        ...(brainstormContext.path?.length ? { path: brainstormContext.path } : {}),
        ...(brainstormContext.marketRead
          ? { marketRead: brainstormContext.marketRead }
          : {}),
      });
    }

    await this.buildStatement();
    return this.view();
  }

  /** Apply an explicit inventor action to a card. Nothing auto-accepts. */
  async act(
    cardId: string,
    input:
      | ReviewActionInput
      | ClarityAnswerInput
      | LeapInput
      | CandidateActionInput
      | BrainstormInput,
  ): Promise<Module1View> {
    const card = this.openCards.get(cardId);
    const intent = this.intents.get(cardId);
    if (!card || !intent) return this.view();

    switch (card.type) {
      case "review":
        await this.handleReview(cardId, intent, input as ReviewActionInput);
        break;
      case "code_review":
        this.handleCode(cardId, input as ReviewActionInput);
        break;
      case "clarity":
        await this.handleClarity(cardId, input as ClarityAnswerInput);
        break;
      case "leap":
        await this.handleLeap(cardId, intent, input as LeapInput);
        break;
      case "candidate_concept":
        await this.handleCandidate(cardId, intent, input as CandidateActionInput);
        break;
      case "brainstorm":
        await this.handleBrainstorm(cardId, input as BrainstormInput);
        break;
    }
    this.maybeCheckpoint();
    return this.view();
  }

  /** Seal a Checkpoint to the Ledger the moment the Concept set is finalized. */
  private maybeCheckpoint(): void {
    if (this.isComplete() && !hasCheckpoint(this.ledger, "module1")) {
      sealCheckpoint(this.ledger, "module1");
    }
  }

  /**
   * The inventor talks to the Helper in free text (the always-on composer). The
   * Helper is the core teaching presence: it READS what the inventor means
   * before acting, always REPLIES in words (never a silent no-op), and routes:
   *  - a QUESTION → it teaches (explains what's thin, why it matters, what kind
   *    of detail would strengthen it) and ASKS — it never invents the substance;
   *  - an EDIT → it revises the reading via the reviser;
   *  - a NEW_IDEA / ANSWER → it records the inventor's words verbatim as theirs
   *    and folds them back into the reading.
   * The intent is decided by understanding the inventor, NOT by the phase.
   */
  async tell(text: string): Promise<Module1View> {
    const t = text.trim();
    if (!t) return this.view();

    // The very first words are the raw idea — capture + distill (acknowledgment).
    if (this.phase === "ingesting") return this.ingest(t);

    // Verbatim-first: the composer message is recorded before any AI step.
    const noteEntry = this.ledger.recordInventorSource("inventor_note", t, [
      "composer",
      this.phase,
    ]);
    this.pushTurn({ role: "inventor", text: t });

    // The Helper brain reads the full context and decides what the inventor means.
    const helper = await this.runHelperBrain(t);
    const intent = helper?.intent ?? this.fallbackIntent();
    this.pushTurn({
      role: "helper",
      text: helper?.reply ?? this.fallbackReply(intent),
      ...(helper?.question?.ask ? { question: helper.question } : {}),
      intent,
    });

    // A question (or aside) teaches only — nothing is mutated. This is the path
    // that used to be a no-op "Revised at your request"; now it actually helps.
    if (intent === "question" || intent === "other") {
      return this.view();
    }

    if (this.phase === "reviewing_statement") {
      if (intent === "edit") {
        await this.reviseStatement(t);
      } else {
        // new_idea / answer — the inventor's own substance, folded into the core.
        this.ledger.recordInventorSource(
          intent === "answer" ? "clarity_answer" : "leap_input",
          t,
          intent === "answer" ? ["composer", "factual"] : ["composer", "inventor_conceived"],
        );
        this.material.push(t);
        await this.buildStatement();
      }
      return this.view();
    }

    // confirming_concepts / complete — a new inventor-authored idea/concept.
    this.material.push(t);
    await this.materializeLeapConcept(t, noteEntry.id, "");
    if (this.phase === "complete") this.phase = "confirming_concepts";
    return this.view();
  }

  /** Run the Helper brain over the current context. Null if the call fails. */
  private async runHelperBrain(message: string) {
    try {
      return await runHelper(this.runAgent, {
        message,
        phase: this.phase,
        core: this.statementText,
        strong: this.strong,
        thin: this.thin,
        setAside: this.setAside,
        concepts: this.activeConcepts().map((c) => ({
          title: c.title,
          statement: c.formalized_statement,
        })),
        conversation: this.conversation.slice(-6).map((tn) => ({ role: tn.role, text: tn.text })),
        inventorMaterial: this.material.join("\n"),
        consciousness: this.consciousness.renderForAgent({ part: CORE_PART }),
        onScreen: renderScreenCards([...this.openCards.values()]),
      });
    } catch (err) {
      console.error("[conception] helper brain failed", err);
      return null;
    }
  }

  /** Revise the current reading per the inventor's instruction (the edit channel). */
  private async reviseStatement(instruction: string): Promise<void> {
    this.ledger.recordInventorSource("inventor_edit", instruction, ["statement", "instruction"]);
    let revisedOk = false;
    try {
      const revised = await runReviser(this.runAgent, {
        current: this.statementText,
        instruction,
        consciousness: this.consciousness.renderForAgent({ part: CORE_PART }),
      });
      if (revised.core_statement?.trim()) {
        this.statementText = revised.core_statement;
        revisedOk = true;
      }
      this.ledger.recordMachineEvent("agent_distilled", ["revision"]);
    } catch (err) {
      console.error("[conception] reviser failed", err);
    }
    this.statementApproved = false;
    this.emitReadingCard();
    if (revisedOk) await this.syncCoreToConsciousness({ agent: "reviser" });
  }

  /** When the Helper brain is unavailable, fall back to the old phase default. */
  private fallbackIntent(): "edit" | "new_idea" {
    return this.phase === "reviewing_statement" ? "edit" : "new_idea";
  }

  private fallbackReply(intent: string): string {
    return intent === "edit"
      ? "I’ll update the reading with that."
      : "I’ve recorded that in your own words.";
  }

  /** Append a turn to the Helper conversation. */
  private pushTurn(turn: Omit<HelperTurn, "timestamp">): void {
    this.conversation.push({ ...turn, timestamp: this.now() });
  }

  view(): Module1View {
    return {
      phase: this.phase,
      cards: [...this.openCards.values()],
      conversation: this.conversation.map((t) => ({ ...t })),
      ...(this.statementText
        ? { statement: { text: this.statementText, approved: this.statementApproved } }
        : {}),
      ...(this.representativeCode
        ? {
            representativeCode: {
              language: this.representativeCode.language,
              code: this.representativeCode.code,
              approved: this.codeApproved,
            },
          }
        : {}),
      concepts: this.snapshotConcepts(),
      ledger: this.ledger.serialize(),
      complete: this.isComplete(),
    };
  }

  /** The deliverable: the concept objects. Call once `view().complete`. */
  finish(): ConceptObject[] {
    if (!this.isComplete()) {
      throw new Error(
        "Module 1: cannot finish — the inventor has not confirmed every surviving concept.",
      );
    }
    this.ledger.recordMachineEvent("module_completed", ["module1"], {
      conceptCount: this.activeConcepts().length,
    });
    this.phase = "complete";
    return this.snapshotConcepts();
  }

  /** Current concepts (snapshot) — used to hand off to Maturation. */
  getConcepts(): ConceptObject[] {
    return this.snapshotConcepts();
  }

  /**
   * The representative code generated in Conception, if any. Carried all the way
   * to the Differentiation drafters — it is the most concrete implementation
   * detail in the pipeline and feeds the architecture/data-structures/operations
   * sections. A copy, so the engine's state stays immutable.
   */
  getRepresentativeCode(): { language: string; code: string } | null {
    return this.representativeCode ? { ...this.representativeCode } : null;
  }

  /** The full evidence ledger — the verbatim proof trail. */
  ledgerEntries() {
    return this.ledger.serialize();
  }

  /* ------------------------------------------------------------------ *
   * Durable persistence (snapshot ⇄ restore)
   * ------------------------------------------------------------------ */

  toSnapshot(): ConceptionSnapshot {
    return {
      material: [...this.material],
      phase: this.phase,
      statementText: this.statementText,
      statementApproved: this.statementApproved,
      representativeCode: this.representativeCode
        ? { ...this.representativeCode }
        : null,
      codeApproved: this.codeApproved,
      concepts: this.snapshotConcepts(),
      confirmed: [...this.confirmed],
      openCards: [...this.openCards.values()],
      intents: [...this.intents.entries()],
      ledger: this.ledger.serialize(),
      conversation: this.conversation.map((t) => ({ ...t })),
      strong: [...this.strong],
      thin: [...this.thin],
      setAside: [...this.setAside],
    };
  }

  static fromSnapshot(
    snap: ConceptionSnapshot,
    deps: ConceptionDeps,
  ): ConceptionModule {
    const now = deps.now ?? (() => new Date().toISOString());
    const genId = deps.genId ?? defaultGenId;
    const ledger = EvidenceLedger.fromEntries(
      snap.ledger,
      MODULE1_HUMAN_SOURCE_TYPES,
      now,
      genId,
    );
    const m = new ConceptionModule({ ...deps, ledger });
    m.material = [...snap.material];
    m.phase = snap.phase;
    m.statementText = snap.statementText;
    m.statementApproved = snap.statementApproved;
    m.representativeCode = snap.representativeCode;
    m.codeApproved = snap.codeApproved;
    m.concepts = new Map(snap.concepts.map((c) => [c.id, c]));
    m.confirmed = new Set(snap.confirmed);
    m.openCards = new Map(snap.openCards.map((c) => [c.id, c]));
    m.intents = new Map(snap.intents);
    m.conversation = snap.conversation ? snap.conversation.map((t) => ({ ...t })) : [];
    m.strong = snap.strong ? [...snap.strong] : [];
    m.thin = snap.thin ? [...snap.thin] : [];
    m.setAside = snap.setAside ? [...snap.setAside] : [];
    return m;
  }

  /** The live ledger instance — threaded into Maturation so the notebook is one
   *  continuous trail across modules. */
  ledgerInstance(): EvidenceLedger {
    return this.ledger;
  }

  /** The live Shared Consciousness — persisted at top-level so it is one
   *  continuous draft memory across modules. */
  consciousnessInstance(): SharedConsciousness {
    return this.consciousness;
  }

  /* ------------------------------------------------------------------ *
   * Turn 1 — the formalized restatement (acknowledgment)
   * ------------------------------------------------------------------ */

  private async buildStatement(): Promise<void> {
    // Distill — cut the inventor's input down to its core conception (stripping
    // over-built/late-stage detail). This must transform the input, not echo it.
    const distilled = await runDistiller(this.runAgent, {
      verbatim: this.material,
    });
    this.ledger.recordMachineEvent("agent_distilled", ["statement"], {
      setAside: distilled.set_aside.length,
    });
    this.statementText = distilled.core_statement;
    this.statementApproved = false;

    // Remember the read so the Helper can teach about it from the composer.
    this.strong = [...distilled.strong];
    this.thin = [...distilled.thin];
    this.setAside = [...distilled.set_aside];

    // Drop any prior reading/spark cards (re-reading after an answer or edit).
    this.clearIntents(["statement", "clarity", "leap"]);

    // Light first read-back: just the clean restatement to confirm. The
    // strong / thin / set-aside read is stored (this.strong/thin/setAside) and
    // surfaced through the Helper on demand ("what's weak?") — we don't dump a
    // wall of analysis at the start. Keeps step one easy.
    this.emitReadingCard();
    // No question here — the first response is acknowledgment only. Spark
    // capture (asking for a missing core) happens later, after the inventor has
    // acknowledged the reading and the concepts are split.

    // Mirror the reading into the Shared Consciousness and cross-verify it.
    await this.syncCoreToConsciousness({
      agent: "distiller",
      gapKind: distilled.gap_kind,
      gapMissing: distilled.gap_missing,
    });
  }

  /**
   * Mirror the current core reading into the Shared Consciousness and have a
   * DIFFERENT agent (the verifier) cross-check it against the inventor's own
   * words. A revision supersedes the prior core (propagating staleness to
   * anything downstream); a detected inventive gap is stored as a hidden
   * open_question that the human is never shown.
   */
  private async syncCoreToConsciousness(opts: {
    agent: "distiller" | "reviser";
    gapKind?: "none" | "factual" | "inventive";
    gapMissing?: string;
  }): Promise<void> {
    if (!this.statementText.trim()) return;
    const prior = this.consciousness.current(CORE_PART);
    const entry = this.consciousness.record({
      part: CORE_PART,
      content: this.statementText,
      why:
        opts.agent === "reviser"
          ? "revised per the inventor's instruction"
          : "distilled from the inventor's verbatim material",
      agent: opts.agent,
      tracesTo: this.ledger.humanVerbatim().map((e) => e.id),
      ...(prior ? { supersedes: prior.id } : {}),
    });

    if (opts.gapKind === "inventive" && opts.gapMissing?.trim()) {
      this.consciousness.record({
        part: CORE_PART,
        kind: "open_question",
        content: opts.gapMissing,
        why: "a possible inventive point the system detected; must NOT be revealed to the inventor",
        agent: opts.agent,
      });
    }

    try {
      const verdict = await runVerifier(this.runAgent, {
        piece: this.statementText,
        inventorMaterial: this.material.join("\n"),
        consciousness: this.consciousness.renderForAgent({ part: CORE_PART }),
      });
      this.consciousness.verify(entry.id, {
        by: "verifier",
        verdict: verdict.verdict,
        ...(verdict.note ? { note: verdict.note } : {}),
      });
    } catch (err) {
      console.error("[conception] verifier failed", err);
    }
  }

  /** Emit (or re-emit) the reading card from the current statement text. */
  private emitReadingCard(notes: string[] = []): void {
    this.clearIntents(["statement"]);
    const id = this.genId();
    const card: ReviewCard = {
      id,
      type: "review",
      kind: "restatement",
      title: "Here's what I understood — did I get it?",
      body: this.statementText,
      ...(notes.length ? { notes } : {}),
      actions: ["approve", "discard"],
    };
    this.openCards.set(id, card);
    this.intents.set(id, { kind: "statement" });
    this.phase = "reviewing_statement";
  }

  /* ------------------------------------------------------------------ *
   * After approval — representative code + decomposition into concepts
   * ------------------------------------------------------------------ */

  private async generateCode(): Promise<void> {
    const result = await runCodeGenerator(this.runAgent, {
      statement: this.statementText,
      verbatim: this.material,
    });
    this.ledger.recordMachineEvent("agent_code_generated", ["code"], {
      language: result.language,
      gaps: result.inventive_gaps.length,
    });
    // Any spots needing an inventive choice are left as labeled placeholders in
    // the code itself — we don't interrupt conception to demand them.
    if (!result.code.trim()) return;
    this.representativeCode = { language: result.language, code: result.code };
    this.codeApproved = false;
    const id = this.genId();
    const card: CodeReviewCard = {
      id,
      type: "code_review",
      title: "Representative code — does this illustrate your idea?",
      language: result.language,
      code: result.code,
      actions: ["approve", "discard", "request_edit"],
    };
    this.openCards.set(id, card);
    this.intents.set(id, { kind: "code" });
  }

  /** Decompose the approved idea into distinct concepts. */
  private async buildConcepts(): Promise<void> {
    // Conception only ORGANIZES what the inventor already stated — every pass
    // RESTATES their own words (no invention), so there is nothing to gate here.
    // V1-style breadth: three passes so one rich idea yields the COMPLETE set of
    // distinct concepts, not just 1–2.
    //   1. Decomposer (exhaustive) — the literal split into every distinct element.
    //   2. Advocate (generous)     — distinct concepts the first pass under-split.
    //   3. Examiner (skeptical)    — consolidate: merge dupes, split bundles,
    //                                complete gaps → the final clean concept set.
    // IMPORTANT: extract from the inventor's FULL raw material, not the distilled
    // core — the distiller deliberately strips detail (its set_aside pile), and
    // extracting from that compressed paragraph would cap breadth before we start.
    // Raw words also make the source_excerpts line up with the verbatim ledger.
    const material = this.material.join("\n\n") || this.statementText;
    const decomposed = await runDecomposer(this.runAgent, { material });
    let candidates = [...decomposed.concepts];

    try {
      const advocated = await runAdvocate(this.runAgent, {
        material,
        candidates: candidates.map((c) => ({ title: c.title, restatement: c.restatement })),
      });
      candidates = [...candidates, ...advocated.concepts];
    } catch (err) {
      console.error("[conception] advocate pass failed", err);
    }

    // Deduped union of the literal split + the advocate's additions. This is the
    // FLOOR: we never end up with fewer concepts than this, so an over-eager
    // Examiner can't silently collapse the breadth we just surfaced.
    const union = dedupeConceptsByTitle(candidates);

    let finalConcepts = union;
    try {
      const examined = await runExaminer(this.runAgent, {
        material,
        candidates: union.map((c) => ({ title: c.title, restatement: c.restatement })),
      });
      // Accept the Examiner's consolidation only if it didn't drop below the
      // literal split (merging true duplicates is fine; losing distinct elements
      // is not). Otherwise keep the deduped union.
      if (examined.concepts.length >= decomposed.concepts.length) {
        finalConcepts = examined.concepts;
      } else if (examined.concepts.length) {
        console.warn(
          `[conception] examiner returned ${examined.concepts.length} concepts vs ${decomposed.concepts.length} from the decomposer — keeping the deduped union to preserve breadth`,
        );
      }
    } catch (err) {
      console.error("[conception] examiner consolidation failed", err);
    }

    // #4 — Inventorship verification. The advocate/examiner passes are told to
    // restate-only, but nothing trusted that. An INDEPENDENT check (the verifier,
    // on a different model than the passes above) now confirms each concept's
    // restatement traces to the inventor's own words; a concept that introduces
    // unsupported substance is dropped before it can enter the proof set.
    finalConcepts = await this.verifyConceptFidelity(finalConcepts);

    this.ledger.recordMachineEvent("agent_decomposed", ["concepts"], {
      count: finalConcepts.length,
    });
    const safe: SafeConcept[] = finalConcepts.map((c) => ({
      title: c.title,
      restatement: c.restatement,
      source_excerpts: c.source_excerpts,
    }));
    await this.materializeConcepts(safe);
  }

  /**
   * Independent fidelity check on the generated concept set. Each concept is
   * cross-verified (FAIL-CLOSED, on a different model than the generating passes)
   * against the inventor's full material; one that introduces substance the
   * inventor never stated is dropped, with the reason logged to the ledger.
   *
   * Two safety nets so this protects inventorship WITHOUT eating breadth:
   *  - an infrastructure error on a check KEEPS the concept (never drop on a glitch);
   *  - if every concept somehow fails (a fail-closed misfire), keep the whole set.
   */
  private async verifyConceptFidelity(concepts: SafeConcept[]): Promise<SafeConcept[]> {
    if (concepts.length <= 1) return concepts;
    const material = this.material.join("\n");
    const consciousness = this.consciousness.renderForAgent({ part: CORE_PART });
    const checked = await Promise.all(
      concepts.map(async (c): Promise<SafeConcept | null> => {
        try {
          const verdict = await runVerifier(this.runAgent, {
            piece: `${c.title}: ${c.restatement}`,
            inventorMaterial: material,
            consciousness,
          });
          if (verdict.verdict === "fail") {
            this.ledger.recordMachineEvent("agent_verified", ["concepts", "dropped"], {
              title: c.title,
              ...(verdict.note ? { note: verdict.note } : {}),
            });
            return null;
          }
          return c;
        } catch (err) {
          console.error("[conception] concept fidelity check failed (kept)", c.title, err);
          return c;
        }
      }),
    );
    const kept = checked.filter((c): c is SafeConcept => c !== null);
    if (!kept.length) {
      console.warn("[conception] fidelity check failed every concept — keeping the set");
      return concepts;
    }
    this.ledger.recordMachineEvent("agent_verified", ["concepts"], {
      kept: kept.length,
      dropped: concepts.length - kept.length,
    });
    return kept;
  }

  /**
   * Brainstorm candidate patentable DIRECTIONS from the inventor's own idea and
   * teach what tends to make each registrable. This is the anti-black-box move:
   * the Helper points at where the value could be and explains the principle,
   * then hands the pen back — the inventor develops the directions they choose,
   * in their own words (captured verbatim as theirs). Best-effort: a failure
   * here never blocks the flow.
   */
  private async brainstormDirections(): Promise<void> {
    try {
      const result = await runBrainstorm(this.runAgent, {
        core: this.statementText,
        concepts: this.activeConcepts().map((c) => ({
          title: c.title,
          statement: c.formalized_statement,
        })),
        inventorMaterial: this.material.join("\n"),
        consciousness: this.consciousness.renderForAgent({ part: CORE_PART }),
      });
      if (!result.directions.length) return;
      const id = this.genId();
      const card: BrainstormCard = {
        id,
        type: "brainstorm",
        intro: result.intro || "A few directions in your idea that tend to be worth developing:",
        directions: result.directions,
      };
      this.openCards.set(id, card);
      this.intents.set(id, { kind: "brainstorm" });
      // A short intro in the conversation so it reads as a brainstorm, not a
      // silent card drop. The directions themselves live on the card below (with
      // their own per-direction "Develop this") — we don't repeat them as text.
      this.pushTurn({
        role: "helper",
        text:
          result.intro ||
          "I pulled out a few directions in your idea worth developing — pick any below to develop in your own words.",
        intent: "other",
      });
    } catch (err) {
      console.error("[conception] brainstorm failed", err);
    }
  }

  /* ------------------------------------------------------------------ *
   * Action handlers
   * ------------------------------------------------------------------ */

  private async handleReview(
    cardId: string,
    intent: Intent,
    input: ReviewActionInput,
  ): Promise<void> {
    if (intent.kind === "statement") {
      this.ledger.recordDecision("review_action", ["statement", input.action]);
      if (input.action === "approve") {
        this.statementApproved = true;
        this.resolveCard(cardId);
        // Any unanswered Spark was optional — clear it on approval.
        this.clearIntents(["clarity", "leap"]);
        // Advancing a phase starts the Helper area fresh — the teaching about the
        // reading is done once it's approved (it stays in the Notebook as record).
        this.conversation = [];
        // Only now: illustrate with code and decompose into distinct concepts.
        await this.generateCode();
        await this.buildConcepts();
        this.phase = "confirming_concepts";
        // Then brainstorm WITH the inventor — surface candidate patentable
        // directions from their own idea and teach what tends to make each
        // registrable, so the inventor can develop the ones they want.
        await this.brainstormDirections();
      } else if (input.action === "discard") {
        this.resolveCard(cardId);
        this.statementText = "";
        this.conversation = [];
        this.phase = "ingesting";
      } else {
        // request_edit — capture the correction verbatim, re-formalize.
        this.resolveCard(cardId);
        this.ledger.recordInventorSource("inventor_edit", input.correction, [
          "statement",
          "correction",
        ]);
        this.material.push(input.correction);
        await this.buildStatement();
      }
      return;
    }

    if (intent.kind === "confirm_addition") {
      if (input.action === "approve") {
        this.ledger.recordDecision("addition_confirmed", ["formalizer-addition"]);
        this.acceptAddition(intent.conceptId, intent.addition);
      } else if (input.action === "discard") {
        this.ledger.recordDecision("addition_rejected", ["formalizer-addition"]);
      } else {
        this.ledger.recordInventorSource("inventor_edit", input.correction, [
          "formalizer-addition",
          "correction",
        ]);
        this.material.push(input.correction);
        this.addHumanPart(intent.conceptId, input.correction);
      }
      this.resolveCard(cardId);
    }
  }

  private handleCode(cardId: string, input: ReviewActionInput): void {
    this.ledger.recordDecision("code_action", ["code", input.action]);
    if (input.action === "approve") {
      this.codeApproved = true;
    } else if (input.action === "discard") {
      this.representativeCode = null;
    } else {
      // request_edit — the inventor's own code/correction, captured verbatim.
      this.ledger.recordInventorSource("inventor_edit", input.correction, [
        "code",
        "correction",
      ]);
      this.material.push(input.correction);
      if (this.representativeCode) this.representativeCode.code = input.correction;
      this.codeApproved = true;
    }
    this.resolveCard(cardId);
  }

  // A factual Spark answer — captured verbatim, then re-read into the core.
  private async handleClarity(
    cardId: string,
    input: ClarityAnswerInput,
  ): Promise<void> {
    const answer = input.answer.trim();
    this.resolveCard(cardId);
    if (!answer) return;
    this.ledger.recordInventorSource("clarity_answer", answer, ["spark", "factual"]);
    this.material.push(answer);
    if (this.phase === "reviewing_statement") await this.buildStatement();
  }

  // An inventive Spark — the inventor's own new idea, verbatim, then re-read in.
  private async handleLeap(
    cardId: string,
    intent: Intent,
    input: LeapInput,
  ): Promise<void> {
    const idea = input.idea.trim();
    this.resolveCard(cardId);
    if (!idea) return;
    const element = intent.kind === "leap" ? intent.inventiveElement : "";
    this.ledger.recordInventorSource("leap_input", idea, [
      "spark",
      "inventive",
      "inventor_conceived",
      ...(element ? [`element:${element}`] : []),
    ]);
    this.material.push(idea);
    if (this.phase === "reviewing_statement") await this.buildStatement();
  }

  private async handleCandidate(
    cardId: string,
    intent: Intent,
    input: CandidateActionInput,
  ): Promise<void> {
    if (intent.kind !== "candidate") return;
    const concept = this.concepts.get(intent.conceptId);
    if (!concept) return;
    this.ledger.recordDecision("candidate_action", ["candidate", input.action], {
      conceptId: concept.id,
      action: input.action,
    });

    if (input.action === "keep") {
      concept.status = { state: "active" };
      this.confirmed.add(concept.id);
    } else if (input.action === "drop") {
      concept.status = { state: "dropped" };
      this.confirmed.delete(concept.id);
    } else {
      const target = this.concepts.get(input.into);
      if (target) {
        target.conception_trail.push(...concept.conception_trail);
        // REGENERATE the combined idea: fold both concepts into one coherent statement
        // (both are the inventor's own — this is a faithful synthesis, NOT new substance).
        try {
          const revised = await runReviser(this.runAgent, {
            current: target.formalized_statement,
            instruction: `Merge in this second concept the inventor also owns, keeping BOTH ideas together as ONE coherent concept. Combine them faithfully — add NO new inventive substance, invent nothing. The concept to fold in: "${concept.formalized_statement}"`,
            consciousness: this.consciousness.renderForAgent({ part: CORE_PART }),
          });
          if (revised.core_statement?.trim()) {
            target.formalized_statement = revised.core_statement.trim();
            // If the target is still an open candidate card, refresh it so the card shows
            // the newly combined idea, not the pre-merge statement.
            for (const c of this.openCards.values()) {
              if (c.type === "candidate_concept" && c.conceptId === target.id) {
                c.statement = target.formalized_statement;
              }
            }
          }
          this.ledger.recordMachineEvent("agent_distilled", ["merge"]);
        } catch (err) {
          console.error("[conception] merge synthesis failed", err);
        }
      }
      concept.status = { state: "merged_into", into: input.into };
      this.confirmed.delete(concept.id);
    }
    this.ledger.recordMachineEvent("concept_status_changed", ["candidate"], {
      conceptId: concept.id,
      status: concept.status,
    });
    this.resolveCard(cardId);
  }

  /**
   * The inventor acts on the brainstorm card. "develop" captures their own words
   * for a chosen direction VERBATIM (inventor_conceived) and turns them into a
   * concept — the substance is theirs, the Helper only pointed at the angle. The
   * card stays open so they can develop more directions. "dismiss" clears it.
   */
  private async handleBrainstorm(cardId: string, input: BrainstormInput): Promise<void> {
    if (input.action === "dismiss") {
      this.resolveCard(cardId);
      return;
    }
    const text = input.text.trim();
    if (!text) return;
    const entry = this.ledger.recordInventorSource("leap_input", text, [
      "brainstorm",
      "inventor_conceived",
      `direction:${input.direction}`,
    ]);
    this.pushTurn({ role: "inventor", text });
    this.material.push(text);
    // The tutor conversation that led here = CONTEXT (the AI taught, the human conceived).
    // Recorded as a machine event so the journey is in the notebook, never as conception.
    if (input.tutorTranscript?.length) {
      this.ledger.recordMachineEvent(
        "agent_distilled",
        ["tutor-context", `direction:${input.direction}`],
        { transcript: input.tutorTranscript },
      );
    }
    await this.materializeLeapConcept(text, entry.id, input.direction);
    // Mark this direction as developed so the card shows it done (and doesn't
    // re-offer it). The card stays open for the OTHER directions. Persists in the
    // snapshot, so "done" survives a reload.
    const card = this.openCards.get(cardId);
    if (card && card.type === "brainstorm") {
      card.developed = Array.from(new Set([...(card.developed ?? []), input.direction]));
    }
  }

  /* ------------------------------------------------------------------ *
   * Concept construction
   * ------------------------------------------------------------------ */

  private async materializeConcepts(safe: SafeConcept[]): Promise<void> {
    for (const s of safe) {
      const trail = this.trailFor(s.source_excerpts);
      const formalized = await runFormalizer(this.runAgent, {
        verbatim: s.source_excerpts.length ? s.source_excerpts : [s.restatement],
      });
      this.ledger.recordMachineEvent("agent_formalized", ["concept"], {
        title: s.title,
        additions: formalized.added_substance.length,
      });

      const id = this.genId();
      const provenance: ConceptProvenancePart[] = [
        {
          excerpt: formalized.formalized_statement,
          provenance: "system_formalized",
          derivedFrom: trail.map((t) => t.ledgerId),
        },
      ];
      const concept: ConceptObject = {
        id,
        title: s.title,
        formalized_statement: formalized.formalized_statement,
        conception_trail: trail,
        provenance,
        status: { state: "active" },
      };
      this.concepts.set(id, concept);
      this.ledger.recordMachineEvent("concept_created", ["concept"], { id, title: s.title });

      this.emitCandidate(concept);
      await this.recordConceptToConsciousness(concept);
      await this.screenAdditions(id, formalized.added_substance);
    }
  }

  /**
   * Record a split Concept to the Shared Consciousness and cross-verify it (a
   * DIFFERENT agent than the formalizer that wrote it). Each Concept is its own
   * `concept:<id>` part, so Maturation can later supersede it with the deepened
   * version and stale-propagation chains across modules.
   */
  private async recordConceptToConsciousness(concept: ConceptObject): Promise<void> {
    if (!concept.formalized_statement.trim()) return;
    const part = `concept:${concept.id}`;
    const entry = this.consciousness.record({
      part,
      content: concept.formalized_statement,
      why: `concept "${concept.title}" — formalized from the inventor's material`,
      agent: "formalizer",
      tracesTo: concept.conception_trail.map((t) => t.ledgerId),
    });
    try {
      const verdict = await runVerifier(this.runAgent, {
        piece: concept.formalized_statement,
        inventorMaterial:
          concept.conception_trail.map((t) => t.verbatim_text).join("\n") ||
          this.material.join("\n"),
        consciousness: this.consciousness.renderForAgent({ part }),
      });
      this.consciousness.verify(entry.id, {
        by: "verifier",
        verdict: verdict.verdict,
        ...(verdict.note ? { note: verdict.note } : {}),
      });
    } catch (err) {
      console.error("[conception] concept verify failed", concept.id, err);
    }
  }

  /** The Boundary's classifier, backed by the boundary-classifier agent. */
  private boundaryClassifier(): BoundaryClassifier {
    return async ({ content, inventorMaterial }) => {
      const r = await runBoundaryClassifier(this.runAgent, { content, inventorMaterial });
      const withhold = r.classification === "inventive" && !r.safe_to_surface;
      return {
        classification: withhold ? "withhold" : "surface",
        inventiveElement: r.inventive_element,
        reason: r.reason,
      };
    };
  }

  /**
   * Screen the formalizer's AI-suggested additions through the Boundary. A
   * surface-able tidy is offered to the inventor to confirm; a genuinely-new
   * inventive addition is WITHHELD — never shown — and held as a hidden
   * open_question for later Socratic steering (the inventor must supply it).
   */
  private async screenAdditions(
    conceptId: string,
    additions: { text: string; why_needed: string }[],
  ): Promise<void> {
    if (!additions.length) return;
    const classify = this.boundaryClassifier();
    const inventorMaterial = this.material.join("\n");
    for (const add of additions) {
      const verdict = await screen(classify, add.text, inventorMaterial);
      if (verdict.allowed) {
        this.emitConfirmAddition(conceptId, add.text, add.why_needed);
      } else {
        this.consciousness.record({
          part: `concept:${conceptId}`,
          kind: "open_question",
          content: verdict.inventiveElement || add.text,
          why: `Boundary withheld an inventive addition (never shown): ${verdict.reason}`,
          agent: "boundary",
        });
        this.ledger.recordMachineEvent("agent_classified", ["boundary", "withheld"], {
          conceptId,
        });
      }
    }
  }

  private async materializeLeapConcept(
    idea: string,
    leapEntryId: string,
    element: string,
  ): Promise<void> {
    const formalized = await runFormalizer(this.runAgent, { verbatim: [idea] });
    this.ledger.recordMachineEvent("agent_formalized", ["leap-concept"], {
      additions: formalized.added_substance.length,
    });
    const id = this.genId();
    const trail: ConceptionTrailItem[] = [
      {
        ledgerId: leapEntryId,
        verbatim_text: idea,
        timestamp: this.ledger.get(leapEntryId)?.timestamp ?? this.now(),
      },
    ];
    const concept: ConceptObject = {
      id,
      title: element || "Inventor-supplied idea",
      formalized_statement: formalized.formalized_statement,
      conception_trail: trail,
      provenance: [
        {
          excerpt: formalized.formalized_statement,
          provenance: "inventor_conceived",
          derivedFrom: [leapEntryId],
        },
      ],
      status: { state: "active" },
    };
    this.concepts.set(id, concept);
    this.ledger.recordMachineEvent("concept_created", ["leap-concept"], { id });
    // The inventor authored this in their OWN words — it is theirs, so it goes
    // straight into the concepts they own. We do NOT re-surface it as a
    // Keep/Drop/Merge candidate card: that review is for the AI-extracted
    // concepts, and asking the inventor to "keep" what they just wrote is
    // redundant and risks it being overlooked or dropped.
    this.confirmed.add(id);
    this.ledger.recordDecision("candidate_action", ["leap-concept", "keep"], {
      conceptId: id,
    });
    await this.recordConceptToConsciousness(concept);
    await this.screenAdditions(id, formalized.added_substance);
  }

  private acceptAddition(conceptId: string, addition: string): void {
    const concept = this.concepts.get(conceptId);
    if (!concept) return;
    concept.formalized_statement = `${concept.formalized_statement} ${addition}`.trim();
    concept.provenance.push({
      excerpt: addition,
      provenance: "system_suggested_accepted",
      derivedFrom: [],
    });
  }

  private addHumanPart(conceptId: string, text: string): void {
    const concept = this.concepts.get(conceptId);
    if (!concept) return;
    concept.formalized_statement = `${concept.formalized_statement} ${text}`.trim();
    concept.provenance.push({
      excerpt: text,
      provenance: "inventor_conceived",
      derivedFrom: [],
    });
  }

  /* ------------------------------------------------------------------ *
   * Card emission helpers
   * ------------------------------------------------------------------ */

  /** A factual Spark — one plain clarifying question. */
  private emitClarity(question: string, whyItMatters?: string): void {
    const id = this.genId();
    const card: ClarityCard = {
      id,
      type: "clarity",
      question,
      ...(whyItMatters ? { whyItMatters } : {}),
    };
    this.openCards.set(id, card);
    this.intents.set(id, { kind: "clarity" });
  }

  /** An inventive Spark — the only path for new inventive content; inventor's words. */
  private emitLeap(inventiveElement: string, context: string): void {
    const id = this.genId();
    const card: LeapCard = { id, type: "leap", context, inventiveElement };
    this.openCards.set(id, card);
    this.intents.set(id, { kind: "leap", inventiveElement });
  }

  private emitCandidate(concept: ConceptObject): void {
    const id = this.genId();
    const card: CandidateConceptCard = {
      id,
      type: "candidate_concept",
      conceptId: concept.id,
      title: concept.title,
      statement: concept.formalized_statement,
      actions: ["keep", "drop", "merge"],
    };
    this.openCards.set(id, card);
    this.intents.set(id, { kind: "candidate", conceptId: concept.id });
  }

  private emitConfirmAddition(
    conceptId: string,
    addition: string,
    whyNeeded: string,
  ): void {
    const id = this.genId();
    const card: ReviewCard = {
      id,
      type: "review",
      kind: "confirm_addition",
      title: "I had to add something — is this yours to keep?",
      body: `To make this concept read cleanly I added: "${addition}". ${whyNeeded} It is not yet part of your record. Approve only if it is genuinely what you meant; otherwise discard it or rewrite it in your own words.`,
      addition,
      relatesToConceptId: conceptId,
      actions: ["approve", "discard", "request_edit"],
    };
    this.openCards.set(id, card);
    this.intents.set(id, { kind: "confirm_addition", conceptId, addition });
  }

  /* ------------------------------------------------------------------ *
   * Bookkeeping & completion
   * ------------------------------------------------------------------ */

  private resolveCard(cardId: string): void {
    this.openCards.delete(cardId);
    this.intents.delete(cardId);
  }

  private clearIntents(kinds: Array<Intent["kind"]>): void {
    for (const [id, intent] of this.intents) {
      if (kinds.includes(intent.kind)) this.resolveCard(id);
    }
  }

  private isComplete(): boolean {
    if (this.phase === "ingesting" || this.phase === "reviewing_statement") {
      return false;
    }
    const hasOpenBlocking = [...this.intents.values()].some(
      (i) =>
        i.kind === "statement" ||
        i.kind === "code" ||
        i.kind === "candidate" ||
        i.kind === "leap" ||
        i.kind === "confirm_addition",
    );
    if (hasOpenBlocking) return false;
    const active = this.activeConcepts();
    if (active.length === 0) return false;
    return active.every((c) => this.confirmed.has(c.id));
  }

  private activeConcepts(): ConceptObject[] {
    return [...this.concepts.values()].filter((c) => c.status.state === "active");
  }

  private snapshotConcepts(): ConceptObject[] {
    return [...this.concepts.values()].map((c) => ({
      ...c,
      conception_trail: c.conception_trail.map((t) => ({ ...t })),
      provenance: c.provenance.map((p) => ({ ...p, derivedFrom: [...p.derivedFrom] })),
    }));
  }

  private trailFor(sourceExcerpts: string[]): ConceptionTrailItem[] {
    const human = this.ledger.humanVerbatim();
    const matched = human.filter((e) => {
      const v = (e.verbatim_text ?? "").toLowerCase();
      return sourceExcerpts.some((ex) => {
        const x = ex.toLowerCase().trim();
        return x.length > 0 && (v.includes(x) || x.includes(v));
      });
    });
    const entries = matched.length > 0 ? matched : human.slice(-1);
    return entries.map((e) => ({
      ledgerId: e.id,
      verbatim_text: e.verbatim_text ?? "",
      timestamp: e.timestamp,
    }));
  }
}

/**
 * Merge candidate concepts that share a normalized title (same element surfaced by
 * more than one pass). Source excerpts are unioned and the fuller restatement kept.
 * Deterministic, in code — a reliable floor that never loses a distinct concept.
 */
function dedupeConceptsByTitle<
  T extends { title: string; restatement: string; source_excerpts: string[] },
>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const it of items) {
    const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...it, source_excerpts: [...it.source_excerpts] });
      continue;
    }
    existing.source_excerpts = [
      ...new Set([...existing.source_excerpts, ...it.source_excerpts]),
    ];
    if (it.restatement.length > existing.restatement.length) {
      existing.restatement = it.restatement;
    }
  }
  return [...seen.values()];
}

function defaultGenId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `c_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}
