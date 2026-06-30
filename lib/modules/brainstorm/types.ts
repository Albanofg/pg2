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

/**
 * The structure under every patentable software core: two poles the inventor would
 * both want but can't fully have under one constraint; the invention is the
 * conditional rule that resolves them. The teach-the-tensor walk teaches the poles +
 * constraint (prior art) and leads the inventor to say the `conditionalCore`
 * themselves (the claim). `conditionalCore` is BACKSTAGE — never shown.
 */
export type Tensor = {
  poleA: string;
  poleB: string;
  constraint: string;
  collisionScene: string;
  /** Backstage target — the conditional resolution the inventor must reach. Never shown. */
  conditionalCore: string;
};

export type DerivationTrace = {
  problem: string;
  mechanism: string;
  operatesOn?: string;
  steps: DerivationStep[];
  /** The tensor under this mechanism — the walk's private map. */
  tensor?: Tensor;
};

/**
 * The interaction shape of one walk step (§7 connect-the-dots). Most steps are pure
 * CLICK games — the inventor answers by TAPPING, never typing:
 *  - "this_or_that" — exactly two big tappable options ("is it more like X or Y?").
 *  - "pick"         — a few tappable options to choose among.
 * Only the COLLISION question is "say_it": the inventor types the conditional core in
 * their OWN words (the claimed core — legally must be theirs, never the machine's).
 */
export type WalkInteractionKind = "this_or_that" | "pick" | "say_it";

/** One step in the adaptive walk — a teach-the-tension move rendered as a small game. */
export type WalkQuestion = {
  /** The situation / the thing being asked (no jammed-in menu). */
  prompt: string;
  /** Optional one-line why-it-matters. */
  why?: string;
  /** The game shape. Teaching moves are clicks; only the collision question is typed. */
  kind: WalkInteractionKind;
  /**
   * The tappable options. this_or_that = exactly 2; pick = 2–4 choices; say_it =
   * optional starter sparks the inventor can edit (never the answer flagged as right).
   */
  alternatives: string[];
};

/**
 * One adaptive step the brainstorming partner emits, given the conversation so
 * far. The walk is generated one step at a time and REACTS to the inventor's
 * actual answers — there is no pre-baked question list and no fixed count.
 */
export type ReversalStep = {
  /** Opening move only: a short, curtain-safe framing of this direction for the frontier card. */
  angle?: string;
  /** A short reaction to the inventor's last answer (empty on the opening move). */
  reaction: string;
  /** True when the inventor has effectively produced the mechanism in their own words. */
  done: boolean;
  /** The next question, if not done. */
  question?: WalkQuestion;
  /** When done: the open invitation to state the invention in their own words. */
  arrivalPrompt?: string;
  /**
   * No Tier 4 (deep spec §6.5): the stall ladder is exhausted — this part is worth a
   * human expert's eye. The machine NEVER states the answer. Soft terminal, not a block.
   */
  routeToHuman?: boolean;
  /** The current stall tier, threaded back so the next step advances the no-Tier-4 floor. */
  stallTier?: number;
};

/** One turn of the walk, sent back so the next step can react to it. */
export type WalkTurn = { question: string; answer: string };

export type MarketIncumbent = { name: string; what: string };

/**
 * The honest breakthrough verdict for a direction (the doc's load-bearing move):
 *  - "clean"    — genuinely open whitespace; a real breakthrough is reachable here.
 *  - "crowded"  — loved but occupied; the obvious version is taken (great business,
 *                 hard patent) — only the steer below has a chance.
 *  - "durable"  — a coupling/template far from abstract that mints variations.
 */
export type BreakthroughVerdict = "clean" | "crowded" | "durable";

/** The honest competitive "market read" shown on a frontier card. */
export type MarketRead = {
  incumbents: MarketIncumbent[];
  whitespace: string;
  /** Is there a breakthrough here, or is it occupied? Drives the recommendation
   *  and gates whether the inventor is questioned on this direction. */
  verdict: BreakthroughVerdict;
  /**
   * The specific how-plus-constraint ONE LEVEL BELOW the vertical that the claim
   * must rest on — the real breakthrough to aim at, especially when crowded
   * (the doc's "your claim must be the self-calibrating method, not weather+health").
   */
  steer: string;
  /** "searched" = grounded in live web results; "model" = the model's own knowledge (verify). */
  confidence: "searched" | "model";
};

/**
 * The three excavation lenses (the doc's Step-1): the latent NEED under the noun,
 * a claimable MECHANISM (how + constraint), and a strategic MARKET fork.
 */
export type Lens = "need" | "mechanism" | "market";

/** One Step-1 card — a sharper restatement of the spark through one lens. */
export type LensCard = {
  lens: Lens;
  label: string;
  /** The idea handed back sharper, in the inventor's world (the delight). */
  restatement: string;
  /** The part that would survive an examiner — plain language, no statutes. */
  mechanism: string;
  marketRead?: MarketRead;
  recommended?: boolean;
};

/** The single optional clarifier chip-row that sharpens all three cards. */
export type Clarifier = { prompt: string; chips: string[] };

/** The Step-1 frontier: three lens cards + an optional clarifier. */
export type ExcavationFrontier = {
  spark: string;
  clarifier?: Clarifier;
  cards: LensCard[];
  notes: string[];
  /**
   * "vague" = a problem/noun to excavate into 3 directions (the normal path). "formed"
   * = the input is ALREADY a specific invention (e.g. a patent abstract); there is
   * nothing to dig out, so the walk is skipped and the inventor is moved straight
   * forward in their own words. Defaults to "vague" when absent.
   */
  mode?: "vague" | "formed";
  /** When mode === "formed": a plain-language restatement of the already-formed invention. */
  reflected?: string;
  /** When mode === "formed": the honest market read on that invention. */
  formedMarket?: MarketRead;
};

/** A champion + its (backstage) derivation + the OPENING step of its walk + market read. */
export type FrontierItem = {
  champion: Champion;
  trace: DerivationTrace;
  opener: ReversalStep;
  /** The competitive read for this direction (incumbents + whitespace). */
  marketRead?: MarketRead;
  /** One direction is flagged recommended (cleanest whitespace / strongest mechanism). */
  recommended?: boolean;
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
  | "reversal-compiler"
  | "market-analyst"
  | "excavator"
  | "section-101"
  | "tensor-finder"
  | "conception-evaluator"
  | "input-classifier"
  | "deepener";

export type BrainstormDeps = {
  runAgent: AgentRunner;
  /** Decomposed sub-problems; defaults to the whole problem as one. */
  subProblems?: SubProblem[];
  /** Target population size (grid sample). Small for the in-app synchronous path. */
  n?: number;
};
