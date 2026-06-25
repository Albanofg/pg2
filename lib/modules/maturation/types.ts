/**
 * Module 2 — Maturation. Type contracts.
 *
 * Pure (no server-only imports). Takes the finalized owned Concepts from
 * Conception and, PER CONCEPT, deepens each into a fuller technical statement,
 * gates it for search-readiness, and lets the inventor select which carry
 * forward. Set-aside concepts are retained, not destroyed.
 */

import type {
  AgentRunner,
  ConceptObject,
  EvidenceLedger,
  Grade,
  LedgerEntry,
  SharedConsciousness,
} from "@/lib/modules/shared";

export { statusLabel } from "@/lib/modules/shared";
export type {
  Provenance,
  ConceptStatus,
  ConceptionTrailItem,
  ConceptProvenancePart,
  ConceptObject,
  Origin,
  Grade,
  LedgerEntry,
  AppendOptions,
  AgentRunRequest,
  AgentRunner,
} from "@/lib/modules/shared";

/* ------------------------------------------------------------------ *
 * The deliverable: matured concepts
 * ------------------------------------------------------------------ */

export type MaturationDecision = "undecided" | "carry_forward" | "set_aside";

/** A Concept matured by this module. Carries everything a ConceptObject does. */
export type MaturedConcept = ConceptObject & {
  /** The fuller technical statement: inventor's material, deepened (no new invention). */
  deepened_statement: string;
  /** Concrete enough that a search would return relevant (not noise) results. */
  searchReady: boolean;
  /** The inventor's scope decision (they choose; set-aside is retained). */
  decision: MaturationDecision;
  /** The reasons the deepening rests on (anchored to the inventor's words). */
  reasons?: string[];
  /** The cross-agent grade of the deepening — surfaced so a drift is visible, not buried. */
  grade?: Grade;
};

/* ------------------------------------------------------------------ *
 * Ledger vocabulary
 * ------------------------------------------------------------------ */

export type LedgerEntryType =
  // Inventor as source — verbatim_text is always present:
  | "inventor_edit" // a correction to a deepened statement
  | "inventor_note" // a free-text note typed into the Helper composer
  | "clarity_answer" // verbatim answer to a factual Spark
  | "leap_input" // verbatim new inventive detail via an inventive Spark
  // Inventor decisions — explicit, never auto-accepted:
  | "deepen_action" // approve / discard / request_edit on a deepen-review card
  | "concept_decision" // carry_forward / set_aside on a selection card
  // Machine events:
  | "maturation_started"
  | "agent_deepened"
  | "concept_matured"
  | "grade_failed" // a cross-agent grade failed; surfaced for inventor review
  | "module_completed";

export const MATURATION_HUMAN_SOURCE_TYPES: ReadonlySet<string> =
  new Set<LedgerEntryType>([
    "inventor_edit",
    "inventor_note",
    "clarity_answer",
    "leap_input",
  ]);

/* ------------------------------------------------------------------ *
 * Cards
 * ------------------------------------------------------------------ */

export type DeepenReviewAction = "approve" | "discard" | "request_edit";
export type SelectionAction = "carry_forward" | "set_aside";

/** The deepened statement of one concept, for the inventor to act on. */
export type DeepenReviewCard = {
  id: string;
  type: "deepen_review";
  conceptId: string;
  title: string;
  original_statement: string;
  deepened_statement: string;
  actions: DeepenReviewAction[];
};

/**
 * A single sharp ask for one concept — NOT a wall of questions.
 *  - "clarify": a factual/specificity gap (search-readiness) — plain question.
 *  - "leap": a genuinely inventive gap — the inventor supplies it in their words.
 */
export type SparkCard = {
  id: string;
  type: "spark";
  conceptId: string;
  kind: "clarify" | "leap";
  prompt: string;
  /** The named missing piece. */
  missing: string;
};

/** One matured concept for the inventor to carry forward or set aside. */
export type SelectionCard = {
  id: string;
  type: "selection";
  conceptId: string;
  title: string;
  statement: string;
  searchReady: boolean;
  actions: SelectionAction[];
};

export type Module2Card = DeepenReviewCard | SparkCard | SelectionCard;

/* ------------------------------------------------------------------ *
 * Inventor action inputs
 * ------------------------------------------------------------------ */

export type DeepenReviewInput =
  | { action: "approve" }
  | { action: "discard" }
  | { action: "request_edit"; correction: string };

export type SparkInput = { answer: string };
export type SelectionInput = { choice: SelectionAction };

export type CardActionInput = DeepenReviewInput | SparkInput | SelectionInput;

/* ------------------------------------------------------------------ *
 * View + deps
 * ------------------------------------------------------------------ */

export type Module2Phase = "maturing" | "selecting" | "complete";

export type Module2View = {
  phase: Module2Phase;
  cards: Module2Card[];
  concepts: MaturedConcept[];
  ledger: LedgerEntry[];
  /** True once every surviving concept has a decision and ≥1 is carried forward. */
  complete: boolean;
};

/** The sub-agents Module 2 calls. Never user-facing. */
export type AgentName = "deepener" | "verifier";

export type MaturationDeps = {
  runAgent: AgentRunner;
  /** The finalized owned concepts from Conception. */
  concepts: ConceptObject[];
  /** Optional shared ledger to thread the proof trail across modules. */
  ledger?: EvidenceLedger;
  /** Optional Shared Consciousness — the cross-module draft memory. */
  consciousness?: SharedConsciousness;
  now?: () => string;
  genId?: () => string;
};
