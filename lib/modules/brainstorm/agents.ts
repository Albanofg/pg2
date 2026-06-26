import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  AgentName,
  AgentRunner,
  Backpack,
  DerivationTrace,
  GridCell,
  ReversalScript,
  Stub,
} from "./types";

/**
 * Module 0's four backstage sub-agents. Module 0 owns each agent's prompt
 * (prompts/module-0-brainstorm/*.md) and its I/O schema; it does NOT own the model
 * transport — every call goes through the injected AgentRunner seam.
 *
 * Unlike the drafting modules, these prompts do NOT prepend the patent Backpack —
 * the brainstorming engine is a different concern (idea search + conception), so
 * each prompt stands alone.
 */

const DIR = "module-0-brainstorm";
const PROMPT_FILES: Record<AgentName, string> = {
  "stub-generator": `${DIR}/00-stub-generator.md`,
  "reversal-compiler": `${DIR}/01-reversal-compiler.md`,
  "derivation-tracer": `${DIR}/02-derivation-tracer.md`,
  "idea-scorer": `${DIR}/03-idea-scorer.md`,
};

const promptCache = new Map<AgentName, string>();

async function loadPrompt(agent: AgentName): Promise<string> {
  let contents = promptCache.get(agent);
  if (!contents) {
    const file = path.join(process.cwd(), "prompts", ...PROMPT_FILES[agent].split("/"));
    contents = (await readFile(file, "utf8")).trim();
    promptCache.set(agent, contents);
  }
  return contents;
}

/* ------------------------------------------------------------------ *
 * Schemas
 * ------------------------------------------------------------------ */

export const StubGenOutput = z.object({
  stubs: z
    .array(
      z.object({
        i: z.number(),
        handle: z.string().default(""),
        mechanism: z.string().default(""),
        operates_on: z.string().default(""),
        novelty_locus: z.string().default(""),
        cost_profile: z.string().default(""),
      }),
    )
    .default([]),
});

export const IdeaScorerOutput = z.object({
  scores: z
    .array(
      z.object({
        i: z.number(),
        difficulty: z.number().default(0.5),
        elegance: z.number().default(0.5),
        note: z.string().default(""),
      }),
    )
    .default([]),
});

export const DerivationTracerOutput = z.object({
  steps: z
    .array(
      z.object({
        id: z.string().default(""),
        question: z.string().default(""),
        options: z.array(z.string()).default([]),
        chosen: z.string().default(""),
        why: z.string().default(""),
      }),
    )
    .default([]),
});

export const ReversalOutput = z.object({
  questions: z
    .array(
      z.object({
        order: z.number().default(0),
        prompt: z.string().default(""),
        analogy: z.string().default(""),
        intended_choice: z.string().default(""),
        alternatives: z.array(z.string()).default([]),
        reverses_step: z.string().default(""),
      }),
    )
    .default([]),
  final_prompt: z.string().default(""),
  arrival_target: z.string().default(""),
  minimality_note: z.string().default(""),
});

/* ------------------------------------------------------------------ *
 * Run functions
 * ------------------------------------------------------------------ */

/** Instantiate a tile of grid cells into stubs. Cells merge back in code by index. */
export async function runStubGenerator(
  runAgent: AgentRunner,
  cells: GridCell[],
): Promise<Stub[]> {
  const system = await loadPrompt("stub-generator");
  const prompt = [
    "Generate one stub per coordinate below. Echo the SAME index i for each.",
    "",
    "Coordinates:",
    ...cells.map(
      (c, i) =>
        `${i}. problem="${c.problem}" (${c.problemDesc}) | mechanism="${c.mechanismClass}" | constraint="${c.constraint}"`,
    ),
  ].join("\n");
  const out = await runAgent({
    agent: "stub-generator",
    system,
    prompt,
    schema: StubGenOutput,
    temperature: 0.7,
  });
  const stubs: Stub[] = [];
  for (const g of out.stubs) {
    const c = cells[g.i];
    if (!c) continue;
    stubs.push({
      ...c,
      handle: g.handle,
      mechanism: g.mechanism,
      operatesOn: g.operates_on,
      noveltyLocus: g.novelty_locus,
      costProfile: g.cost_profile,
    });
  }
  return stubs;
}

export type IdeaScore = { i: number; difficulty: number; elegance: number; note: string };

/** Score a batch of stubs on the two genuinely per-idea dimensions. */
export async function runIdeaScorer(
  runAgent: AgentRunner,
  stubs: Stub[],
): Promise<IdeaScore[]> {
  const system = await loadPrompt("idea-scorer");
  const prompt = [
    "Score each candidate below. Return one entry per index i.",
    "",
    ...stubs.map(
      (s, i) => `${i}. handle="${s.handle}" | mechanism="${s.mechanism}" | operates_on="${s.operatesOn}"`,
    ),
  ].join("\n");
  const out = await runAgent({
    agent: "idea-scorer",
    system,
    prompt,
    schema: IdeaScorerOutput,
    temperature: 0.2,
  });
  return out.scores.map((s) => ({
    i: s.i,
    difficulty: clamp01(s.difficulty),
    elegance: clamp01(s.elegance),
    note: s.note,
  }));
}

/** Reconstruct the load-bearing derivation that produces one mechanism. */
export async function runDerivationTracer(
  runAgent: AgentRunner,
  input: { problem: string; mechanism: string; operatesOn?: string },
): Promise<DerivationTrace> {
  const system = await loadPrompt("derivation-tracer");
  const prompt = [
    `PROBLEM: ${input.problem}`,
    `MECHANISM: ${input.mechanism}`,
    ...(input.operatesOn ? [`OPERATES_ON: ${input.operatesOn}`] : []),
  ].join("\n");
  const out = await runAgent({
    agent: "derivation-tracer",
    system,
    prompt,
    schema: DerivationTracerOutput,
    temperature: 0.3,
  });
  return {
    problem: input.problem,
    mechanism: input.mechanism,
    ...(input.operatesOn ? { operatesOn: input.operatesOn } : {}),
    steps: out.steps.map((s, i) => ({ ...s, id: s.id || `s${i + 1}` })),
  };
}

/** Reverse a derivation trace into the minimal Socratic walk for THIS user. */
export async function runReversalCompiler(
  runAgent: AgentRunner,
  input: { trace: DerivationTrace; backpack: Backpack },
): Promise<ReversalScript> {
  const system = await loadPrompt("reversal-compiler");
  const t = input.trace;
  const prompt = [
    `PROBLEM: ${t.problem}`,
    `MECHANISM (the destination — NEVER reveal it): ${t.mechanism}`,
    ...(t.operatesOn ? [`OPERATES_ON: ${t.operatesOn}`] : []),
    "",
    "DERIVATION TRACE (the forks to reverse):",
    ...t.steps.map(
      (s) =>
        `- [${s.id}] ${s.question}\n    options: ${s.options.join(" | ")}\n    chosen: ${s.chosen}\n    why: ${s.why}`,
    ),
    "",
    "BACKPACK (who this user is — pick analogies they will get):",
    `- background: ${input.backpack.background}`,
    `- domain familiarity: ${input.backpack.domainFamiliarity}`,
    ...(input.backpack.notes ? [`- notes: ${input.backpack.notes}`] : []),
  ].join("\n");
  return runAgent({
    agent: "reversal-compiler",
    system,
    prompt,
    schema: ReversalOutput,
    temperature: 0.4,
  });
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
