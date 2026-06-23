/**
 * Module 1 — Conception. Type contracts.
 *
 * Pure (no server-only imports) so both the Helper's client UI and the
 * server-side flow engine can import it. The cross-module currency (concept
 * objects, the ledger, the agent seam) is re-exported from the shared layer;
 * everything below the re-exports is Module-1-specific (its ledger vocabulary,
 * cards, action inputs, and view).
 *
 * Module 1 owns these shapes. It does NOT own the screen, the conversation
 * surface, the model transport, or the rendering of cards — those are the
 * Helper's. See README.md.
 */

import type {
  AgentRunner,
  ConceptObject,
  EvidenceLedger,
  LedgerEntry,
  SharedConsciousness,
} from "@/lib/modules/shared";

// Re-export the shared currency so existing imports from "./types" keep working.
export { statusLabel } from "@/lib/modules/shared";
export type {
  Provenance,
  ConceptStatus,
  ConceptionTrailItem,
  ConceptProvenancePart,
  ConceptObject,
  Origin,
  LedgerEntry,
  AppendOptions,
  AgentRunRequest,
  AgentRunner,
} from "@/lib/modules/shared";

/* ------------------------------------------------------------------ *
 * Module-1 ledger vocabulary
 * ------------------------------------------------------------------ */

/**
 * The event types Module 1 appends. `verbatim_text` is present whenever the
 * inventor is the source (see MODULE1_HUMAN_SOURCE_TYPES), stored exactly and
 * unedited, BEFORE any AI step touches it.
 */
export type LedgerEntryType =
  // Inventor as source — verbatim_text is always present:
  | "inventor_input" // raw submission of whatever they brought
  | "inventor_edit" // a correction supplied via a Request-edit action
  | "inventor_note" // a free-text note typed into the Helper composer
  | "clarity_answer" // verbatim answer to a Clarity card
  | "leap_input" // verbatim new inventive idea via a Leap card
  // Inventor decisions — explicit actions, never auto-accepted:
  | "review_action" // approve / discard / request_edit on a Review card
  | "candidate_action" // keep / drop / merge on a Candidate concept card
  | "code_action" // approve / discard / request_edit on a Code review card
  | "addition_confirmed" // inventor confirmed an AI-suggested addition
  | "addition_rejected" // inventor rejected an AI-suggested addition
  // Machine events — origin "machine", no inventor verbatim:
  | "agent_distilled"
  | "agent_decomposed"
  | "agent_examined"
  | "agent_clarified"
  | "agent_classified"
  | "agent_formalized"
  | "agent_code_generated"
  | "concept_created"
  | "concept_status_changed"
  | "module_completed";

/** The Module-1 entry types where the inventor is the source (verbatim required). */
export const MODULE1_HUMAN_SOURCE_TYPES: ReadonlySet<string> = new Set<LedgerEntryType>([
  "inventor_input",
  "inventor_edit",
  "inventor_note",
  "clarity_answer",
  "leap_input",
]);

/* ------------------------------------------------------------------ *
 * The cards Module 1 uses (data contracts only — the Helper renders them)
 * ------------------------------------------------------------------ */

export type ReviewAction = "approve" | "discard" | "request_edit";
export type CandidateAction = "keep" | "drop" | "merge";

/**
 * Review card — the Helper's reading, restatement, or suggested edit of the
 * inventor's OWN material. The main interaction. Nothing here is accepted until
 * the inventor acts on it. A Review card NEVER carries AI-conceived substance:
 * everything on it traces to the inventor's words (the Boundary Classifier
 * guarantees this before a card is emitted).
 */
export type ReviewCard = {
  id: string;
  type: "review";
  /**
   * - "restatement": the Helper's reading-back of what it understood.
   * - "suggested_edit": a proposed tidy of the inventor's own phrasing.
   * - "confirm_addition": a substantive addition the Formalizer had to flag,
   *   needing explicit confirmation before it can be tagged
   *   system_suggested_accepted.
   */
  kind: "restatement" | "suggested_edit" | "confirm_addition";
  title: string;
  /** What the inventor reviews. Built only from their own material. */
  body: string;
  /** Examiner notes attached to this reading (weaknesses/risks), if any. */
  notes?: string[];
  /** For "confirm_addition": the exact added substance awaiting confirmation. */
  addition?: string;
  /** The concept this card concerns, if it maps to one. */
  relatesToConceptId?: string;
  actions: ReviewAction[];
};

/**
 * Clarity card — ONE question, shown only where something is genuinely missing.
 * The answer is captured verbatim. Never carries a proposed answer.
 */
export type ClarityCard = {
  id: string;
  type: "clarity";
  question: string;
  whyItMatters?: string;
};

/**
 * Leap card — the ONLY path for genuinely new inventive content. Shown when
 * building forward needs an idea the inventor has not stated. Carries context
 * and the named missing element, plus a blank box for the inventor to write in
 * their own words. It NEVER shows AI-written options. Captured verbatim.
 */
export type LeapCard = {
  id: string;
  type: "leap";
  /** Why a new inventive idea is needed here. Contains no proposed idea. */
  context: string;
  /** The named inventive element that is missing (from the Boundary Classifier). */
  inventiveElement: string;
};

/**
 * Candidate concept card — one concept surfaced for the inventor to keep, drop,
 * or merge as the picture firms up.
 */
export type CandidateConceptCard = {
  id: string;
  type: "candidate_concept";
  conceptId: string;
  title: string;
  statement: string;
  actions: CandidateAction[];
};

/**
 * Code review card — representative, illustrative code the Helper generated
 * from the inventor's approved formalized statement, shown for Approve / Discard
 * / Request edit. Generated only after the inventor approves the formalized
 * restatement ("once you agree that's the right way to see your input"). It is
 * illustrative scaffolding, not a claimed inventive concept.
 */
export type CodeReviewCard = {
  id: string;
  type: "code_review";
  title: string;
  language: string;
  code: string;
  actions: ReviewAction[];
};

export type Module1Card =
  | ReviewCard
  | ClarityCard
  | LeapCard
  | CandidateConceptCard
  | CodeReviewCard;

/* ------------------------------------------------------------------ *
 * Inventor action inputs (what the Helper sends back when the inventor acts)
 * ------------------------------------------------------------------ */

export type ReviewActionInput =
  | { action: "approve" }
  | { action: "discard" }
  /** The inventor's correction, captured verbatim. */
  | { action: "request_edit"; correction: string };

/** The inventor's answer to a Clarity card, captured verbatim. */
export type ClarityAnswerInput = { answer: string };

/** The inventor's new inventive idea via a Leap card, captured verbatim. */
export type LeapInput = { idea: string };

export type CandidateActionInput =
  | { action: "keep" }
  | { action: "drop" }
  | { action: "merge"; into: string };

export type CardActionInput =
  | ReviewActionInput
  | ClarityAnswerInput
  | LeapInput
  | CandidateActionInput;

/* ------------------------------------------------------------------ *
 * The view the engine returns to the Helper after each step
 * ------------------------------------------------------------------ */

export type Module1Phase =
  | "ingesting"
  | "reviewing_statement"
  | "confirming_concepts"
  | "complete";

export type Module1View = {
  phase: Module1Phase;
  /** Cards to render now. The Helper renders these; it does not invent them. */
  cards: Module1Card[];
  /** The Helper's formalized restatement of the raw idea, and whether approved. */
  statement?: { text: string; approved: boolean };
  /** Representative code (generated after the statement is approved), if any. */
  representativeCode?: { language: string; code: string; approved: boolean };
  /** Current snapshot of concepts (the eventual deliverable). */
  concepts: ConceptObject[];
  /** The evidence ledger — the inventor's notebook of inputs and decisions. */
  ledger: LedgerEntry[];
  /** True once the inventor owns and has confirmed every surviving concept. */
  complete: boolean;
};

/* ------------------------------------------------------------------ *
 * The five sub-agents + the deps the Helper injects
 * ------------------------------------------------------------------ */

/** The sub-agents Module 1 calls. Never user-facing. */
export type AgentName =
  | "distiller"
  | "clarifier"
  | "examiner"
  | "decomposer"
  | "boundary-classifier"
  | "formalizer"
  | "code-generator"
  | "reviser"
  | "verifier";

/** Dependencies the Helper injects when constructing the Module 1 engine. */
export type ConceptionDeps = {
  runAgent: AgentRunner;
  /** Optional shared ledger to thread the proof trail across modules. */
  ledger?: EvidenceLedger;
  /** Optional Shared Consciousness — the cross-module draft memory. */
  consciousness?: SharedConsciousness;
  /** Clock seam. Defaults to wall-clock ISO time. */
  now?: () => string;
  /** Id generator seam. Defaults to crypto.randomUUID. */
  genId?: () => string;
};
