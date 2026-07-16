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
import type { ConstraintKind } from "./coverage";

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
  /** The rule-engine / language-model / agent implementability narrative. */
  paradigm_neutrality_check?: string;
  /* --- Formalized ONLY from the inventor's inputs (empty when absent); the
   * Extractor never authors these. Where the genus needs one the inputs don't
   * supply, a Gap of class missing_constraint / missing_invariant is opened. --- */
  /** Machine-checkable technical conditions the transformation enforces. */
  computational_constraints?: string[];
  /** Properties holding across every valid execution. */
  logical_invariants?: string[];
  /**
   * A2 (rebuild): verbatim quotes (≥8 chars) from the inventor's material that show
   * possession of the breadth this genus claims. A statement with no anchor cannot
   * be emitted; over-broad statements are narrowed to the anchored portion.
   */
  anchors?: string[];
};

/* ------------------------------------------------------------------ *
 * The pipeline-wide gap object
 *
 * Where a layer needs substance the inventor's inputs do not supply, it OPENS a
 * gap instead of authoring the substance (that is the structural POHC lock). The
 * agent that hits the gap declares it in its structured output; the controller
 * records it here and writes a `gap_opened` machine event to the Ledger. A gap's
 * `description` states the ABSENCE only — never the missing content itself.
 * Lives in the Showcase engine state (persisted in module_state), not a DB table.
 * ------------------------------------------------------------------ */

export type GapClass =
  | "missing_constraint" // genus needs a constraint no input supplies (Layer 2)
  | "missing_invariant" // genus needs an invariant no input supplies (Layer 2)
  | "missing_mechanism" // a candidate/section needs a mechanism's "how" (Layers 4/5)
  | "missing_step" // the formalizer needs a step no input supplies (Layer 5)
  | "missing_data_structure" // A3: the record states no data structure of a needed kind
  | "missing_criterion_source"; // no upstream inventor material to lift a criterion from (Layer 4)

export type GapOrigin =
  | "genus_extractor"
  | "enumerator"
  | "formalizer"
  | "section_polisher"
  | "constraint_miner"; // A3 — a required constraint class has no surviving candidate

/** What artifact/field the gap attaches to. */
export type GapLocus =
  | { kind: "genus_field"; ref: string } // e.g. "computational_constraints"
  | { kind: "species"; ref: string } // species candidate id
  | { kind: "section"; ref: string }; // disclosure section key

export type GapStatus = "open" | "resolved" | "dismissed";

/** One opened gap, as stored on the engine and surfaced on the view. */
export type Gap = {
  id: string;
  gapClass: GapClass;
  origin: GapOrigin;
  locus: GapLocus;
  /** States what is absent and why the step needed it — never the missing content. */
  description: string;
  /** Ledger ids of the inventor material consulted (may be empty). */
  sourceLedgerIds: string[];
  status: GapStatus;
  createdAt: string;
};

/**
 * What an agent DECLARES when it hits a gap (a subset of Gap). The controller
 * fills in id / origin / status / createdAt / sourceLedgerIds. `field` names the
 * artifact/field it attaches to; the controller maps it onto the right GapLocus.
 */
export type DeclaredGap = {
  gap_class: GapClass;
  field: string;
  note: string;
};

export type SpeciesType = "ai_assisted" | "ai_native" | "agentic";

/* ------------------------------------------------------------------ *
 * Layer 4 (redesign): enumerated candidates + skeptic grades
 *
 * The Enumerator surfaces established patterns mapped onto the genus; the Grader
 * scores each. Candidates are retrieval, never authored mechanism. These feed the
 * Layer 5 sweep: survive and demote are both SHOWN (no hidden pool), while reject
 * deletes duplicates and failures so the inventor never sees one idea twice.
 * ------------------------------------------------------------------ */

export type CandidateVerdict = "survive" | "demote" | "reject";

/** One enumerated candidate: an existing approach mapped onto the invention. */
export type Candidate = {
  id: string;
  /** Emergent plain grouping label (e.g. "keeping a memory of what happened"). */
  family: string;
  /** Short plain handle. */
  label: string;
  /** The familiar approach it draws from, in plain words. */
  source: string;
  /** What it would do for this invention, in the inventor's words. */
  mapping: string;
  /** The honest give-and-take, one plain sentence. */
  tradeoff: string;
};

/** The skeptic Grader's scorecard for one candidate. */
export type CandidateGrade = {
  traceability: number;
  fidelity: number;
  specificity: number;
  distinctness: number;
  verdict: CandidateVerdict;
  reason: string;
};

export type GradedCandidate = Candidate & { grade: CandidateGrade };

/** A tap-able criterion fragment lifted verbatim from the inventor's own words. */
export type CriterionFragment = { text: string; sourceId: string };

/** The inventor's Layer 4 criterion answer (a tapped fragment or free text). */
export type Criterion = { text: string; sourceId?: string };

export type Species = {
  species_type: SpeciesType;
  species_name: string;
  architectural_description: string;
  data_flow: string;
  key_components: string[];
  technical_improvements: string[];
  /** V2: architecture-level distinctness from the OTHER TWO species. Replaces
   *  V1's `differentiation_from_traditional`. */
  differentiation_from_siblings: string;
  /** V1 field — retained so species stored before V2 still read back. */
  differentiation_from_traditional?: string;
  /* --- V2 §112 algorithmic disclosure (absent on species drafted by V1). --- */
  /** The ordered, component-bound algorithm (the §112(f) corresponding structure). */
  sequence_of_operations?: string[];
  /** One entry per genus constraint: which component enforces it, at which step. */
  constraint_enforcement_map?: string[];
  /** One entry per genus invariant: which component verifies it, at which step. */
  invariant_preservation_map?: string[];
  /** Inventor's Gate-1 decision. undefined until decided. */
  kept?: boolean;
};

/** The disclosure carried from Module 4 (for the later export slice). */
export type DisclosureSection = { key: string; label: string; body: string };

/**
 * A figure returned by the external diagram service — a self-contained SVG for
 * display plus a bare-base64 single-page PDF for download. Shared between the
 * server seam (`diagrams.ts`), the route, the hook, and the panel.
 */
export type DiagramFigure = {
  /** Stable id, always "fig-<n>". */
  id: string;
  /** Human-readable figure caption. */
  title: string;
  /** Raw `<svg…>…</svg>` markup (black-and-white, PCT-style). */
  svgData: string;
  /** Base64 of a single-page PDF — prepend `data:application/pdf;base64,` to use. */
  pdfBase64: string;
};

/* ------------------------------------------------------------------ *
 * Drawings — the plan-mode figure pipeline
 *
 * app 2 owns the PLANNER: it reads the finished draft and emits a figure PLAN
 * (the figure set + a numeral ledger + a grounded description per figure). The
 * external diagram service is handed the plan and only DRAWS it (see
 * DIAGRAM_SERVICE_PLAN_MODE.md). Because one plan drives BOTH the drawing and its
 * description, the two can never disagree — each description is composed from the
 * same numerals/features that were drawn, never guessed.
 * ------------------------------------------------------------------ */

export type DrawingFigType =
  | "system"
  | "module"
  | "flowchart"
  | "dataflow"
  | "sequence"
  | "state"
  | "hardware"
  | "record";

/** One row of the numeral ledger: a reference numeral bound to a feature name. */
export type NumeralLedgerEntry = {
  ref: string;
  feature: string;
  figures: number[];
  definedInSpec: boolean;
};

/** One planned figure — the drafter's instructions plus our own descriptions. */
export type PlannedFigure = {
  figNumber: number;
  figType: DrawingFigType;
  title: string;
  /** "FIG. N is a block diagram of …" — the Brief Description of the Drawings line. */
  briefDescription: string;
  /** The grounded walkthrough — every numbered element and how they connect. */
  detailedDescription: string;
  /** Directive drawing instructions for the diagram service's drafter. */
  outline: string;
  /** The numerals this figure uses (a subset of the ledger). */
  numerals: string[];
};

/** The full plan app 2 sends to the diagram service's plan-mode endpoint. */
export type FigurePlan = {
  figures: PlannedFigure[];
  numerals: NumeralLedgerEntry[];
  gaps: string[];
};

/** A figure the diagram service rendered from the plan (joined back by figNumber). */
export type PlanFigureResult = {
  figNumber: number;
  title: string;
  svgData: string;
  pdfBase64: string;
  /** The numerals actually drawn (after the drafter's legibility budget). */
  numerals: string[];
};

/**
 * A finished drawing as stored on the project and shown in the ICB: the rendered
 * figure (SVG + PDF) fused with its plan-authored descriptions. This is what the
 * "Drawings" part of the ICB displays and the export includes.
 */
export type ShowcaseDrawing = {
  figNumber: number;
  figType: DrawingFigType;
  title: string;
  briefDescription: string;
  detailedDescription: string;
  numerals: string[];
  svgData: string;
  pdfBase64: string;
};

/**
 * The rendering seam: hands a plan to the diagram service and returns the figures
 * it drew. Injected into the engine so the controller stays free of HTTP/transport
 * (mirrors how Module 3 injects its prior-art search).
 */
export type FigureRenderer = (plan: FigurePlan) => Promise<PlanFigureResult[]>;

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
  | "gap_opened" // a layer flagged missing substance instead of authoring it
  | "gap_resolved" // an opened gap was later satisfied
  | "gap_dismissed" // an opened gap was superseded (e.g. on regeneration)
  // Layer 4/5 (redesign)
  | "criterion_set" // the inventor's Layer 4 criterion (verbatim; provenance in tags)
  | "candidate_kept" // the inventor confirmed an enumerated candidate fits their criterion
  | "agent_criterion_fragments" // the fragmenter surfaced tap-able criterion options
  | "agent_breadth" // the breadth assessor sized the invention (narrow/moderate/broad)
  | "agent_enumerated" // the enumerator surfaced candidates for a species type
  | "agent_graded" // the grader scored a species type's candidates
  | "agent_formalized" // the formalizer wrote a kept candidate into the disclosure
  | "module_completed";

export const SHOWCASE_HUMAN_SOURCE_TYPES: ReadonlySet<string> = new Set<LedgerEntryType>([
  "inventor_note",
  "inventor_edit",
  // The Layer 4 criterion is the inventor's own words (a lifted fragment or free
  // text); it is recorded verbatim, with the provenance path carried in its tags.
  "criterion_set",
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
 * The V1 second-gate expansion review (Gate 2 only; Gate 1 retired)
 * ------------------------------------------------------------------ */

export type ExpansionArtifactKind =
  | "broadened_kc"
  | "new_kc"
  | "background_ext"
  | "summary_ext"
  | "detail_ext"
  | "abstract_rewrite"
  // Module 5 rebuild (v2.3) — D-phase Key Concept generation (spec §7).
  | "independent_kc" // three-framing independent position per genus (D1)
  | "dependent_kc"; // one limitation from a claim-grade region (D2)

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
  meta?: {
    conceptId?: string;
    aspect?: string;
    wordCount?: number;
    title?: string;
    /** D2 retreat-ladder order (0 = broadest) for dependent Key Concepts. */
    ladder?: number;
    /** The region id a dependent_kc derives from (D2 regenerate). */
    regionId?: string;
  };
};

/** GATE 2 — "Review expanded content": every artifact individually reviewable;
 *  only Finalize Expansion weaves the kept ones into the draft. */
export type ExpansionReviewCard = {
  id: string;
  type: "expansion_review";
  artifacts: ExpansionArtifact[];
};

/* ------------------------------------------------------------------ *
 * Layer 4/5 (redesign) cards
 * ------------------------------------------------------------------ */

/** One tap-able criterion fragment (verbatim from the inventor's own words). */
export type CriterionFragmentOption = { id: string; text: string; sourceId: string };

/** Layer 4 criterion question — tap a fragment, or "none of these → type your own". */
export type CriterionCard = {
  id: string;
  type: "criterion";
  question: string;
  fragments: CriterionFragmentOption[];
};

/**
 * One region on the rebuilt Phase-C sweep (spec §5). The inventor decides each by
 * tap: Keep (disclosure grade), Protect (claim grade → deltas), Remove, Park.
 */
export type SweepItem = {
  candidateId: string;
  family: string;
  label: string;
  source: string;
  mapping: string;
  tradeoff: string;
  /** The inventor's region decision (pending until they tap). */
  status: "pending" | "kept" | "protected" | "excluded" | "parked";
  /** Grade once decided: kept → disclosure, protected → claim. */
  grade?: "disclosure" | "claim";
  /** Whether the inventor's own words already cover this (free species). */
  freeSpecies?: boolean;
};

/** One axis group of regions (spec §5 — mandatory automation axis first). */
export type SweepGroup = {
  /** The axis label (on-screen header). */
  family: string;
  items: SweepItem[];
};

/** Phase-C surface — regions grouped by axis; Keep/Protect/Remove/Park per region. */
export type SweepCard = {
  id: string;
  type: "candidate_sweep";
  groups: SweepGroup[];
};

/* ------------------------------------------------------------------ *
 * Module 5 rebuild (v2.3) — A1 Key Concept hygiene
 *
 * The hygiene chain runs FIRST, before genus detection. When the deterministic
 * lint or the second-model semantic verify finds anything, the inventor resolves
 * it by tap; the clean set is the sole input to everything downstream (spec §3 A1).
 * ------------------------------------------------------------------ */

/** One same-scope duplicate pair to resolve (Keep one / Keep both). */
export type KCHygieneDuplicate = {
  pairId: string;
  aId: string;
  aTitle: string;
  /** The full text of concept A, so the inventor can actually read it before choosing. */
  aStatement: string;
  bId: string;
  bTitle: string;
  bStatement: string;
  /** 0..1 from the deterministic near-dup lint; 0 for a verify-only semantic pair. */
  similarity: number;
  reason: string;
  resolved?: boolean;
};

/** One flagged span in a Key Concept (internal vocab / meta-commentary / subjective). */
export type KCHygieneFlag = {
  flagId: string;
  kcId: string;
  kcTitle: string;
  quote: string;
  rule: string;
  citation: string;
  resolved?: boolean;
};

export type KCHygieneCard = {
  id: string;
  type: "kc_hygiene";
  duplicates: KCHygieneDuplicate[];
  flags: KCHygieneFlag[];
};

/* ------------------------------------------------------------------ *
 * Module 5 rebuild (v2.3) — A3 constraint mining
 *
 * Mined, anchored, type-classified quotes from the inventor's record. The
 * confirmed set populates confirmedConstraints (as strings) flowing through the
 * existing enumerator / grader / formalizer signatures (spec §3 A3).
 * ------------------------------------------------------------------ */

/** One mined constraint candidate the inventor confirms by tap. */
export type MinedConstraintItem = {
  id: string;
  kind: ConstraintKind;
  /** The inventor's verbatim quote (Edit only ever trims their own words). */
  quote: string;
  kept: boolean;
};

export type ConstraintReviewCard = {
  id: string;
  type: "constraint_review";
  items: MinedConstraintItem[];
};

/** A2 — confirm or edit the extracted genus before it drives the rest of the stage. */
export type GenusReviewCard = {
  id: string;
  type: "genus_review";
  genus: Genus;
  /** Overbreadth spans the verify flagged (empty when the anchors support it). */
  overbroad: { quote: string; reason: string }[];
};

/* ------------------------------------------------------------------ *
 * Module 5 rebuild (v2.3) — delta mining (§6)
 *
 * Each PROTECTED region harvests the inventor's own statements of how the mechanism
 * differs in that setting. Claim grade requires ≥1 kept delta or a region-specific
 * constraint; otherwise the region rests at disclosure grade with a gap.
 * ------------------------------------------------------------------ */

/** One mined delta candidate (the inventor's verbatim) for a protected region. */
export type DeltaCandidate = {
  id: string;
  regionId: string;
  quote: string;
  decision?: "kept" | "removed";
};

/** A protected region's mined deltas, reviewed as a group. */
export type DeltaRegion = {
  regionId: string;
  regionLabel: string;
  /** Set when the inventor said the mechanism is unchanged here (invariance path). */
  sameAsPrimary?: boolean;
  /** Set when the inventor said this region does not apply → excluded. */
  doesNotApply?: boolean;
  deltas: DeltaCandidate[];
};

export type DeltaReviewCard = {
  id: string;
  type: "delta_review";
  regions: DeltaRegion[];
};

/* ------------------------------------------------------------------ *
 * The conversational FOREST (the re-aim: build the whole forest, don't tap-approve)
 *
 * The genus is the forest; the species are the trees. The inventor STEERS ("what am
 * I missing?", "how would a competitor design around this?", "the future version?")
 * and the AI fills the forest in response. The inventor claims the trees worth
 * owning with one short line in their own words — the human-conception anchor.
 * ------------------------------------------------------------------ */

/** Where a tree came onto the map. */
export type TreeOrigin = "yours" | "gap" | "design_around" | "future";

/** One tree in the forest (a way to realize the genus). */
export type ForestTree = {
  id: string;
  label: string;
  source: string;
  mapping: string;
  tradeoff: string;
  origin: TreeOrigin;
  /** Strategic reason it belongs (gap filled / design-around blocked / why it's the future). */
  note?: string;
  status: "pending" | "kept" | "claimed" | "dropped";
  /** The inventor's one-line +1 (their own words) — captured when they claim it. */
  detail?: string;
};

export type ForestCard = {
  id: string;
  type: "forest";
  genusName: string;
  genusDescription: string;
  trees: ForestTree[];
};

export type Module5Card =
  | ChoiceCard
  | VariationCard
  | WidenedReviewCard
  | ExpansionReviewCard
  | CriterionCard
  | SweepCard
  | KCHygieneCard
  | ConstraintReviewCard
  | GenusReviewCard
  | DeltaReviewCard
  | ForestCard;

/* ------------------------------------------------------------------ *
 * Inventor action inputs
 * ------------------------------------------------------------------ */

export type ChoiceInput = { choice: "broaden" | "skip" };
export type VariationInput = { action: "keep" | "drop" };
export type WidenedActionInput =
  | { action: "approve" }
  | { action: "discard" }
  | { action: "request_edit"; correction: string };

/** Gate 2 actions: per-artifact review, then finalize the expansion. */
export type ExpansionReviewInput =
  | { action: "keep"; artifactId: string }
  | { action: "remove"; artifactId: string }
  | { action: "edit"; artifactId: string; text: string }
  | { action: "regenerate"; artifactId: string }
  | { action: "finalize" };

/** Layer 4 criterion answer: tap-only. Every option shown is one the inventor
 *  can confirm — there is no free-text / compose path anywhere in this flow. */
export type CriterionInput = { action: "choose"; fragmentId: string };

/** Phase-C sweep actions — tap-only (spec §5). Keep = disclosure grade; Protect =
 *  claim grade (opens deltas); Remove = excluded; Park = gap held open. */
export type SweepInput =
  | { action: "keep"; candidateId: string }
  | { action: "protect"; candidateId: string }
  | { action: "remove"; candidateId: string }
  | { action: "park"; candidateId: string }
  | { action: "finalize" }; // kept + protected regions → formalizer

/** A1 hygiene actions — tap-only; the clean set gates everything downstream. */
export type KCHygieneInput =
  | { action: "keep_one"; pairId: string; keepId: string } // remove the other of the pair
  | { action: "keep_both"; pairId: string } // both are distinct enough; keep them
  | { action: "keep_flag"; flagId: string } // dismiss the flag, keep the text
  | { action: "remove_flag"; flagId: string }; // remove the flagged Key Concept

/** A3 constraint-confirmation actions — Keep/Remove/Edit (own words), then Confirm. */
export type ConstraintReviewInput =
  | { action: "toggle"; itemId: string } // keep ⇄ remove this candidate
  | { action: "edit"; itemId: string; quote: string } // trim their own words
  | { action: "confirm" }; // finalize the confirmed set

/** A2 genus-confirmation actions — Keep, or Edit the genus statement (a machine
 *  abstraction of the inventor's material; editing it is permitted, R2). */
export type GenusReviewInput =
  | { action: "keep" }
  | { action: "edit"; description: string };

/** Delta-review actions (spec §6) — per-delta Keep/Edit/Remove, per-region
 *  Same-as-primary / Does-not-apply, then Confirm. Edit trims their own words. */
export type DeltaReviewInput =
  | { action: "keep"; deltaId: string }
  | { action: "edit"; deltaId: string; quote: string }
  | { action: "remove"; deltaId: string }
  | { action: "same_as_primary"; regionId: string }
  | { action: "does_not_apply"; regionId: string }
  | { action: "confirm" };

/** The conversational forest — steer to fill it, claim the trees worth owning. */
export type ForestInput =
  | { action: "steer"; direction: "missing" | "design_around" | "future" }
  | { action: "keep"; treeId: string } // include at disclosure grade
  | { action: "claim"; treeId: string; detail: string } // claim grade + the +1 (own words)
  | { action: "unclaim"; treeId: string }
  | { action: "drop"; treeId: string }
  | { action: "finalize" };

export type CardActionInput =
  | ChoiceInput
  | VariationInput
  | WidenedActionInput
  | ExpansionReviewInput
  | CriterionInput
  | SweepInput
  | KCHygieneInput
  | ConstraintReviewInput
  | GenusReviewInput
  | DeltaReviewInput
  | ForestInput;

/* ------------------------------------------------------------------ *
 * View + deps
 * ------------------------------------------------------------------ */

export type Module5Phase =
  | "choosing" // broaden or skip
  | "selecting_variations" // (legacy) keep which species
  | "approving_widened" // (legacy) approve each broadened Key Concept
  | "reviewing_artifacts" // (legacy GATE 2) review every expansion artifact, then finalize
  | "awaiting_criterion" // Layer 4: inventor answers "what must any implementation get right?"
  | "sweeping" // Layer 5: keep/dismiss enumerated candidates
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
  /** The finished figures + their descriptions — the ICB's Drawings part. */
  drawings: ShowcaseDrawing[];
  /** Gaps opened across the pipeline (missing substance a layer refused to author). */
  gaps: Gap[];
};

/** The sub-agents Module 5 calls. Never user-facing. */
export type AgentName =
  | "helper"
  | "genus-extractor"
  | "key-concept-broadener"
  | "verifier"
  // The 5c "extender" second pass — enriches the disclosure with multi-paradigm depth.
  | "background-extender"
  | "summary-extender"
  | "detail-description-extender"
  | "abstract-rewriter"
  | "key-concept-appender"
  // Plans the figure set + numeral ledger + grounded descriptions (plan-mode drawings).
  | "figure-planner"
  // On-demand drafter/reviser for the narrative disclosure sections (in the editor).
  | "section-polisher"
  // Layer 4/5 (redesign): breadth → enumerate → grade → formalize.
  | "criterion-fragmenter"
  | "breadth-assessor"
  | "baseline-builder"
  | "enumerator"
  | "grader"
  | "formalizer"
  // Module 5 rebuild (v2.3) agents.
  | "kc-hygiene-verify"
  | "constraint-miner"
  | "genus-verify"
  | "delta-miner"
  | "kc-independent"
  | "kc-dependent"
  | "exit-evaluator"
  | "forest-expander";

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
