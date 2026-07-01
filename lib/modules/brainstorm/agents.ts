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
  Tensor,
  WalkTurn,
} from "./types";
import { runConceptionEvaluator } from "./conception-evaluator";
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
  "tensor-finder": `${DIR}/07-tensor-finder.md`,
  "conception-evaluator": `${DIR}/08-conception-evaluator.md`,
  "input-classifier": `${DIR}/09-input-classifier.md`,
  deepener: `${DIR}/10-deepener.md`,
};

const promptCache = new Map<AgentName, string>();

export async function loadPrompt(agent: AgentName): Promise<string> {
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
  category_note: z.string().default(""),
  is_category_crowded: z.boolean().default(false),
  why_it_matters: z.string().default(""),
  whitespace: z.string().default(""),
  verdict: z.enum(["clean", "crowded", "durable"]).default("clean"),
  steer: z.string().default(""),
});

export const ReversalStepOutput = z.object({
  angle: z.string().default(""),
  reaction: z.string().default(""),
  done: z.boolean().default(false),
  question: z
    .object({
      prompt: z.string().default(""),
      why: z.string().default(""),
      // The game shape (§7): teaching moves are clicks (this_or_that / pick); only the
      // collision question is say_it (the inventor types the conditional core).
      kind: z.enum(["this_or_that", "pick", "say_it"]).default("say_it"),
      alternatives: z.array(z.string()).default([]),
    })
    .default({ prompt: "", why: "", kind: "say_it", alternatives: [] }),
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

/** The open invitation shown at arrival when the generator didn't supply its own. */
const ARRIVAL_DEFAULT =
  "That's it — say your invention in your own words, exactly as you see it.";

/** The calm message when the stall ladder is exhausted (no Tier 4). */
const ROUTE_TO_HUMAN_PROMPT =
  "This last step — the exact rule that settles it — is the part worth a human expert's eye. No rush: say what you've got in your own words, or come back to it.";

export async function runReversalStep(
  runAgent: AgentRunner,
  input: {
    trace: DerivationTrace;
    backpack: Backpack;
    conversation: WalkTurn[];
    /** The inventor pressed "keep pushing" — they don't feel done; never declare arrival. */
    pushDeeper?: boolean;
    /** The current stall tier, threaded so the no-Tier-4 floor advances across steps. */
    stallTier?: number;
    /**
     * The answer being judged came from a TEACHING click-game (this_or_that / pick), not
     * the typed collision question. Teaching clicks are not conception attempts, so the
     * conditionality gate + no-Tier-4 stall floor must NOT run on them — just advance to
     * the next move. Arrival is only ever judged on a typed (say_it) answer.
     */
    teaching?: boolean;
  },
): Promise<ReversalStep> {
  const system = await loadPrompt("reversal-compiler");
  const t = input.trace;
  const prompt = [
    `PROBLEM: ${t.problem}`,
    `MECHANISM (the destination — NEVER reveal or name it): ${t.mechanism}`,
    ...(t.operatesOn ? [`OPERATES_ON: ${t.operatesOn}`] : []),
    ...(t.tensor
      ? [
          "",
          "TENSOR (the grounded two poles + constraint to TEACH; the conditionalCore is BACKSTAGE — lead them to it, never say it):",
          `- POLE A: ${t.tensor.poleA}`,
          `- POLE B: ${t.tensor.poleB}`,
          `- CONSTRAINT (assumed away by rivals): ${t.tensor.constraint}`,
          `- COLLISION SCENE (stage this): ${t.tensor.collisionScene}`,
          `- conditionalCore (BACKSTAGE target, never shown): ${t.tensor.conditionalCore}`,
        ]
      : []),
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

  const mapStep = (
    o: z.infer<typeof ReversalStepOutput>,
    extra: Partial<ReversalStep> = {},
  ): ReversalStep => ({
    reaction: o.reaction,
    done: o.done,
    ...(o.angle ? { angle: o.angle } : {}),
    ...(o.question.prompt
      ? {
          question: {
            prompt: o.question.prompt,
            ...(o.question.why ? { why: o.question.why } : {}),
            kind: o.question.kind,
            alternatives: o.question.alternatives,
          },
        }
      : {}),
    ...(o.arrival_prompt ? { arrivalPrompt: o.arrival_prompt } : {}),
    ...extra,
  });

  const lastAnswer = input.conversation[input.conversation.length - 1]?.answer?.trim();
  const tensor = t.tensor;

  // Opening move, "keep pushing", a teaching click, or a trace without a tensor → the
  // generator's step stands (and push-deeper / teaching never declare arrival). The
  // strict gate governs arrival ONLY when there is a TYPED answer to judge AND a tensor
  // to judge it against. Teaching clicks (this_or_that / pick) are not conception
  // attempts, so they never run the gate or advance the no-Tier-4 stall floor.
  if (!lastAnswer || !tensor || input.pushDeeper || input.teaching) {
    return mapStep(out, input.pushDeeper || input.teaching ? { done: false } : {});
  }

  // THE CONDITIONALITY GATE governs arrival — not the generator's self-judgment (deep
  // spec §11: the strict evaluator runs in a SEPARATE call). It judges the inventor's
  // last answer against the tension, and the no-Tier-4 floor is enforced in code.
  const verdict = await runConceptionEvaluator(runAgent, {
    reply: lastAnswer,
    tension: {
      poleA: tensor.poleA,
      poleB: tensor.poleB,
      constraint: tensor.constraint,
      ...(tensor.collisionScene ? { collisionScene: tensor.collisionScene } : {}),
    },
    priorStallTier: input.stallTier ?? 0,
  });

  // No Tier 4 (§6.5): the ladder is exhausted → route to a human. Never state the answer.
  if (verdict.routeToHuman) {
    return {
      reaction: out.reaction,
      done: false,
      routeToHuman: true,
      arrivalPrompt: ROUTE_TO_HUMAN_PROMPT,
      stallTier: verdict.nextStallTier,
    };
  }

  // Arrival: the inventor's OWN words conditionally resolved the tension.
  if (verdict.isConditional) {
    return mapStep(out, {
      done: true,
      stallTier: 0,
      arrivalPrompt: out.arrival_prompt || ARRIVAL_DEFAULT,
    });
  }

  // Not yet. Keep teaching. If the generator (over-eagerly) declared arrival and gave no
  // next question, re-run it forced NOT to arrive — react, stage the collision, and ask
  // the collision question (or run the stall ladder). It never states the resolution.
  if (!out.question.prompt) {
    out = await runAgent({
      agent: "reversal-compiler",
      system,
      prompt: `${prompt}

THE INVENTOR HAS NOT YET NAMED A CONDITIONAL RESOLUTION. Do NOT declare arrival (do not set done). React briefly to their last answer, then stage the concrete collision and ask the collision question ("when the two can't both win, what has to happen?") — OR, if they have already faced this exact collision, run the stall ladder: offer 2–4 candidate sparks where EXACTLY ONE is the conditional resolution and invite them to pick it and say why in their own words. Never state the resolution.`,
      schema: ReversalStepOutput,
      temperature: 0.7,
    });
  }
  return mapStep(out, { done: false, stallTier: verdict.nextStallTier });
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

export const InputClassifierOutput = z.object({
  formed: z.boolean().default(false),
  reflected: z.string().default(""),
});

export const DeepenerOutput = z.object({
  // The evolving key concept — the CURRENT concept with the inventor's newest pick/typed text
  // folded in (accretes, never resets). Shown as "Where you've landed" + sealed on lock-in.
  updated_key_concept: z.string().default(""),
  // The updated concept is already a specific, buildable key concept — narrowing further would
  // only add implementation detail. Drives the UI to offer the "lock it in" landing so the
  // inventor converges in a few steps instead of drilling forever.
  specific_enough: z.boolean().default(false),
  cards: z
    .array(
      z.object({
        label: z.string().default(""),
        restatement: z.string().default(""),
      }),
    )
    .default([]),
});

/**
 * "Go deeper": narrow ONE chosen direction into three SHARPER, more specific sub-directions
 * — short, scannable, tap-to-pick. Distinct from the top excavator (which re-lenses into
 * need/mechanism/market, so re-running it just rephrases). No market read here — deeper
 * levels stay light so the inventor isn't reading a wall of text at every step.
 */
export async function runDeepener(
  runAgent: AgentRunner,
  input: {
    problem: string;
    /** The CURRENT KEY CONCEPT accumulated so far — the thing to EVOLVE (not replace). */
    direction: string;
    /** The sharper option the inventor just tapped (the new thing to fold in). */
    addition?: string;
    /** The sibling options the inventor is choosing among (context for a STEER). */
    options?: string[];
    /**
     * Optional free-text steer the inventor TYPED: combine/merge options, redirect
     * ("more like X"), or the exact marker "(you decide)". Folded into the key concept too.
     */
    steer?: string;
  },
): Promise<{
  updatedKeyConcept: string;
  cards: { label: string; restatement: string }[];
  specificEnough: boolean;
}> {
  const system = await loadPrompt("deepener");
  const prompt = [
    `ORIGINAL PROBLEM (context): ${input.problem}`,
    `CURRENT KEY CONCEPT (evolve this, keep its substance): ${input.direction}`,
    `THE ADDITION the inventor just chose (fold it in): ${input.addition?.trim() || "(none — this is the starting concept)"}`,
    input.options?.length
      ? `CURRENT OPTIONS the inventor is choosing among:\n${input.options
          .map((o, i) => `  ${i + 1}. ${o}`)
          .join("\n")}`
      : "CURRENT OPTIONS: (none)",
    `STEER: ${input.steer?.trim() || "(none)"}`,
  ].join("\n");
  let out = await runAgent({
    agent: "deepener",
    system,
    prompt,
    schema: DeepenerOutput,
    temperature: 0.7,
  });
  let cards = out.cards.filter((c) => c.restatement.trim());
  // Floor: never silently return nothing (a hedge / refusal / sub-3 reply would dead-end the
  // UI). Re-run ONCE, harder, demanding exactly three — mirrors the reversal-compiler retry.
  if (cards.length < 3) {
    out = await runAgent({
      agent: "deepener",
      system,
      prompt: `${prompt}

YOUR PREVIOUS REPLY DID NOT GIVE THREE USABLE OPTIONS. Output EXACTLY THREE distinct cards, each a SHORT one-line narrowing of the parent. Never refuse, never hedge, never explain instead of choosing — always produce three.`,
      schema: DeepenerOutput,
      temperature: 0.9,
    });
    const retry = out.cards.filter((c) => c.restatement.trim());
    if (retry.length > cards.length) cards = retry;
  }
  return {
    // Fall back to the prior concept if the model didn't evolve it — never blank the landing.
    updatedKeyConcept: out.updated_key_concept.trim() || input.direction,
    cards: cards.slice(0, 3),
    specificEnough: out.specific_enough,
  };
}

/**
 * The front-door router: is this input already a FORMED invention (a concrete
 * mechanism — e.g. a patent abstract), or a VAGUE problem to excavate? A formed input
 * skips the whole discovery walk (excavating a finished invention just wastes the
 * inventor's time). Cheap + fast — runs before anything else.
 */
export async function runInputClassifier(
  runAgent: AgentRunner,
  input: { spark: string },
): Promise<{ formed: boolean; reflected: string }> {
  const system = await loadPrompt("input-classifier");
  const out = await runAgent({
    agent: "input-classifier",
    system,
    prompt: `INPUT (exactly what the user typed):\n${input.spark}`,
    schema: InputClassifierOutput,
    temperature: 0.1,
  });
  return { formed: out.formed, reflected: out.reflected.trim() };
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
    ...(out.category_note.trim() ? { categoryNote: out.category_note } : {}),
    categoryCrowded: out.is_category_crowded,
    ...(out.why_it_matters.trim() ? { whyItMatters: out.why_it_matters } : {}),
    whitespace: out.whitespace,
    verdict: out.verdict,
    steer: out.steer,
    confidence: input.evidence.length ? "searched" : "model",
  };
}

export const TensorFinderOutput = z.object({
  poleA: z.string().default(""),
  poleB: z.string().default(""),
  constraint: z.string().default(""),
  collisionScene: z.string().default(""),
  conditionalCore: z.string().default(""),
});

/**
 * Reverse a chosen mechanism into its TENSOR — the two poles + the assumed-away
 * constraint + a collision scene + the backstage conditional core. This is the
 * private map the teach-the-tensor walk teaches from.
 */
export async function runTensorFinder(
  runAgent: AgentRunner,
  input: { problem: string; mechanism: string; restatement: string; market?: MarketRead },
): Promise<Tensor> {
  const system = await loadPrompt("tensor-finder");
  const m = input.market;
  const prompt = [
    `PROBLEM: ${input.problem}`,
    `MECHANISM (the chosen direction's claimable how): ${input.mechanism}`,
    `RESTATEMENT: ${input.restatement}`,
    "",
    "MARKET (what do these rivals quietly ASSUME? the assumed-away one is your constraint):",
    m
      ? [
          m.incumbents.length
            ? `- incumbents: ${m.incumbents.map((c) => `${c.name} (${c.what})`).join("; ")}`
            : "- incumbents: (none identified)",
          `- whitespace: ${m.whitespace}`,
          `- steer (what the claim must rest on): ${m.steer}`,
        ].join("\n")
      : "(no market read available — infer the most likely assumed-away constraint for this domain)",
  ].join("\n");
  const out = await runAgent({
    agent: "tensor-finder",
    system,
    prompt,
    schema: TensorFinderOutput,
    temperature: 0.3,
  });
  return {
    poleA: out.poleA,
    poleB: out.poleB,
    constraint: out.constraint,
    collisionScene: out.collisionScene,
    conditionalCore: out.conditionalCore,
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
