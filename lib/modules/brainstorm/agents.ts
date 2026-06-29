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
  MarketRead,
  ReversalStep,
  Stub,
  WalkTurn,
} from "./types";
import type { MarketEvidence } from "./market";

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
  "market-analyst": `${DIR}/04-market-analyst.md`,
  excavator: `${DIR}/05-excavator.md`,
  "section-101": `${DIR}/06-section-101.md`,
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

export const ExcavatorOutput = z.object({
  clarifier: z
    .object({
      prompt: z.string().default(""),
      chips: z.array(z.string()).default([]),
    })
    .default({ prompt: "", chips: [] }),
  cards: z
    .array(
      z.object({
        lens: z.enum(["need", "mechanism", "market"]),
        label: z.string().default(""),
        restatement: z.string().default(""),
        mechanism: z.string().default(""),
      }),
    )
    .default([]),
});
export type ExcavatorResult = z.infer<typeof ExcavatorOutput>;

export const Section101Output = z.object({
  eligible: z.boolean().default(true),
  reason: z.string().default(""),
  restatement: z.string().default(""),
  mechanism: z.string().default(""),
});
export type Section101Result = z.infer<typeof Section101Output>;

export const MarketReadOutput = z.object({
  incumbents: z
    .array(
      z.object({
        name: z.string().default(""),
        what: z.string().default(""),
      }),
    )
    .default([]),
  whitespace: z.string().default(""),
});

export const ReversalStepOutput = z.object({
  angle: z.string().default(""),
  reaction: z.string().default(""),
  done: z.boolean().default(false),
  question: z
    .object({
      prompt: z.string().default(""),
      why: z.string().default(""),
      alternatives: z.array(z.string()).default([]),
    })
    .default({ prompt: "", why: "", alternatives: [] }),
  arrival_prompt: z.string().default(""),
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

/**
 * Emit ONE adaptive step of the walk for THIS user, given the conversation so far.
 * Reacts to their last answer and steers toward the (backstage) mechanism — no
 * pre-baked list, no fixed count. Empty conversation = the opening move.
 */
/** Normalize a question for repeat-detection: lowercase, alphanumerics + spaces only. */
function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True if `candidate` repeats (or barely rewords) a question already asked. */
function repeatsPriorQuestion(candidate: string, prior: string[]): boolean {
  const c = normalizeQuestion(candidate);
  if (!c) return false;
  const cTokens = new Set(c.split(" "));
  for (const p of prior) {
    const pn = normalizeQuestion(p);
    if (!pn) continue;
    if (pn === c) return true; // byte-identical (the observed bug)
    const pTokens = new Set(pn.split(" "));
    const inter = [...cTokens].filter((t) => pTokens.has(t)).length;
    const union = new Set([...cTokens, ...pTokens]).size;
    if (union > 0 && inter / union >= 0.85) return true; // barely reworded
  }
  return false;
}

export async function runReversalStep(
  runAgent: AgentRunner,
  input: {
    trace: DerivationTrace;
    backpack: Backpack;
    conversation: WalkTurn[];
    /** The inventor pressed "keep pushing" — they don't feel done; never declare arrival. */
    pushDeeper?: boolean;
  },
): Promise<ReversalStep> {
  const system = await loadPrompt("reversal-compiler");
  const t = input.trace;
  const prompt = [
    `PROBLEM: ${t.problem}`,
    `MECHANISM (the destination — NEVER reveal or name it): ${t.mechanism}`,
    ...(t.operatesOn ? [`OPERATES_ON: ${t.operatesOn}`] : []),
    "",
    "DERIVATION TRACE (your private map of where to steer):",
    ...t.steps.map(
      (s) =>
        `- [${s.id}] ${s.question}\n    options: ${s.options.join(" | ")}\n    chosen: ${s.chosen}\n    why: ${s.why}`,
    ),
    "",
    "BACKPACK (who this user is — pick analogies + level):",
    `- background: ${input.backpack.background}`,
    `- domain familiarity: ${input.backpack.domainFamiliarity}`,
    ...(input.backpack.notes ? [`- notes: ${input.backpack.notes}`] : []),
    "",
    "CONVERSATION SO FAR (oldest first):",
    input.conversation.length
      ? input.conversation
          .map((c, i) => `Q${i + 1}: ${c.question}\nA${i + 1}: ${c.answer}`)
          .join("\n")
      : "(none yet — this is the opening move; no reaction)",
    ...(input.pushDeeper
      ? [
          "",
          "THE INVENTOR PRESSED 'KEEP PUSHING' — they have SEEN every question above and want MORE. Do NOT set done=true. Do NOT re-ask or re-phrase ANY question already above (same fork, same sparks = failure). React briefly, then raise ONE genuinely NEW, harder edge they have not yet faced — a DIFFERENT failure mode: e.g. an input the mechanism can't handle, a case where its guess is wrong and the user must correct it (does it learn?), two things matching at once, zero usable clues, or staleness/drift over time. Describe the situation, never name the answer.",
        ]
      : []),
  ].join("\n");
  let out = await runAgent({
    agent: "reversal-compiler",
    system,
    prompt,
    schema: ReversalStepOutput,
    temperature: 0.5,
  });

  // Hard guard against the "Q8 served again as Q9" repeat: if the model echoes a
  // question already asked, re-run ONCE with an explicit no-repeat instruction at a
  // higher temperature. Belt-and-suspenders over the prompt's no-repeat rule —
  // a repeat must never reach the screen. (Only the question repeats; arrival is fine.)
  const priorQuestions = input.conversation.map((c) => c.question);
  if (
    !out.done &&
    out.question.prompt &&
    repeatsPriorQuestion(out.question.prompt, priorQuestions)
  ) {
    const retryPrompt = `${prompt}

YOUR PREVIOUS ATTEMPT REPEATED A QUESTION ALREADY ASKED:
"${out.question.prompt}"
That fork is already resolved — re-serving it (even reworded, even with the same sparks) is a failed step. React briefly to their last answer, then ask a GENUINELY DIFFERENT question covering a NEW fork or a NEW edge they have not faced: a different failure mode (ambiguous or missing input, a guess the mechanism gets wrong and the user must correct, two things matching at once, staleness/drift over time, scale). Describe the situation; never name the answer.`;
    out = await runAgent({
      agent: "reversal-compiler",
      system,
      prompt: retryPrompt,
      schema: ReversalStepOutput,
      temperature: 0.8,
    });
  }

  return {
    reaction: out.reaction,
    done: out.done,
    ...(out.angle ? { angle: out.angle } : {}),
    ...(out.question.prompt
      ? {
          question: {
            prompt: out.question.prompt,
            ...(out.question.why ? { why: out.question.why } : {}),
            alternatives: out.question.alternatives,
          },
        }
      : {}),
    ...(out.arrival_prompt ? { arrivalPrompt: out.arrival_prompt } : {}),
  };
}

/** The Step-1 excavation: a raw spark → 3 lens cards + one optional clarifier chip-row. */
export async function runExcavator(
  runAgent: AgentRunner,
  input: { spark: string; clarifierAnswer?: string },
): Promise<ExcavatorResult> {
  const system = await loadPrompt("excavator");
  const prompt = [
    "SPARK (exactly what the inventor typed):",
    input.spark,
    "",
    `CLARIFIER_ANSWER: ${input.clarifierAnswer?.trim() || "(none)"}`,
  ].join("\n");
  return runAgent({
    agent: "excavator",
    system,
    prompt,
    schema: ExcavatorOutput,
    temperature: 0.6,
  });
}

/**
 * The §101 gate + constraint-injector on the mechanism card: if it's already a
 * concrete how+constraint, echo it; if it's still an abstract idea, rescue it by
 * injecting the constraint that makes it a technical improvement.
 */
export async function runSection101(
  runAgent: AgentRunner,
  input: { problem: string; restatement: string; mechanism: string },
): Promise<Section101Result> {
  const system = await loadPrompt("section-101");
  const prompt = [
    `PROBLEM / SPACE: ${input.problem}`,
    `RESTATEMENT: ${input.restatement}`,
    `MECHANISM: ${input.mechanism}`,
  ].join("\n");
  return runAgent({
    agent: "section-101",
    system,
    prompt,
    schema: Section101Output,
    temperature: 0.3,
  });
}

/** The honest competitive read for ONE direction, grounded in search evidence when present. */
export async function runMarketAnalyst(
  runAgent: AgentRunner,
  input: { problem: string; direction: string; evidence: MarketEvidence },
): Promise<MarketRead> {
  const system = await loadPrompt("market-analyst");
  const prompt = [
    `PROBLEM / SPACE: ${input.problem}`,
    `DIRECTION being assessed: ${input.direction}`,
    "",
    "EVIDENCE (real search results — ground incumbents in these):",
    input.evidence.length
      ? input.evidence
          .map((e, i) => `[${i + 1}] ${e.title} — ${e.url}\n    ${e.snippet}`)
          .join("\n")
      : "(none — no live search; use only players you are genuinely confident exist)",
  ].join("\n");
  const out = await runAgent({
    agent: "market-analyst",
    system,
    prompt,
    schema: MarketReadOutput,
    temperature: 0.2,
  });
  return {
    incumbents: out.incumbents.filter((c) => c.name.trim()),
    whitespace: out.whitespace,
    confidence: input.evidence.length ? "searched" : "model",
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
