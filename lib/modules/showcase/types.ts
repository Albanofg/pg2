/**
 * Module 5 — Showcase. Type contracts (broadening slice; figures deferred).
 *
 * Input: the certified Key Concepts + the compiled Invention Disclosure (from
 * Module 4). Broadening is OPTIONAL and gated: extract a paradigm-neutral genus →
 * synthesize alternative species → the inventor keeps which variations (Gate 1) →
 * broaden each Key Concept to cover them, meaning-preserving (Gate 2). The
 * Boundary (the verifier) guards both gates — broadening must never invent.
 *
 * Pure (no server-only imports). Cross-module currency re-exported from shared.
 */

import type {
  AgentRunner,
  EvidenceLedger,
  HelperTurn,
  LedgerEntry,
  SharedConsciousness,
} from "@/lib/modules/shared";

export type { LedgerEntry, HelperTurn } from "@/lib/modules/shared";

/* ------------------------------------------------------------------ *
 * Input + broadening artifacts
 * ------------------------------------------------------------------ */

/** A certified Key Concept carried in from Module 4. */
export type ShowcaseKeyConcept = {
  id: string;
  title: string;
  /** The Key Concept / differentiation text (the anchor). */
  statement: string;
  /** The inventor's verbatim material behind it (the only source for verification). */
  verbatim: string[];
  /** The broadened, paradigm-neutral text, once approved (meaning-preserving). */
  broadened?: string;
};

export type Genus = {
  genus_name: string;
  genus_description: string;
  input_pattern: string;
  transformation_pattern: string;
  output_pattern: string;
  /** V1's explicit rule-engine-AND-agent implementability statement. */
  paradigm_neutrality_check?: string;
};

export type SpeciesType = "ai_assisted" | "ai_native" | "agentic";

export type Species = {
  species_type: SpeciesType;
  species_name: string;
  architectural_description: string;
  data_flow: string;
  key_components: string[];
  technical_improvements: string[];
  differentiation_from_traditional: string;
  /** Inventor's Gate-1 decision. undefined until decided. */
  kept?: boolean;
};

/** The disclosure carried from Module 4 (for the later export slice). */
export type DisclosureSection = { key: string; label: string; body: string };

/* ------------------------------------------------------------------ *
 * Ledger vocabulary
 * ------------------------------------------------------------------ */

export type LedgerEntryType =
  | "inventor_note"
  | "inventor_edit" // a corrected broadened concept (verbatim)
  | "broaden_choice" // broaden or skip
  | "variation_action" // keep / drop a species (Gate 1)
  | "widened_action" // approve / discard / edit a broadened concept (Gate 2)
  | "showcase_started"
  | "agent_genus"
  | "agent_species"
  | "agent_broadened"
  | "agent_appended_concept" // a genus/species/hardware Key Concept was appended
  | "disclosure_extended" // the disclosure prose was enriched across implementations
  | "broadening_withheld" // a piece failed the Boundary and was not surfaced
  | "module_completed";

export const SHOWCASE_HUMAN_SOURCE_TYPES: ReadonlySet<string> = new Set<LedgerEntryType>([
  "inventor_note",
  "inventor_edit",
]);

/* ------------------------------------------------------------------ *
 * Cards
 * ------------------------------------------------------------------ */

export type ReviewAction = "approve" | "discard" | "request_edit";

/** Choice card — broaden the disclosure, or skip straight to the finished draft. */
export type ChoiceCard = {
  id: string;
  type: "choice";
  question: string;
};

/** Variation card — one synthesized species, kept or dropped (Gate 1). */
export type VariationCard = {
  id: string;
  type: "variation";
  speciesType: SpeciesType;
  name: string;
  description: string;
  improvements: string[];
  actions: ("keep" | "drop")[];
};

/** Widened-review card — one broadened Key Concept for approve/edit/discard (Gate 2). */
export type WidenedReviewCard = {
  id: string;
  type: "widened_review";
  conceptId: string;
  title: string;
  original: string;
  broadened: string;
  actions: ReviewAction[];
};

/* ------------------------------------------------------------------ *
 * The V1 two-gate expansion review
 * ------------------------------------------------------------------ */

/** One species inside Gate 1's single review screen. */
export type SpeciesReviewItem = {
  speciesType: SpeciesType;
  /** Display name, e.g. "AI-Assisted" / "AI-Native" / "Agentic". */
  label: string;
  /** The species' architectural description (editable by the inventor). */
  description: string;
  status: "pending" | "approved" | "rejected";
};

/** GATE 1 — "Review AI implementations": all species on ONE screen, each
 *  Approve / Edit / Reject, then Confirm & Continue. */
export type SpeciesReviewCard = {
  id: string;
  type: "species_review";
  items: SpeciesReviewItem[];
};

export type ExpansionArtifactKind =
  | "broadened_kc"
  | "new_kc"
  | "background_ext"
  | "summary_ext"
  | "detail_ext"
  | "abstract_rewrite";

/** One reviewable artifact inside Gate 2 (Regenerate / Keep / Edit / Remove). */
export type ExpansionArtifact = {
  id: string;
  kind: ExpansionArtifactKind;
  /** Display label, e.g. "Broadened Key Concept 3" / "New Key Concept — Core Mechanism". */
  label: string;
  /** For broadened concepts: the original text (shown in italics above the new). */
  original?: string;
  text: string;
  kept: boolean;
  /** Regeneration / finalize context. */
  meta?: { conceptId?: string; aspect?: string; wordCount?: number; title?: string };
};

/** GATE 2 — "Review expanded content": every artifact individually reviewable;
 *  only Finalize Expansion weaves the kept ones into the draft. */
export type ExpansionReviewCard = {
  id: string;
  type: "expansion_review";
  artifacts: ExpansionArtifact[];
};

export type Module5Card =
  | ChoiceCard
  | VariationCard
  | WidenedReviewCard
  | SpeciesReviewCard
  | ExpansionReviewCard;

/* ------------------------------------------------------------------ *
 * Inventor action inputs
 * ------------------------------------------------------------------ */

export type ChoiceInput = { choice: "broaden" | "skip" };
export type VariationInput = { action: "keep" | "drop" };
export type WidenedActionInput =
  | { action: "approve" }
  | { action: "discard" }
  | { action: "request_edit"; correction: string };

/** Gate 1 actions: decide each species, then confirm the set. */
export type SpeciesReviewInput =
  | { action: "approve"; speciesType: SpeciesType }
  | { action: "reject"; speciesType: SpeciesType }
  | { action: "edit"; speciesType: SpeciesType; text: string }
  | { action: "confirm" };

/** Gate 2 actions: per-artifact review, then finalize the expansion. */
export type ExpansionReviewInput =
  | { action: "keep"; artifactId: string }
  | { action: "remove"; artifactId: string }
  | { action: "edit"; artifactId: string; text: string }
  | { action: "regenerate"; artifactId: string }
  | { action: "finalize" };

export type CardActionInput =
  | ChoiceInput
  | VariationInput
  | WidenedActionInput
  | SpeciesReviewInput
  | ExpansionReviewInput;

/* ------------------------------------------------------------------ *
 * View + deps
 * ------------------------------------------------------------------ */

export type Module5Phase =
  | "choosing" // broaden or skip
  | "selecting_variations" // (legacy) keep which species
  | "approving_widened" // (legacy) approve each broadened Key Concept
  | "reviewing_species" // GATE 1: approve/edit/reject each AI implementation
  | "reviewing_artifacts" // GATE 2: review every expansion artifact, then finalize
  | "ready";

export type Module5View = {
  phase: Module5Phase;
  cards: Module5Card[];
  keyConcepts: ShowcaseKeyConcept[];
  /** The compiled Invention Concept Blueprint draft — the editable, tabbed sections. */
  disclosure: DisclosureSection[];
  genus?: Genus;
  species: Species[];
  /** True once broadening has been applied (or deliberately skipped). */
  broadened: boolean;
  /** The Helper conversation — its replies/teaching and the inventor's messages. */
  conversation: HelperTurn[];
  ledger: LedgerEntry[];
  complete: boolean;
};

/** The sub-agents Module 5 calls. Never user-facing. */
export type AgentName =
  | "helper"
  | "genus-extractor"
  | "species-synthesizer"
  | "key-concept-broadener"
  | "verifier"
  // The 5c "extender" second pass — enriches the disclosure with multi-paradigm depth.
  | "background-extender"
  | "summary-extender"
  | "detail-description-extender"
  | "abstract-rewriter"
  | "key-concept-appender";

export type ShowcaseDeps = {
  runAgent: AgentRunner;
  /** The certified Key Concepts from Module 4. */
  keyConcepts: ShowcaseKeyConcept[];
  /** The compiled Invention Disclosure (carried for the later export slice). */
  disclosure?: DisclosureSection[];
  ledger?: EvidenceLedger;
  consciousness?: SharedConsciousness;
  now?: () => string;
  genId?: () => string;
};

export type { AgentRunner } from "@/lib/modules/shared";
