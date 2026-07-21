/**
 * Module 0 — Orientation. Structured discovery state model.
 *
 * The pre-Conception front porch, redesigned as a GUIDED MECHANISM DISCOVERY
 * system (not a chat). It moves an idea down three layers — commercial objective →
 * information process → machine mechanism — and specifically toward a mechanism
 * that RESOLVES a conflict between two technical requirements. It routes a
 * developed technical idea straight to Module 1, and puts a business/vague idea
 * through a phase state machine.
 *
 * The session keeps a STRUCTURED state (not only conversation text) with a
 * PROVENANCE MAP: every clause records whether the inventor stated it, selected
 * it, or the system inferred/suggested it. This is what keeps the app from
 * silently inventing the inventive step, and what feeds a traceable brief.
 *
 * Pure (no server-only imports). Cross-module currency re-exported from shared.
 */

import type {
  AgentRunner,
  EvidenceLedger,
  HelperTurn,
  LedgerEntry,
} from "@/lib/modules/shared";

export type { HelperTurn, LedgerEntry } from "@/lib/modules/shared";

/* ------------------------------------------------------------------ *
 * Provenance — the heart of "never silently invent"
 * ------------------------------------------------------------------ */

/** Where a piece of the discovered idea came from. Drives how the UI shows it
 *  (confirmed vs. a suggestion vs. an open gap) and keeps the brief traceable. */
export type ClauseOrigin =
  | "user_stated" // the inventor typed it in their own words
  | "user_selected" // the inventor tapped a category/direction we offered
  | "system_inferred" // we read it from what they said (shown as a suggestion)
  | "system_suggested"; // we proposed it (shown as a suggestion; must be approved)

/** One traceable unit of the discovered idea. */
export type Clause = {
  id: string;
  text: string;
  origin: ClauseOrigin;
  /** Whether the inventor has explicitly approved this clause (required before it
   *  is treated as part of the mechanism). user_stated/user_selected start true. */
  approved: boolean;
  /** Ids of the inventor answers (ledger entries) this traces back to. */
  sourceAnswerIds?: string[];
};

/* ------------------------------------------------------------------ *
 * The discovery artifacts (the three-layer / conflict model)
 * ------------------------------------------------------------------ */

/** Two technical requirements that fight each other — the centre of discovery. */
export type RequirementConflict = {
  id: string;
  /** "The system must …" */
  sideA: string;
  /** "But it must also …" */
  sideB: string;
  origin: ClauseOrigin;
  approved: boolean;
};

/** A machine state the mechanism moves through. */
export type MachineState = { id: string; name: string; origin: ClauseOrigin };

/** An ordered state transition that controls later behavior. */
export type StateTransition = { id: string; from: string; to: string; origin: ClauseOrigin };

/** A system component + its boundary (what it may and may not do). */
export type Component = {
  id: string;
  name: string;
  receives: string;
  mayAccess: string;
  changes: string;
  outputs: string;
  cannotDo: string;
  communicatesWith: string;
  origin: ClauseOrigin;
};

/** One step in the mechanism's ordered interaction (order matters). */
export type InteractionStep = { id: string; text: string; origin: ClauseOrigin };

/* ------------------------------------------------------------------ *
 * Mechanism Maturity Score — INTERNAL ONLY, never shown as a verdict.
 * Seven dimensions, each 0–3 (spec §5). Controls routing + phase depth.
 * ------------------------------------------------------------------ */

export type MaturityScore = {
  machineLimitation: number; // A
  machineMechanism: number; // B
  informationFlowChange: number; // C
  stateBehavior: number; // D
  machineOnlyBehavior: number; // E
  technicalCausation: number; // F
  measurableEffect: number; // G
};

export const EMPTY_MATURITY: MaturityScore = {
  machineLimitation: 0,
  machineMechanism: 0,
  informationFlowChange: 0,
  stateBehavior: 0,
  machineOnlyBehavior: 0,
  technicalCausation: 0,
  measurableEffect: 0,
};

export function maturityTotal(m: MaturityScore): number {
  return (
    m.machineLimitation +
    m.machineMechanism +
    m.informationFlowChange +
    m.stateBehavior +
    m.machineOnlyBehavior +
    m.technicalCausation +
    m.measurableEffect
  );
}

/* ------------------------------------------------------------------ *
 * Phases (spec §6). Not every idea visits every phase — the maturity
 * route and the exit criteria decide when to stop.
 * ------------------------------------------------------------------ */

export type DiscoveryPhase =
  | "objective" // capture the commercial objective
  | "process" // extract the ordinary information process
  | "baseline" // establish the ordinary implementation + its failures
  | "limitation" // translate a failure into a machine limitation
  | "conflict" // build a requirement conflict
  | "mechanism" // the inventor resolves the conflict (their mechanism)
  | "synthesis" // mandatory mechanism synthesis (approve/edit)
  | "states" // define machine states + transitions
  | "flow" // define components, boundaries, information flow
  | "interaction" // ordered interaction (order matters)
  | "effect" // technical causation + human-performance test
  | "choose"; // user-controlled stopping point (continue / explore / brief)

export type Module0Phase =
  | "empty" // before an idea is dropped
  | "forward" // routed straight toward Module 1 (developed idea)
  | "discovery" // in the phase state machine
  | "brief_ready"; // brief assembled

/* ------------------------------------------------------------------ *
 * The session (spec §11) — the structured discovery state.
 * ------------------------------------------------------------------ */

export type OrientationSession = {
  originalInput: string;
  route: "forward" | "discovery" | null;
  phase: Module0Phase;
  discoveryPhase: DiscoveryPhase;
  maturity: MaturityScore;

  commercialObjective: Clause | null;
  informationProcess: Clause[];
  ordinaryImplementation: Clause | null;
  failureCases: Clause[];
  machineLimitations: Clause[];
  requirements: Clause[];
  requirementConflicts: RequirementConflict[];
  mechanismDirections: Clause[];
  /** The approved resolving mechanism, clause by clause (provenance-tagged). */
  approvedMechanism: Clause[];
  machineStates: MachineState[];
  stateTransitions: StateTransition[];
  components: Component[];
  informationFlows: Clause[];
  orderedInteractions: InteractionStep[];
  technicalEffects: Clause[];
  humanPerformanceFindings: Clause[];
  unresolvedGaps: Clause[];
};

/* ------------------------------------------------------------------ *
 * The view the panel renders — a projection of the session.
 * ------------------------------------------------------------------ */

export type Module0View = {
  phase: Module0Phase;
  route: "forward" | "discovery" | null;
  /** Which discovery phase the machine is in right now. */
  discoveryPhase: DiscoveryPhase;
  conversation: HelperTurn[];
  /** The structured discovery so far — what the panel renders phase-specific UIs from. */
  session: OrientationSession;
  /** The best current one-sentence summary of the mechanism (for the progress card). */
  mechanism: string;
  /** True once discovery reached a real mechanism (limitation + conflict + resolving
   *  mechanism + machine-dependent op + technical effect), or immediately on forward. */
  canWriteBrief: boolean;
  brief: string;
  ledger: LedgerEntry[];
};

/* ------------------------------------------------------------------ *
 * Ledger vocabulary
 * ------------------------------------------------------------------ */

export type LedgerEntryType =
  | "inventor_input" // the raw idea, or a mechanism the inventor states in their own words
  | "inventor_note" // a free-text message / phase answer
  | "orientation_started"
  | "orientation_routed"
  | "orientation_helper"
  | "orientation_synthesis" // a synthesis the inventor approved
  | "brief_built"
  | "orientation_completed";

/** Types recorded as inventor verbatim. Kept identical to Conception's so the
 *  ledger chains cleanly into Module 1. */
export const ORIENTATION_HUMAN_SOURCE_TYPES: ReadonlySet<string> = new Set<LedgerEntryType>([
  "inventor_input",
  "inventor_note",
]);

/* ------------------------------------------------------------------ *
 * Agents + deps
 * ------------------------------------------------------------------ */

/** The sub-agents Module 0 calls. Never user-facing. */
export type AgentName = "helper" | "brief-writer" | "router" | "structurer";

export type OrientationDeps = {
  runAgent: AgentRunner;
  /** Optional shared ledger (Orientation is normally the chain ORIGIN). */
  ledger?: EvidenceLedger;
  now?: () => string;
  genId?: () => string;
};
