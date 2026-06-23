import "server-only";
import {
  runBoundaryClassifier,
  runCodeGenerator,
  runDecomposer,
  runDistiller,
  runFormalizer,
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
import { MODULE1_HUMAN_SOURCE_TYPES } from "./types";
import type {
  CandidateActionInput,
  CandidateConceptCard,
  ClarityAnswerInput,
  ClarityCard,
  CodeReviewCard,
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
  async ingest(rawInput: string): Promise<Module1View> {
    const text = rawInput.trim();
    if (!text) return this.view();

    // VERBATIM FIRST — before any AI step.
    this.ledger.recordInventorSource("inventor_input", text, [
      "module1",
      "conception",
    ]);
    this.material.push(text);

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
      | CandidateActionInput,
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
        this.handleCandidate(cardId, intent, input as CandidateActionInput);
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
   * The inventor talks to the Helper in free text (the always-on composer), and
   * the Helper ACTS. While reviewing the core, the message is an instruction and
   * the Helper REVISES the reading per it (the edit channel). Once on concepts,
   * it adds a new idea in the inventor's own words. Never an interrogation.
   */
  async tell(text: string): Promise<Module1View> {
    const t = text.trim();
    if (!t) return this.view();

    if (this.phase === "ingesting") return this.ingest(t);

    if (this.phase === "reviewing_statement") {
      // The instruction is the inventor's words; the Helper revises the reading.
      this.ledger.recordInventorSource("inventor_edit", t, ["statement", "instruction"]);
      let revisedOk = false;
      try {
        const revised = await runReviser(this.runAgent, {
          current: this.statementText,
          instruction: t,
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
      this.emitReadingCard(["Revised at your request."]);
      if (revisedOk) await this.syncCoreToConsciousness({ agent: "reviser" });
      return this.view();
    }

    // confirming_concepts / complete — a new inventor-authored idea.
    const entry = this.ledger.recordInventorSource("leap_input", t, [
      "authored",
      "inventor_conceived",
    ]);
    this.material.push(t);
    await this.materializeLeapConcept(t, entry.id, "");
    if (this.phase === "complete") this.phase = "confirming_concepts";
    return this.view();
  }

  view(): Module1View {
    return {
      phase: this.phase,
      cards: [...this.openCards.values()],
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

    // Drop any prior reading/spark cards (re-reading after an answer or edit).
    this.clearIntents(["statement", "clarity", "leap"]);

    // The reading: restatement + what's strong + what's thin + what's deferred.
    const notes: string[] = [];
    for (const s of distilled.strong) notes.push(`Strong: ${s}`);
    for (const t of distilled.thin) notes.push(`Could be thin: ${t}`);
    if (distilled.set_aside.length)
      notes.push(`Set aside for later (not lost): ${distilled.set_aside.join("; ")}.`);

    this.emitReadingCard(notes);
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
      title: "Here's the core of your idea, as I understand it",
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

  /** Decompose the approved core into distinct concepts. */
  private async buildConcepts(): Promise<void> {
    // Conception only ORGANIZES what the inventor already stated — the distiller
    // and decomposer add nothing of their own, so there is no AI invention to
    // gate and nothing to demand. We do NOT stress-test the idea or ask the
    // inventor to specify mechanisms here (that is Maturation/Differentiation,
    // per the Module 1 exit bar). Just surface the distinct concepts.
    const core = this.statementText;
    const decomposed = await runDecomposer(this.runAgent, { material: core });
    this.ledger.recordMachineEvent("agent_decomposed", ["concepts"], {
      count: decomposed.concepts.length,
    });
    const safe: SafeConcept[] = decomposed.concepts.map((c) => ({
      title: c.title,
      restatement: c.restatement,
      source_excerpts: c.source_excerpts,
    }));
    await this.materializeConcepts(safe);
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
        // Only now: illustrate with code and decompose into distinct concepts.
        await this.generateCode();
        await this.buildConcepts();
        this.phase = "confirming_concepts";
      } else if (input.action === "discard") {
        this.resolveCard(cardId);
        this.statementText = "";
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

  private handleCandidate(
    cardId: string,
    intent: Intent,
    input: CandidateActionInput,
  ): void {
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
      if (target) target.conception_trail.push(...concept.conception_trail);
      concept.status = { state: "merged_into", into: input.into };
      this.confirmed.delete(concept.id);
    }
    this.ledger.recordMachineEvent("concept_status_changed", ["candidate"], {
      conceptId: concept.id,
      status: concept.status,
    });
    this.resolveCard(cardId);
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
    this.emitCandidate(concept);
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

function defaultGenId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `c_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}
