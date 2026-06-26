/**
 * The diversity grid — built in CODE, not coaxed from a model (mode-collapse is a
 * model property, not a prompt bug). Diversity is the Cartesian product of three
 * orthogonal axes; two cells with different mechanism classes cannot reskin into
 * the same idea. Growing the population means adding axis values, never asking the
 * model for "more". This file costs 0 tokens.
 */

import type { GridCell, SubProblem } from "./types";

/**
 * AXIS 2 (load-bearing): mechanism classes — what a software invention actually
 * CHANGES. Four families, ~sixteen classes. This taxonomy is the diversity engine.
 */
export const MECHANISMS: Record<string, string[]> = {
  computation: [
    "replace exact with approximate/probabilistic",
    "replace a hand-tuned heuristic with a learned model",
    "precompute / compile / amortize to build-time",
    "incrementalize (deltas/streaming, not batch)",
    "make lazy / on-demand",
  ],
  representation: [
    "re-encode / change coordinates (embed, quantize, change basis)",
    "restructure the index (how lookup is organized)",
    "exploit sparsity / latent structure (compress, prune, factorize)",
  ],
  coordination: [
    "redistribute / parallelize / shard",
    "relax the consistency/coordination protocol (async, optimistic)",
    "relocate across the memory/storage/hardware hierarchy",
    "disaggregate coupled components",
  ],
  adaptation: [
    "change the training objective / regularization",
    "construct the training signal / data regime",
    "add a closed feedback/control loop",
    "recompose the human-in-the-loop division of labor",
  ],
};

/** Flattened (family, mechanism) pairs. */
export const MECH_PAIRS: { family: string; mechanism: string }[] = Object.entries(
  MECHANISMS,
).flatMap(([family, ms]) => ms.map((mechanism) => ({ family, mechanism })));

/** AXIS 3: deployment constraints — context forces different designs. */
export const CONSTRAINTS: string[] = [
  "local single-user",
  "multi-tenant SaaS",
  "hard cost cap",
  "interactive latency cap",
  "offline / batch only",
  "privacy-bound (no external calls)",
  "adversarial / robustness-first",
  "greenfield (no prior corpus/history)",
];

/**
 * Build the population skeleton: the Cartesian product of (sub-problems x mechanism
 * pairs x constraints), stratified so EVERY (problem x mechanism) pair appears at
 * least once before the remaining budget is spent on constraint variety. Fully
 * deterministic (no RNG) so the same inputs always yield the same grid.
 */
export function buildGrid(subProblems: SubProblem[], nTarget: number): GridCell[] {
  const cell = (
    p: SubProblem,
    mp: { family: string; mechanism: string },
    constraint: string,
  ): GridCell => ({
    id: "",
    problem: p.key,
    problemDesc: p.desc,
    family: mp.family,
    mechanismClass: mp.mechanism,
    constraint,
  });
  const keyOf = (c: GridCell) => `${c.problem}|${c.mechanismClass}|${c.constraint}`;

  // Base layer: one constraint per (problem x mechanism) pair, rotating the
  // constraint so variety is spread evenly. Guarantees full pair coverage.
  const pairs: { p: SubProblem; mp: { family: string; mechanism: string } }[] = [];
  for (const p of subProblems) for (const mp of MECH_PAIRS) pairs.push({ p, mp });
  const base = pairs.map((pr, idx) =>
    cell(pr.p, pr.mp, CONSTRAINTS[idx % CONSTRAINTS.length]),
  );
  const baseKeys = new Set(base.map(keyOf));

  // Fill layer: the remaining (problem x mechanism x constraint) combos, in order.
  const fill: GridCell[] = [];
  for (const p of subProblems) {
    for (const mp of MECH_PAIRS) {
      for (const c of CONSTRAINTS) {
        const cl = cell(p, mp, c);
        if (!baseKeys.has(keyOf(cl))) fill.push(cl);
      }
    }
  }

  const grid = [...base, ...fill].slice(0, Math.max(1, nTarget));
  grid.forEach((c, i) => {
    c.id = `${c.problem}-${c.family.slice(0, 4)}-${i.toString().padStart(3, "0")}`;
  });
  return grid;
}

/** The full grid size for a given set of sub-problems (for reporting). */
export function fullGridSize(subProblemCount: number): number {
  return subProblemCount * MECH_PAIRS.length * CONSTRAINTS.length;
}
