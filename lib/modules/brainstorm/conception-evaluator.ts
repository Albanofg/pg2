/**
 * Module 0 — the CONCEPTION EVALUATOR (the conditionality gate).
 *
 * This is the single most legally load-bearing unit in Patent Geyser (deep spec
 * §6.4–6.5, §11.2, §12 step 2). It exists as its OWN module, in a SEPARATE context
 * from the teaching engine, so the cheap "generate the next move" pass and the strict
 * "did the human conceive?" judgment never share a head.
 *
 * Three laws are enforced HERE, in code — never merely asked of a model:
 *  1. A reply counts as conception ONLY if it is a CONDITIONAL resolution (weighs /
 *     switches / merges / routes ON a condition). A side-pick or a restated pole is not.
 *  2. The stall ladder has NO TIER 4. After tier 3, route to a human. The system never
 *     states the answer. (Enforced by `applyStallFloor`, not by the LLM.)
 *  3. The evaluator never authors a resolution and never fills the inventor's verbatim
 *     words. Its output is a pure JUDGMENT object. The verbatim conception belongs to
 *     the inventor's own reply, owned by the caller — never fabricated here.
 *
 * The deterministic layer (`conditionalitySignal`, `applyStallFloor`) is pure and
 * unit-testable with zero API calls — see `GATE_CASES` + `selfTestGate()` and
 * `scripts/test-conception-gate.ts`. The LLM only judges the genuinely ambiguous
 * middle, and even then the floor and routing are decided in code around it.
 */

import { z } from "zod";
import type { AgentRunner } from "@/lib/modules/shared";

/** The tension the reply is judged against — the two poles + the constraint. NEVER
 *  the resolving mechanism: the evaluator is not given the answer, so it cannot leak one. */
export type ConceptionTension = {
  poleA: string;
  poleB: string;
  constraint: string;
  /** Optional biting scene, for context only. */
  collisionScene?: string;
};

/** The evaluator's pure judgment object (deep spec §11.2). No verbatim, no authored answer. */
export type ConceptionVerdict = {
  /** True ONLY when the reply conditionally resolves the tension. */
  isConditional: boolean;
  /** A short paraphrase of the condition the inventor named — never an authored resolution. */
  detectedCondition: string;
  /** The stall tier to run next (1→2→3). 0 means "arrived, no stall." */
  nextStallTier: number;
  /** True when the ladder is exhausted (past tier 3) — route to a human; never state the answer. */
  routeToHuman: boolean;
};

/** The LLM judge's minimal output. The floor + routing are computed in code, NOT here. */
export const ConceptionEvaluatorOutput = z.object({
  is_conditional: z.boolean(),
  detected_condition: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.5),
});

/**
 * Words that signal a reply branches ON a condition (the trigger half of a conditional
 * rule). Matched on word boundaries against a normalized reply.
 */
const CONDITION_MARKERS = [
  "when",
  "whenever",
  "if",
  "unless",
  "otherwise",
  "else",
  "depends",
  "depend",
  "based on",
  "according to",
  "whichever",
  "whatever",
  "only if",
  "in case",
  "as long as",
  "until",
];

/**
 * Verbs that signal the reply DOES something with the two sides (the action half:
 * weighs / switches / merges / routes). Conception needs BOTH a condition and an action.
 */
const ARBITRATION_RE =
  /\b(weigh|weighs|weighing|switch|switches|switching|merge|merges|merging|route|routes|routing|pick|picks|choose|chooses|combine|combines|blend|blends|fuse|fuses|favou?r|favou?rs|prioriti[sz]e|prioriti[sz]es|defer|defers|override|overrides|fall ?back|falls ?back|trust|trusts|go with|use the|rely on)\b/;

/** A second branch ("…otherwise/else the other") — the strongest conditional shape. */
const TWO_BRANCH_RE = /\b(otherwise|else|instead|but if|and if|or else|fall ?back)\b/;

function normalize(reply: string): string {
  return ` ${reply.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

/**
 * The deterministic conditionality SIGNAL — pure, fast, 0 tokens, fully testable.
 *  - "none"   : no condition marker at all → a side-pick or restated pole. A clear FAIL;
 *               the live path short-circuits to false without ever calling the model.
 *  - "weak"   : one marker but no clear action / second branch (e.g. "it depends") →
 *               genuinely ambiguous; the strict LLM judge decides.
 *  - "strong" : a condition marker PLUS an arbitration action and/or a second branch →
 *               a clear conditional resolution; the LLM still confirms it's on-target.
 *
 * The signal is a PRIOR, not the verdict (semantics are the LLM's job) — except that
 * "none" is treated as a deterministic false, since no condition = no conception.
 */
export function conditionalitySignal(reply: string): {
  markers: string[];
  hasAction: boolean;
  hasTwoBranch: boolean;
  level: "none" | "weak" | "strong";
} {
  const text = normalize(reply);
  const markers = CONDITION_MARKERS.filter((m) => text.includes(` ${m} `));
  const hasAction = ARBITRATION_RE.test(reply.toLowerCase());
  const hasTwoBranch = TWO_BRANCH_RE.test(reply.toLowerCase());
  let level: "none" | "weak" | "strong";
  if (markers.length === 0) {
    level = "none";
  } else if (markers.length >= 2 || hasTwoBranch || (markers.length >= 1 && hasAction)) {
    level = "strong";
  } else {
    level = "weak";
  }
  return { markers, hasAction, hasTwoBranch, level };
}

/**
 * The NO-TIER-4 floor — enforced in code, never by the model (deep spec §6.5, §13 risk 1).
 * A conditional reply arrives (tier resets, no routing). A non-conditional reply advances
 * the ladder one rung; past tier 3 (i.e. tier 4) the only move is routing to a human —
 * the system NEVER states the answer itself.
 */
export function applyStallFloor(
  isConditional: boolean,
  priorStallTier: number,
): { nextStallTier: number; routeToHuman: boolean } {
  if (isConditional) return { nextStallTier: 0, routeToHuman: false };
  const nextStallTier = Math.max(0, priorStallTier) + 1;
  return { nextStallTier, routeToHuman: nextStallTier > 3 };
}

/**
 * The full gate. Decides whether the inventor's reply conditionally resolves the tension,
 * and what to do next — with the floor + routing always decided in code.
 *
 * `runAgent` is injected so the gate is testable with a mocked model.
 */
export async function runConceptionEvaluator(
  runAgent: AgentRunner,
  input: { reply: string; tension: ConceptionTension; priorStallTier?: number },
): Promise<ConceptionVerdict> {
  const priorStallTier = input.priorStallTier ?? 0;
  const reply = input.reply.trim();
  const signal = conditionalitySignal(reply);

  // 90/10: a reply with ZERO conditional structure is a side-pick or a restated pole —
  // not conception. Decide it deterministically; spend no token, and never let a model
  // be talked into calling a flat answer "conditional."
  if (!reply || signal.level === "none") {
    return { isConditional: false, detectedCondition: "", ...applyStallFloor(false, priorStallTier) };
  }

  // The ambiguous middle: the STRICT, separate-context judge decides whether the reply
  // conditionally RESOLVES this tension. It is given the poles + constraint but NOT the
  // answer, so it can never leak one; it only judges and paraphrases the condition heard.
  // Dynamic import so the pure gate layer above stays importable from a plain test script
  // (agents.ts is server-only).
  const { loadPrompt } = await import("./agents");
  const system = await loadPrompt("conception-evaluator");
  const prompt = [
    `POLE_A: ${input.tension.poleA}`,
    `POLE_B: ${input.tension.poleB}`,
    `CONSTRAINT: ${input.tension.constraint}`,
    ...(input.tension.collisionScene ? [`COLLISION: ${input.tension.collisionScene}`] : []),
    "",
    "INVENTOR_REPLY (judge ONLY this):",
    reply,
  ].join("\n");
  const out = await runAgent({
    agent: "conception-evaluator",
    system,
    prompt,
    schema: ConceptionEvaluatorOutput,
    temperature: 0,
  });

  // The floor + routing are decided in CODE around the model's judgment, never by it.
  return {
    isConditional: out.is_conditional,
    detectedCondition: out.is_conditional ? out.detected_condition : "",
    ...applyStallFloor(out.is_conditional, priorStallTier),
  };
}

/* ------------------------------------------------------------------ *
 * Standalone test surface (deep spec §12 step 2: the riskiest part,
 * tested in isolation before any wiring). Run: see scripts/test-conception-gate.ts
 * ------------------------------------------------------------------ */

/** Canonical cases for the deterministic SIGNAL layer. `none` = clear fail (deterministic
 *  false), `strong` = clear conditional resolution, `weak` = ambiguous (needs the LLM). */
export const GATE_CASES: { reply: string; expectLevel: "none" | "weak" | "strong"; note: string }[] = [
  { reply: "Trust the phone.", expectLevel: "none", note: "side-pick, no condition (spec §6.4 fail)" },
  { reply: "Use the barometer.", expectLevel: "none", note: "side-pick" },
  { reply: "The forecast is usually right.", expectLevel: "none", note: "restated pole" },
  { reply: "I like the offline one better.", expectLevel: "none", note: "preference, no condition" },
  {
    reply: "Trust the phone when they disagree or you're offline, otherwise trust the forecast.",
    expectLevel: "strong",
    note: "the canonical pass (spec §6.4): trigger + action + second branch",
  },
  {
    reply: "Weigh them and switch to the local one when the gap gets large.",
    expectLevel: "strong",
    note: "arbitration action + condition",
  },
  {
    reply: "Go with whichever changed most recently, else fall back to the forecast.",
    expectLevel: "strong",
    note: "whichever + else (two branches)",
  },
  {
    reply: "If the sensor and the forecast diverge, override with the sensor.",
    expectLevel: "strong",
    note: "if + override action",
  },
  { reply: "It depends.", expectLevel: "weak", note: "a condition word but no action/branch — ambiguous, needs probe" },
  { reply: "Maybe trust whatever feels right.", expectLevel: "strong", note: "whatever + trust — leans pass; LLM confirms on-target" },
];

export type GateTestResult = { reply: string; expected: string; got: string; pass: boolean; note: string };

/** Run the deterministic signal layer over the canonical table. Pure; no API calls. */
export function selfTestGate(): { passed: number; failed: number; results: GateTestResult[] } {
  const results: GateTestResult[] = GATE_CASES.map((c) => {
    const got = conditionalitySignal(c.reply).level;
    return { reply: c.reply, expected: c.expectLevel, got, pass: got === c.expectLevel, note: c.note };
  });

  // The no-Tier-4 floor: four flat replies must route to a human at tier 4; a conditional
  // reply at any tier arrives without routing.
  const floorWalk = [
    applyStallFloor(false, 0), // → tier 1
    applyStallFloor(false, 1), // → tier 2
    applyStallFloor(false, 2), // → tier 3
    applyStallFloor(false, 3), // → tier 4 → route
  ];
  const floorPass =
    floorWalk[0].nextStallTier === 1 &&
    !floorWalk[0].routeToHuman &&
    floorWalk[1].nextStallTier === 2 &&
    !floorWalk[1].routeToHuman &&
    floorWalk[2].nextStallTier === 3 &&
    !floorWalk[2].routeToHuman &&
    floorWalk[3].nextStallTier === 4 &&
    floorWalk[3].routeToHuman === true &&
    applyStallFloor(true, 2).routeToHuman === false &&
    applyStallFloor(true, 2).nextStallTier === 0;
  results.push({
    reply: "(floor) 0→1→2→3→route; conditional resets",
    expected: "no Tier 4",
    got: floorPass ? "no Tier 4" : "FLOOR BROKEN",
    pass: floorPass,
    note: "spec §6.5 no-Tier-4 floor, enforced in code",
  });

  const failed = results.filter((r) => !r.pass).length;
  return { passed: results.length - failed, failed, results };
}
