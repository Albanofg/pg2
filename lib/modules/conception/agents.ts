import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { withBackpack, type BackpackSection } from "@/lib/modules/shared";
import type { AgentName, AgentRunner } from "./types";
import { resolveFamilyBlock } from "@/lib/families/helper-context";

/**
 * Module 1 — the five sub-agents.
 *
 * Module 1 OWNS each agent's system prompt (in prompts/<agent>.md) and its
 * input/output contract (the Zod schemas below). It does NOT own the model
 * call: every run goes through the injected `AgentRunner` seam, which the
 * Helper implements. See README.md.
 *
 * server-only: these read prompt files from disk and are invoked where the
 * Helper calls sub-agents (server side).
 */

/* ------------------------------------------------------------------ *
 * Prompt loading — each agent's system message is its prompts/*.md file
 * ------------------------------------------------------------------ */

/**
 * Prompts are organized per module, prefixed by order of usage:
 *   prompts/module-1-conception/0N-<agent>.md
 * Module 1's usage order: decompose → examine → clarify → boundary-gate →
 * formalize.
 */
const MODULE_1_DIR = "module-1-conception";

const PROMPT_FILES: Record<AgentName, string> = {
  helper: `${MODULE_1_DIR}/00-helper.md`,
  distiller: `${MODULE_1_DIR}/01-distiller.md`,
  decomposer: `${MODULE_1_DIR}/02-decomposer.md`,
  examiner: `${MODULE_1_DIR}/03-examiner.md`,
  clarifier: `${MODULE_1_DIR}/04-clarifier.md`,
  "boundary-classifier": `${MODULE_1_DIR}/05-boundary-classifier.md`,
  formalizer: `${MODULE_1_DIR}/06-formalizer.md`,
  "code-generator": `${MODULE_1_DIR}/07-code-generator.md`,
  reviser: `${MODULE_1_DIR}/08-reviser.md`,
  verifier: `${MODULE_1_DIR}/09-verifier.md`,
  brainstorm: `${MODULE_1_DIR}/10-brainstorm.md`,
  advocate: `${MODULE_1_DIR}/11-advocate.md`,
};

const promptCache = new Map<AgentName, string>();

/**
 * Extra Backpack sections an agent pulls beyond CORE. The user-facing `helper`
 * reads the shared HELPER_DOCTRINE (the V1 QA-Assistant teaching protocol, now a
 * shared layer); the silent sub-agents stay lean on CORE only.
 */
const AGENT_SECTIONS: Partial<Record<AgentName, BackpackSection[]>> = {
  helper: ["helper_doctrine"],
  // The brainstormer teaches patentability and brainstorms WITH the inventor —
  // it reads the same doctrine so it stays in the teach-don't-invent lane.
  brainstorm: ["helper_doctrine"],
};

/**
 * Load an agent's system prompt: the shared Backpack (patent-writing knowledge +
 * inventorship law, plus any per-agent sections) prepended to the agent's own
 * prompts/<module>/<file>.md, so every agent reads BOTH shared layers. The file
 * is cached; the Backpack is prepended on each return.
 */
export async function loadAgentPrompt(agent: AgentName): Promise<string> {
  let contents = promptCache.get(agent);
  if (!contents) {
    const file = path.join(process.cwd(), "prompts", ...PROMPT_FILES[agent].split("/"));
    contents = (await readFile(file, "utf8")).trim();
    promptCache.set(agent, contents);
  }
  return withBackpack(contents, AGENT_SECTIONS[agent] ?? []);
}

/* ------------------------------------------------------------------ *
 * Output schemas (the contract the AgentRunner validates against)
 * ------------------------------------------------------------------ */

export const HelperOutput = z.object({
  /** What the Helper understood the inventor's message to be. */
  intent: z.enum(["question", "edit", "new_idea", "answer", "other"]),
  /** The plain-language message shown to the inventor — SHORT (1–3 sentences); teaches/brainstorms, never invents. */
  reply: z.string(),
  /** At most ONE short question with tap-to-answer options. Leave `ask` empty when nothing is needed. */
  question: z
    .object({
      ask: z.string().default(""),
      why: z.string().default(""),
      options: z.array(z.string()).default([]),
    })
    .default({ ask: "", why: "", options: [] }),
});
export type HelperResult = z.infer<typeof HelperOutput>;

export const ReviserOutput = z.object({
  /** The full revised core statement, per the inventor's instruction. */
  core_statement: z.string(),
});
export type ReviserResult = z.infer<typeof ReviserOutput>;

export const VerifierOutput = z.object({
  verdict: z.enum(["pass", "fail"]),
  /** One sentence; on fail, names what is unsupported or inconsistent. */
  note: z.string().default(""),
});
export type VerifierResult = z.infer<typeof VerifierOutput>;

export const DistillerOutput = z.object({
  /** The essential core conception, plain and tight — never the input verbatim. */
  core_statement: z.string(),
  /** Points that look genuinely strong/distinctive. */
  strong: z.array(z.string()).default([]),
  /** Points that look vague, thin, or already-common. */
  thin: z.array(z.string()).default([]),
  /** The single sharpest gap, if any (at most one — never a wall). */
  gap_kind: z.enum(["none", "factual", "inventive"]).default("none"),
  gap_missing: z.string().default(""),
  /** Brief labels for over-built/late-stage detail deferred to later stages. */
  set_aside: z.array(z.string()).default([]),
});
export type DistillerResult = z.infer<typeof DistillerOutput>;

export const ClarifierOutput = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      unclear_about: z.string(),
      why_it_matters: z.string(),
    }),
  ),
});
export type ClarifierResult = z.infer<typeof ClarifierOutput>;

/** A candidate Concept restated purely from the inventor's words (shared by the three concept passes). */
const ConceptCandidate = z.object({
  title: z.string(),
  restatement: z.string(),
  source_excerpts: z.array(z.string()).default([]),
});

export const DecomposerOutput = z.object({
  concepts: z.array(ConceptCandidate).default([]),
});
export type DecomposerResult = z.infer<typeof DecomposerOutput>;

/** Advocate — the generous breadth pass; surfaces distinct Concepts the Decomposer under-split. */
export const AdvocateOutput = z.object({
  concepts: z.array(ConceptCandidate).default([]),
});
export type AdvocateResult = z.infer<typeof AdvocateOutput>;

/**
 * Examiner — the skeptical consolidation pass. Now returns the FINAL, de-duplicated,
 * correctly-split Concept set (not diagnostic findings).
 */
export const ExaminerOutput = z.object({
  concepts: z.array(ConceptCandidate).default([]),
});
export type ExaminerResult = z.infer<typeof ExaminerOutput>;

export const BoundaryOutput = z.object({
  classification: z.enum(["factual_or_clarifying", "inventive"]),
  safe_to_surface: z.boolean(),
  /** Named only when classification is "inventive"; never describes a solution. */
  inventive_element: z.string().default(""),
  reason: z.string(),
});
export type BoundaryResult = z.infer<typeof BoundaryOutput>;

export const FormalizerOutput = z.object({
  formalized_statement: z.string(),
  added_substance: z
    .array(z.object({ text: z.string(), why_needed: z.string() }))
    .default([]),
  derived_from_excerpts: z.array(z.string()).default([]),
});
export type FormalizerResult = z.infer<typeof FormalizerOutput>;

export const CodeGeneratorOutput = z.object({
  language: z.string().default("text"),
  code: z.string().default(""),
  inventive_gaps: z
    .array(
      z.object({
        missing_element: z.string(),
        why_routine_insufficient: z.string(),
      }),
    )
    .default([]),
});
export type CodeGeneratorResult = z.infer<typeof CodeGeneratorOutput>;

export const BrainstormOutput = z.object({
  /** One short sentence introducing the directions, in the Helper's voice. */
  intro: z.string().default(""),
  directions: z
    .array(
      z.object({
        direction: z.string(),
        why_it_might_be_patentable: z.string(),
        invite_to_develop: z.string(),
      }),
    )
    .default([]),
});
export type BrainstormResult = z.infer<typeof BrainstormOutput>;

/* ------------------------------------------------------------------ *
 * Run functions — build the user prompt, call through the seam, return typed
 * ------------------------------------------------------------------ */

export async function runHelper(
  runAgent: AgentRunner,
  input: {
    message: string;
    phase: string;
    core: string;
    strong: string[];
    thin: string[];
    setAside: string[];
    concepts: { title: string; statement: string }[];
    conversation: { role: string; text: string }[];
    inventorMaterial: string;
    consciousness?: string;
  },
): Promise<HelperResult> {
  const system = await loadAgentPrompt("helper");
  const familyBlock = await resolveFamilyBlock(input.message);
  const list = (items: string[]) =>
    items.length ? items.map((s) => `- ${s}`).join("\n") : "(none)";
  const prompt = [
    "THE INVENTOR JUST SAID (their message to you — read what they mean before acting):",
    input.message,
    "",
    `WHERE THEY ARE (phase): ${input.phase}`,
    "",
    "THE CURRENT READING OF THEIR IDEA (the core statement):",
    input.core || "(not distilled yet)",
    "",
    "WHAT LOOKS STRONG:",
    list(input.strong),
    "",
    "WHAT LOOKS THIN / NOT YET PINNED DOWN (the likely subject of a 'how do I fix this' question):",
    list(input.thin),
    "",
    "DEFERRED TO LATER MODULES (set aside, not lost):",
    list(input.setAside),
    "",
    "CONCEPTS SPLIT OUT SO FAR:",
    input.concepts.length
      ? input.concepts.map((c, i) => `[${i + 1}] ${c.title}: ${c.statement}`).join("\n")
      : "(none yet)",
    "",
    "RECENT CONVERSATION (oldest first):",
    input.conversation.length
      ? input.conversation.map((t) => `${t.role === "helper" ? "HELPER" : "INVENTOR"}: ${t.text}`).join("\n")
      : "(none yet)",
    "",
    "THE INVENTOR'S OWN MATERIAL SO FAR (the ONLY source of inventive substance — never add to it yourself):",
    input.inventorMaterial || "(none yet)",
    ...(input.consciousness
      ? ["", "WHAT'S ALREADY SETTLED FOR THIS PATENT (stay consistent):", input.consciousness]
      : []),
    ...(familyBlock ? ["", familyBlock] : []),
  ].join("\n");
  return runAgent({
    agent: "helper",
    system,
    prompt,
    schema: HelperOutput,
    temperature: 0.4,
  });
}

export async function runDistiller(
  runAgent: AgentRunner,
  input: { verbatim: string[] },
): Promise<DistillerResult> {
  const system = await loadAgentPrompt("distiller");
  const prompt = [
    "THE INVENTOR'S RAW WORDS (your only permitted source — cut to the core, add nothing):",
    ...input.verbatim.map((v, i) => `[${i + 1}] ${v}`),
  ].join("\n");
  return runAgent({
    agent: "distiller",
    system,
    prompt,
    schema: DistillerOutput,
    temperature: 0.2,
    subject: input.verbatim.join("\n"),
  });
}

export async function runReviser(
  runAgent: AgentRunner,
  input: { current: string; instruction: string; consciousness?: string },
): Promise<ReviserResult> {
  const system = await loadAgentPrompt("reviser");
  const prompt = [
    "THE CURRENT CORE STATEMENT:",
    input.current,
    "",
    "THE INVENTOR'S REQUESTED CHANGE (their own words — apply it; any substance in it is theirs):",
    input.instruction,
    ...(input.consciousness
      ? ["", "WHAT'S ALREADY IN THE SHARED CONSCIOUSNESS (stay consistent with it):", input.consciousness]
      : []),
  ].join("\n");
  return runAgent({
    agent: "reviser",
    system,
    prompt,
    schema: ReviserOutput,
    temperature: 0.2,
    subject: input.current,
  });
}

export async function runVerifier(
  runAgent: AgentRunner,
  input: { piece: string; inventorMaterial: string; consciousness?: string },
): Promise<VerifierResult> {
  const system = await loadAgentPrompt("verifier");
  const prompt = [
    "THE PIECE TO REVIEW (created by another agent):",
    input.piece,
    "",
    "THE INVENTOR'S OWN STATED MATERIAL (the only thing that counts as theirs):",
    input.inventorMaterial,
    ...(input.consciousness
      ? ["", "THE SHARED CONSCIOUSNESS (must stay consistent with what's settled):", input.consciousness]
      : []),
  ].join("\n");
  // Temperature 0: this is an independent check, not a creative task.
  return runAgent({
    agent: "verifier",
    system,
    prompt,
    schema: VerifierOutput,
    temperature: 0,
    subject: input.piece,
  });
}

export async function runDecomposer(
  runAgent: AgentRunner,
  input: { material: string; priorConcepts?: string[] },
): Promise<DecomposerResult> {
  const system = await loadAgentPrompt("decomposer");
  const prompt = [
    input.priorConcepts?.length
      ? `CONCEPTS ALREADY IDENTIFIED (do not duplicate; only add genuinely distinct ideas):\n${input.priorConcepts
          .map((c, i) => `(${i + 1}) ${c}`)
          .join("\n")}`
      : "",
    "INVENTOR'S MATERIAL (your only permitted source — restate, never add):",
    input.material,
  ]
    .filter(Boolean)
    .join("\n\n");
  return runAgent({
    agent: "decomposer",
    system,
    prompt,
    schema: DecomposerOutput,
    temperature: 0.2,
    subject: input.material,
  });
}

/** Render a candidate Concept list as readable text for the advocate/examiner prompts. */
function renderConcepts(concepts: { title: string; restatement: string }[]): string {
  return concepts.length
    ? concepts.map((c, i) => `(${i + 1}) ${c.title}: ${c.restatement}`).join("\n")
    : "(none)";
}

/** The generous breadth pass — surfaces distinct Concepts the Decomposer under-split. */
export async function runAdvocate(
  runAgent: AgentRunner,
  input: { material: string; candidates: { title: string; restatement: string }[] },
): Promise<AdvocateResult> {
  const system = await loadAgentPrompt("advocate");
  const prompt = [
    "CANDIDATE CONCEPTS ALREADY SURFACED (do NOT duplicate these; add only genuinely distinct ones):",
    renderConcepts(input.candidates),
    "",
    "INVENTOR'S MATERIAL (your only permitted source — restate, never add):",
    input.material,
  ].join("\n");
  return runAgent({
    agent: "advocate",
    system,
    prompt,
    schema: AdvocateOutput,
    temperature: 0.3,
    subject: input.material,
  });
}

/** The skeptical consolidation pass — returns the FINAL, de-duplicated, correctly-split Concept set. */
export async function runExaminer(
  runAgent: AgentRunner,
  input: { material: string; candidates: { title: string; restatement: string }[] },
): Promise<ExaminerResult> {
  const system = await loadAgentPrompt("examiner");
  const prompt = [
    "CANDIDATE CONCEPTS (from the Decomposer and the Advocate — merge duplicates, split bundles, complete what's missing):",
    renderConcepts(input.candidates),
    "",
    "INVENTOR'S MATERIAL (the ground truth and ONLY source of substance — restate, never add):",
    input.material,
  ].join("\n");
  return runAgent({
    agent: "examiner",
    system,
    prompt,
    schema: ExaminerOutput,
    temperature: 0.1,
    subject: input.material,
  });
}

export async function runClarifier(
  runAgent: AgentRunner,
  input: { material: string },
): Promise<ClarifierResult> {
  const system = await loadAgentPrompt("clarifier");
  const prompt = [
    "INVENTOR'S MATERIAL (ask only where genuinely unclear; never propose answers):",
    input.material,
  ].join("\n\n");
  return runAgent({
    agent: "clarifier",
    system,
    prompt,
    schema: ClarifierOutput,
    temperature: 0.3,
    subject: input.material,
  });
}

export async function runBoundaryClassifier(
  runAgent: AgentRunner,
  input: { content: string; inventorMaterial: string },
): Promise<BoundaryResult> {
  const system = await loadAgentPrompt("boundary-classifier");
  const prompt = [
    "INVENTOR'S OWN STATED MATERIAL (the only thing that counts as theirs):",
    input.inventorMaterial,
    "",
    "CONTENT TO CLASSIFY (decide if it is safe to surface, or inventive and must be withheld):",
    input.content,
  ].join("\n");
  // Low temperature: this is a safety gate, not a creative task.
  return runAgent({
    agent: "boundary-classifier",
    system,
    prompt,
    schema: BoundaryOutput,
    temperature: 0,
    subject: input.content,
  });
}

export async function runFormalizer(
  runAgent: AgentRunner,
  input: { verbatim: string[] },
): Promise<FormalizerResult> {
  const system = await loadAgentPrompt("formalizer");
  const prompt = [
    "INVENTOR'S EXACT WORDS FOR THIS CONCEPT (your only permitted source):",
    ...input.verbatim.map((v, i) => `[${i + 1}] ${v}`),
  ].join("\n");
  return runAgent({
    agent: "formalizer",
    system,
    prompt,
    schema: FormalizerOutput,
    temperature: 0.1,
    subject: input.verbatim.join("\n"),
  });
}

export async function runBrainstorm(
  runAgent: AgentRunner,
  input: {
    core: string;
    concepts: { title: string; statement: string }[];
    inventorMaterial: string;
    consciousness?: string;
  },
): Promise<BrainstormResult> {
  const system = await loadAgentPrompt("brainstorm");
  const prompt = [
    "THE INVENTOR'S IDEA, AS AGREED (the core reading — your only source of substance):",
    input.core || "(not distilled yet)",
    "",
    "THE DISTINCT CONCEPTS SPLIT OUT SO FAR (directions should not just repeat these):",
    input.concepts.length
      ? input.concepts.map((c, i) => `[${i + 1}] ${c.title}: ${c.statement}`).join("\n")
      : "(none yet)",
    "",
    "THE INVENTOR'S OWN MATERIAL (the ONLY source of inventive substance — never add to it yourself):",
    input.inventorMaterial || "(none yet)",
    ...(input.consciousness
      ? ["", "WHAT'S ALREADY SETTLED FOR THIS PATENT (stay consistent):", input.consciousness]
      : []),
  ].join("\n");
  return runAgent({
    agent: "brainstorm",
    system,
    prompt,
    schema: BrainstormOutput,
    temperature: 0.5,
    subject: input.core,
  });
}

export async function runCodeGenerator(
  runAgent: AgentRunner,
  input: { statement: string; verbatim: string[] },
): Promise<CodeGeneratorResult> {
  const system = await loadAgentPrompt("code-generator");
  const prompt = [
    "THE INVENTOR'S APPROVED FORMALIZED STATEMENT (what to illustrate):",
    input.statement,
    "",
    "THE INVENTOR'S EXACT WORDS (your only permitted source of substance):",
    ...input.verbatim.map((v, i) => `[${i + 1}] ${v}`),
  ].join("\n");
  return runAgent({
    agent: "code-generator",
    system,
    prompt,
    schema: CodeGeneratorOutput,
    temperature: 0.2,
    subject: input.statement,
  });
}
