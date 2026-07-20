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

/**
 * Brainstorm card — the Helper's candidate patentable DIRECTIONS surfaced from
 * the inventor's own idea. It teaches what tends to make each direction
 * registrable and invites the inventor to develop the ones they want, in their
 * own words. It NEVER supplies the novel mechanism (that would be the machine
 * inventing); the inventor's development is captured verbatim as theirs. This is
 * the opposite of a black box: it points at where the value could be, then hands
 * the pen back.
 */
export type BrainstormDirection = {
  /** A short, plain name for the angle, in the inventor's own terms. */
  direction: string;
  /** Teaching: what tends to make this kind of thing registrable (never a ruling). */
  why_it_might_be_patentable: string;
  /** An open question inviting the inventor to develop it in their own words. */
  invite_to_develop: string;
};

export type BrainstormCard = {
  id: string;
  type: "brainstorm";
  /** One short sentence introducing the directions, in the Helper's voice. */
  intro: string;
  directions: BrainstormDirection[];
  /**
   * Names of directions the inventor has already developed ("This is mine").
   * The card shows these as done so a taken direction isn't offered again.
   * Persisted in the snapshot, so "done" survives a reload.
   */
  developed?: string[];
};

/**
 * One place in the inventor's OWN described system where the technical core could
 * live — an ingredient to think with, never an answer. `ask` invites them to say
 * what their system actually does there; the mechanism is always theirs.
 */
export type TechnicalAngle = {
  angle: string;
  why: string;
  ask: string;
};

/**
 * The front-door subject-matter read. Shown when the idea, AS DESCRIBED, reads as
 * a business process / abstract idea that would be rejected on its own — it says
 * so plainly, then helps the inventor find the technical invention inside it.
 * NEVER a blocker: the inventor can always proceed with what they typed.
 */
export type PatentabilityCard = {
  id: string;
  type: "patentability";
  /** "mixed" (technical substance in business framing) or "abstract". */
  verdict: "mixed" | "abstract";
  /** Short plain label of what the idea reads as. */
  kind: string;
  /** The frank + constructive read: what it is, that it'd be rejected as-is, and that there's an invention inside. */
  plainRead: string;
  /** 2–4 ingredients — where the technical core could live in THEIR system. */
  angles: TechnicalAngle[];
  /** One short encouraging line about what happens next. */
  reassurance: string;
};

export type Module1Card =
  | ReviewCard
  | ClarityCard
  | LeapCard
  | CandidateConceptCard
  | CodeReviewCard
  | BrainstormCard
  | PatentabilityCard;

/* ------------------------------------------------------------------ *
 * The Helper's voice — the conversation surface
 * ------------------------------------------------------------------ */

/**
 * ONE short question the Helper attaches to a reply, so replying is one tap. The
 * Helper proposes a few candidate answers the inventor can click; they can always
 * type their own. At most ONE per turn — never a wall of five.
 */
export type HelperQuestion = {
  /** The single short question (empty = no question this turn). */
  ask: string;
  /** One short line on why it helps — optional. */
  why?: string;
  /** 2–4 short proposed answers the inventor can tap; they can always type their own. */
  options: string[];
};

/** @deprecated Legacy multi-point teaching. Kept only so older stored turns still render. */
export type HelperTeachingPoint = {
  topic: string;
  why_it_matters: string;
  what_would_strengthen: string;
  ask: string;
};

/**
 * One turn in the Helper conversation. The Helper ALWAYS replies in words (it is
 * a teacher, not a silent mutator); the inventor's composer messages are shown
 * too so the exchange reads as a real dialogue. A helper turn carries a SHORT
 * reply and, when needed, at most ONE `question` with tap-to-answer options.
 */
export type HelperTurn = {
  role: "inventor" | "helper";
  text: string;
  /** At most ONE short question, with tap-to-answer options. The fast-reply path. */
  question?: HelperQuestion;
  /** @deprecated Legacy multi-point teaching; only older stored turns still carry this. */
  teaching?: HelperTeachingPoint[];
  /** What the Helper understood the inventor's message to be (helper turns only). */
  intent?: "question" | "edit" | "new_idea" | "answer" | "other";
  timestamp: string;
};

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

/**
 * Brainstorm action — either the inventor develops one of the candidate
 * directions in their OWN words (captured verbatim, becomes a concept), or they
 * dismiss the brainstorm to move on.
 */
export type BrainstormInput =
  | {
      action: "develop";
      direction: string;
      text: string;
      /** The "Tell me more" tutor conversation that led here — recorded as CONTEXT. */
      tutorTranscript?: { role: "user" | "assistant"; content: string }[];
    }
  | { action: "dismiss" };

/**
 * Patentability action — either the inventor answers one angle in their OWN words
 * (captured verbatim, folded into the idea and re-read), or they move on with the
 * idea exactly as they typed it. The card never blocks.
 */
export type PatentabilityInput =
  | { action: "develop"; angle: string; text: string }
  | { action: "dismiss" };

export type CardActionInput =
  | ReviewActionInput
  | ClarityAnswerInput
  | LeapInput
  | CandidateActionInput
  | BrainstormInput
  | PatentabilityInput;

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
  /** The Helper conversation — its teaching replies and the inventor's messages. */
  conversation: HelperTurn[];
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

/** The sub-agents Module 1 calls. The `helper` is the user-facing brain; the
 *  rest are never user-facing. */
export type AgentName =
  | "helper"
  | "distiller"
  | "clarifier"
  | "examiner"
  | "advocate"
  | "decomposer"
  | "boundary-classifier"
  | "formalizer"
  | "code-generator"
  | "brainstorm"
  | "reviser"
  | "verifier"
  | "patentability-reader";

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
