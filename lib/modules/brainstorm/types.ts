/**
 * Module 0 — Brainstorming engine. Type contracts (pure; no server-only imports).
 *
 * The backstage engine that never faces the user (the curtain law): it generates a
 * diverse population of software-invention stubs, scores them, selects a small
 * frontier, and reverses each champion's derivation into a Socratic question walk.
 * The Helper fronts all of it; the user only ever experiences the walk.
 */

import type { AgentRunner } from "@/lib/modules/shared";

export type { AgentRunner } from "@/lib/modules/shared";

/** Who the user is — selects analogies + the entry point for the Socratic walk. */
export type Backpack = {
  /** Role / background (e.g. "backend engineer", "schoolteacher"). */
  background: string;
  /** What they already know in the domain — frames how technical an analogy can be. */
  domainFamiliarity: string;
  notes?: string;
};

/** A sub-problem of the user's problem — the first generation axis. */
export type SubProblem = { key: string; desc: string };

/** One cell of the diversity grid (built in code — 0 tokens). */
export type GridCell = {
  id: string;
  problem: string;
  problemDesc: string;
  family: string;
  mechanismClass: string;
  constraint: string;
};

/** A grid cell instantiated by the cheap model into a terse technical stub. */
export type Stub = GridCell & {
  handle: string;
  mechanism: string;
  operatesOn: string;
  noveltyLocus: string;
  costProfile: string;
};

export type MarketConfidence = "thin" | "moderate" | "strong";

/** A stub with idea-level scores (per-idea) + problem-level market signal (shared). */
export type ScoredStub = Stub & {
  difficulty: number;
  elegance: number;
  scoreNote: string;
  marketSignal: number;
  marketConfidence: MarketConfidence;
};

export type ChampionReason =
  | "strongest-mechanism"
  | "most-elegant"
  | "strongest-market";

/** A frontier champion — best in its descriptor cell, surfaced for one reason. */
export type Champion = ScoredStub & {
  cell: string;
  reason: ChampionReason;
};

/** One fork in the chain that produced a mechanism (the reversal compiler's input). */
export type DerivationStep = {
  id: string;
  question: string;
  options: string[];
  chosen: string;
  why: string;
};

export type DerivationTrace = {
  problem: string;
  mechanism: string;
  operatesOn?: string;
  steps: DerivationStep[];
};

/** One question in the Socratic walk — poses a choice, never the answer. */
export type ReversalQuestion = {
  order: number;
  /** Shown to the user. */
  prompt: string;
  analogy?: string;
  /** HIDDEN: the choice that moves toward the mechanism. */
  intended_choice: string;
  /** Other plausible choices — divergence is allowed. */
  alternatives: string[];
  reverses_step: string;
};

/** The full Socratic walk for one champion. */
export type ReversalScript = {
  questions: ReversalQuestion[];
  /** The open invitation to state the idea in their own words (verbatim capture). */
  final_prompt: string;
  /** HIDDEN target the user should arrive at — for later verbatim comparison. */
  arrival_target: string;
  minimality_note: string;
};

/** A champion plus its reconstructed derivation and the Socratic walk for it. */
export type FrontierItem = {
  champion: Champion;
  trace: DerivationTrace;
  script: ReversalScript;
};

/** The backstage engine's full output. The front-of-house renders only the walk. */
export type BrainstormResult = {
  problem: string;
  gridSize: number;
  populationSize: number;
  frontier: FrontierItem[];
  /** Honest caveats surfaced to the user (e.g. thin market signal). */
  notes: string[];
};

export type AgentName =
  | "stub-generator"
  | "idea-scorer"
  | "derivation-tracer"
  | "reversal-compiler";

export type BrainstormDeps = {
  runAgent: AgentRunner;
  /** Decomposed sub-problems; defaults to the whole problem as one. */
  subProblems?: SubProblem[];
  /** Target population size (grid sample). Small for the in-app synchronous path. */
  n?: number;
};
