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

export type Module5Card = ChoiceCard | VariationCard | WidenedReviewCard;

/* ------------------------------------------------------------------ *
 * Inventor action inputs
 * ------------------------------------------------------------------ */

export type ChoiceInput = { choice: "broaden" | "skip" };
export type VariationInput = { action: "keep" | "drop" };
export type WidenedActionInput =
  | { action: "approve" }
  | { action: "discard" }
  | { action: "request_edit"; correction: string };

export type CardActionInput = ChoiceInput | VariationInput | WidenedActionInput;

/* ------------------------------------------------------------------ *
 * View + deps
 * ------------------------------------------------------------------ */

export type Module5Phase =
  | "choosing" // broaden or skip
  | "selecting_variations" // Gate 1: keep which species
  | "approving_widened" // Gate 2: approve each broadened Key Concept
  | "ready";

export type Module5View = {
  phase: Module5Phase;
  cards: Module5Card[];
  keyConcepts: ShowcaseKeyConcept[];
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
