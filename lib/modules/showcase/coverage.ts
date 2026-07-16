/**
 * The Coverage Map schema — Module 5 rebuild, Phase B (Axis Walk) and Phase C.
 *
 * A genus is walked across a fixed set of AXES; each axis has POSITIONS; a
 * (genus, axis, position) is a REGION. Every region carries a status, an optional
 * vehicle (how it would be built), verbatim anchors, and any mined deltas. The
 * status ledger of all regions is the machine half of the exhaustiveness claim
 * (spec §4 termination condition); the inventor's Keep/Protect/Remove/Park in
 * Phase C is the other half.
 *
 * Pure — no server-only imports.
 */

/** A verbatim quote from the inventor's record, ≥ 8 chars, optionally ledger-linked. */
export type Anchor = {
  /** The exact inventor substring (≥ 8 chars — enforced by ANCHOR_MIN_CHARS). */
  quote: string;
  /** The Ledger entry the quote came from, when known. */
  ledgerId?: string;
};

export const ANCHOR_MIN_CHARS = 8;

/** A quote qualifies as an anchor only if it is real and long enough. */
export function isValidAnchor(a: Anchor | undefined): boolean {
  return !!a && a.quote.trim().length >= ANCHOR_MIN_CHARS;
}

/**
 * Where a vehicle came from. EXACTLY two values (spec §12): the inventor said it,
 * or the cross-model verify attested it as established practice. There is no
 * "landscape" value in this build — do not add a placeholder.
 */
export type SourceClass = "inventor_supplied" | "established_practice";

/**
 * Disclosure grade vs claim grade. A tap-confirmed machine vehicle caps at
 * disclosure grade (R3); claim grade requires a kept delta or a region-specific
 * confirmed constraint (§6).
 */
export type RegionGrade = "disclosure" | "claim";

export type RegionStatus =
  | "primary" // the primary embodiment already sits here
  | "free_species" // inventory/verbatim already covers it (zero inventor cost)
  | "candidate" // a vehicle was enumerated, not yet decided
  | "protected" // inventor nominated it for claim grade
  | "included" // inventor kept it at disclosure grade
  | "excluded" // inventor removed it (deliberate scope honesty)
  | "parked"; // gap open; claim grade hard-blocked for this region

/** How a region would be built, in plain language. Nullable on a region. */
export type Vehicle = {
  label: string;
  source_class: SourceClass;
  mapping: string;
  tradeoff: string;
  /** The skeptic grade, when the region ran through the grader. */
  grade?: {
    traceability: number;
    fidelity: number;
    specificity: number;
    distinctness: number;
    verdict: "survive" | "demote" | "reject";
    reason: string;
  };
};

/**
 * A delta: how the mechanism BEHAVES DIFFERENTLY in this region's setting, as an
 * anchored verbatim quote naming a component and a behavior change (§6). Deltas
 * are the substance that lifts a protected region to claim grade.
 */
export type Delta = {
  id: string;
  regionId: string;
  anchor: Anchor;
  /** How the inventor resolved this delta card. */
  decision?: "kept" | "same_as_primary" | "does_not_apply" | "removed";
  /** Set when decision === "same_as_primary": the confirmed invariant it rests on. */
  invarianceAnchor?: Anchor;
};

/** One region of the coverage map. */
export type Region = {
  regionId: string;
  genusId: string;
  axisId: string;
  /** The position on the axis (e.g. "server", "batch", "ai_native"). */
  position: string;
  status: RegionStatus;
  grade?: RegionGrade;
  vehicle?: Vehicle;
  anchors: Anchor[];
  deltas: Delta[];
  /** Receipt ids for the chains that touched this region. */
  receipts: string[];
};

/** One axis of variation for a genus. */
export type Axis = {
  axisId: string;
  label: string;
  /** The positions walked on this axis. */
  positions: string[];
  /** Whether this axis applies to the genus (B1 applicability chain). */
  applicable: boolean;
  /** One-line reason for applicable/inapplicable (never silently skipped). */
  reason: string;
  /** The automation axis (seeded with the mandatory three) is always first. */
  seeded?: boolean;
};

/**
 * The kind of substance mined in A3 (constraint mining). Every mined item is an
 * anchored verbatim quote classified by type; the confirmed set populates
 * `confirmedConstraints` (as strings) flowing through the existing agent
 * signatures, while the richer objects drive the confirmation UI and gap routing.
 */
export type ConstraintKind =
  | "constraint"
  | "invariant"
  | "operation_step"
  | "data_structure";

export type MinedConstraint = {
  id: string;
  kind: ConstraintKind;
  anchor: Anchor;
  /** Inventor decision in the A3 confirmation sweep. */
  kept?: boolean;
};

/** The required constraint classes; a class with no surviving candidate → a gap. */
export const REQUIRED_CONSTRAINT_KINDS: ConstraintKind[] = [
  "constraint",
  "invariant",
  "operation_step",
  "data_structure",
];

/**
 * The seeded automation axis — the three mandatory build-styles, fixed order,
 * always produced first, never dropped (spec §4 B1, §12).
 */
export const AUTOMATION_AXIS_POSITIONS = ["ai_assisted", "ai_native", "agentic"] as const;

/**
 * The remaining software axes walked for every genus (spec §4 B1). Positions are
 * data so future axes are config edits, not rebuilds (§12).
 */
export const SOFTWARE_AXES: { axisId: string; label: string; positions: string[] }[] = [
  {
    axisId: "execution_locus",
    label: "where it runs",
    positions: ["client", "server", "edge", "distributed", "on_chain_off_chain_split"],
  },
  { axisId: "timing", label: "when it runs", positions: ["real_time", "batch", "event_driven"] },
  {
    axisId: "integration_surface",
    label: "how it connects",
    positions: ["standalone", "api", "plugin", "embedded"],
  },
  {
    axisId: "data_regime",
    label: "how it handles data",
    positions: ["modality", "tenancy", "privacy_preserving"],
  },
  { axisId: "mechanism_family", label: "the core technique", positions: ["family"] },
  { axisId: "deployment_scale", label: "at what scale", positions: ["scale"] },
  {
    axisId: "degraded_offline",
    label: "when degraded or offline",
    positions: ["degraded", "offline"],
  },
  {
    axisId: "hardware_acceleration",
    label: "hardware acceleration of the method",
    positions: ["accelerated"],
  },
];
