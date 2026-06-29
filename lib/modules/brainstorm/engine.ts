import "server-only";
import { buildGrid, fullGridSize } from "./grid";
import {
  runDerivationTracer,
  runIdeaScorer,
  runMarketAnalyst,
  runReversalStep,
  runStubGenerator,
} from "./agents";
import { marketSearchEnabled, searchMarket } from "./market";
import type {
  AgentRunner,
  Backpack,
  BrainstormResult,
  Champion,
  ChampionReason,
  FrontierItem,
  ScoredStub,
  Stub,
  SubProblem,
} from "./types";

/** Cells per generation call. The cheap model handles a tile in one structured call. */
const TILE = 24;

/**
 * The backstage engine, end to end:
 *   grid (code, 0 tokens) -> generate stubs (cheap model) -> score (idea-level) ->
 *   MAP-Elites select a diverse frontier -> trace + reverse each champion.
 * Returns a small frontier of genuinely-different inventions, each with the
 * Socratic walk that lets the user re-conceive it themselves. Nothing here faces
 * the user — the front-of-house renders only the walks (the curtain law).
 */
export async function runBrainstormEngine(
  runAgent: AgentRunner,
  input: {
    problem: string;
    backpack: Backpack;
    subProblems?: SubProblem[];
    n?: number;
  },
): Promise<BrainstormResult> {
  const subs: SubProblem[] = input.subProblems?.length
    ? input.subProblems
    : [{ key: "core", desc: input.problem }];
  const n = input.n ?? 18;
  const grid = buildGrid(subs, n);
  const notes: string[] = [];

  // 1) GENERATE — instantiate cells into terse stubs, tiled.
  const stubs: Stub[] = [];
  for (let i = 0; i < grid.length; i += TILE) {
    try {
      const out = await runStubGenerator(runAgent, grid.slice(i, i + TILE));
      stubs.push(...out);
    } catch (err) {
      console.error("[brainstorm] stub generation failed for a tile", err);
    }
  }
  const population = stubs.filter((s) => s.mechanism.trim().length > 0);
  if (!population.length) {
    return {
      problem: input.problem,
      gridSize: fullGridSize(subs.length),
      populationSize: 0,
      frontier: [],
      notes: ["Generation returned no usable stubs — try again or widen the grid."],
    };
  }

  // 2) SCORE — the two genuinely per-idea dimensions (batched). Market signal is a
  // PROBLEM-level property needing retrieval we haven't wired, so we mark it thin
  // rather than fabricate a number (spec §5.3 — never dress a guess as a finding).
  let scored: ScoredStub[];
  try {
    const scores = await runIdeaScorer(runAgent, population);
    const byIdx = new Map(scores.map((s) => [s.i, s]));
    scored = population.map((s, i) => {
      const sc = byIdx.get(i);
      return {
        ...s,
        difficulty: sc?.difficulty ?? 0.5,
        elegance: sc?.elegance ?? 0.5,
        scoreNote: sc?.note ?? "",
        marketSignal: 0.5,
        marketConfidence: "thin" as const,
      };
    });
  } catch (err) {
    console.error("[brainstorm] scoring failed; neutral scores", err);
    scored = population.map((s) => ({
      ...s,
      difficulty: 0.5,
      elegance: 0.5,
      scoreNote: "",
      marketSignal: 0.5,
      marketConfidence: "thin" as const,
    }));
  }

  // 3) SELECT — MAP-Elites (best per descriptor cell), then a frontier of three
  // genuinely-different champions (not three flavors of one). Never a single
  // weighted-sum winner — that discards the specialist.
  const elites = mapElites(scored);
  const champions = pickFrontier(elites);

  // 4) REVERSE — reconstruct each champion's derivation, then open its walk with
  // the FIRST adaptive step (empty conversation). The rest of the walk is
  // generated step-by-step as the inventor answers (see the step route).
  const frontier: FrontierItem[] = [];
  for (const champ of champions) {
    try {
      const trace = await runDerivationTracer(runAgent, {
        problem: champ.problemDesc,
        mechanism: champ.mechanism,
        operatesOn: champ.operatesOn,
      });
      const opener = await runReversalStep(runAgent, {
        trace,
        backpack: input.backpack,
        conversation: [],
      });
      frontier.push({ champion: champ, trace, opener });
    } catch (err) {
      console.error("[brainstorm] reverse failed for", champ.handle, err);
    }
  }

  // 5) MARKET READ — ground each direction in real competition at the ideation
  // moment (the differentiator: nobody else front-loads this). Parallel; a search
  // key makes it live, else the analyst falls back to model knowledge.
  await Promise.all(
    frontier.map(async (item) => {
      try {
        const query = `${item.champion.problemDesc} ${item.champion.handle} — existing products, competitors, tools`;
        const evidence = await searchMarket(query);
        item.marketRead = await runMarketAnalyst(runAgent, {
          problem: item.champion.problemDesc,
          direction: `${item.champion.handle}: ${item.champion.mechanism}`,
          evidence,
        });
      } catch (err) {
        console.error("[brainstorm] market read failed for", item.champion.handle, err);
      }
    }),
  );

  // Recommend the strongest-mechanism direction — the cleanest claimable whitespace.
  const rec =
    frontier.find((f) => f.champion.reason === "strongest-mechanism") ?? frontier[0];
  if (rec) rec.recommended = true;

  if (!marketSearchEnabled() && frontier.some((f) => f.marketRead)) {
    notes.push(
      "Market reads are from the model's knowledge (no live search wired yet) — verify the competitors before relying on them.",
    );
  }

  return {
    problem: input.problem,
    gridSize: fullGridSize(subs.length),
    populationSize: population.length,
    frontier,
    notes,
  };
}

/* ------------------------------------------------------------------ */

const ideaScore = (s: ScoredStub) => s.difficulty * 0.6 + s.elegance * 0.4;
const cellOf = (s: ScoredStub) => `${s.noveltyLocus || s.family}|${s.costProfile || "?"}`;

/** Keep only the best candidate in each descriptor cell — diversity by construction. */
function mapElites(scored: ScoredStub[]): ScoredStub[] {
  const best = new Map<string, ScoredStub>();
  for (const s of scored) {
    const cell = cellOf(s);
    const cur = best.get(cell);
    if (!cur || ideaScore(s) > ideaScore(cur)) best.set(cell, s);
  }
  return [...best.values()];
}

/** Three genuinely-different champions: strongest mechanism, most elegant, strongest market. */
function pickFrontier(elites: ScoredStub[]): Champion[] {
  const used = new Set<string>();
  const out: Champion[] = [];
  const pick = (reason: ChampionReason, rank: (s: ScoredStub) => number) => {
    const choice = [...elites]
      .sort((a, b) => rank(b) - rank(a))
      .find((s) => !used.has(s.id));
    if (!choice) return; // fewer distinct elites than reasons — surface fewer, honestly
    used.add(choice.id);
    out.push({ ...choice, cell: cellOf(choice), reason });
  };
  pick("strongest-mechanism", (s) => s.difficulty);
  pick("most-elegant", (s) => s.elegance);
  pick("strongest-market", (s) => s.marketSignal);
  return out;
}
