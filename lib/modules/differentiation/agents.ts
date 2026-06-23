import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { withBackpack, type BackpackSection } from "@/lib/modules/shared";
import type { AgentName, AgentRunner, ConceptLandscape } from "./types";

/**
 * Module 4 (Differentiation) — the Slice-A sub-agents. Module 4 owns each agent's
 * prompt + I/O contract; the Helper owns the model call via the injected
 * AgentRunner. Each prompt is the shared Backpack (CORE + the agent's relevant
 * knowledge sections) prepended to the agent's own prompt file.
 */

const MODULE_4_DIR = "module-4-differentiation";

const PROMPT_FILES: Record<AgentName, string> = {
  "gap-framer": `${MODULE_4_DIR}/01-gap-framer.md`,
  "differentiation-formalizer": `${MODULE_4_DIR}/02-differentiation-formalizer.md`,
  verifier: `${MODULE_4_DIR}/03-verifier.md`,
  "disclosure-compiler": `${MODULE_4_DIR}/04-disclosure.md`,
  "pohc-scorer": `${MODULE_4_DIR}/05-pohc.md`,
};

/** Which Backpack knowledge sections each agent pulls in (on top of CORE). */
const AGENT_SECTIONS: Record<AgentName, BackpackSection[]> = {
  "gap-framer": ["examiner_grounds"],
  "differentiation-formalizer": [],
  verifier: [],
  "disclosure-compiler": ["disclosure_sections", "enablement_101", "abstract_rules"],
  "pohc-scorer": ["inventorship_factors"],
};

const promptCache = new Map<AgentName, string>();

/** Load an agent's system prompt: Backpack (CORE + sections) + the agent's file. */
export async function loadAgentPrompt(agent: AgentName): Promise<string> {
  let contents = promptCache.get(agent);
  if (!contents) {
    const file = path.join(process.cwd(), "prompts", ...PROMPT_FILES[agent].split("/"));
    contents = (await readFile(file, "utf8")).trim();
    promptCache.set(agent, contents);
  }
  return withBackpack(contents, AGENT_SECTIONS[agent]);
}

/* ------------------------------------------------------------------ *
 * Output schemas
 * ------------------------------------------------------------------ */

export const GapFramerOutput = z.object({
  art_summary: z.string(),
  mechanism: z.string(),
  open_points: z.array(z.string()).default([]),
});
export type GapFramerResult = z.infer<typeof GapFramerOutput>;

export const DifferentiationFormalizerOutput = z.object({
  differentiation_statement: z.string(),
  added_substance: z
    .array(z.object({ text: z.string(), why_needed: z.string() }))
    .default([]),
});
export type DifferentiationFormalizerResult = z.infer<
  typeof DifferentiationFormalizerOutput
>;

export const VerifierOutput = z.object({
  verdict: z.enum(["pass", "fail"]),
  note: z.string().default(""),
});
export type VerifierResult = z.infer<typeof VerifierOutput>;

const PohcFactorOut = z.object({
  score: z.number().min(0).max(1),
  record: z.string().default(""),
  weak: z.boolean().default(false),
});
export const PohcOutput = z.object({
  conception: PohcFactorOut,
  quality: PohcFactorOut,
  known_concepts: PohcFactorOut,
});
export type PohcResult = z.infer<typeof PohcOutput>;

export const DisclosureOutput = z.object({
  title: z.string().default(""),
  background: z.string().default(""),
  summary: z.string().default(""),
  abstract: z.string().default(""),
  architecture: z.string().default(""),
  data_structures: z.string().default(""),
  operations: z.string().default(""),
  alternatives: z.string().default(""),
  ramifications: z.string().default(""),
});
export type DisclosureResult = z.infer<typeof DisclosureOutput>;

/* ------------------------------------------------------------------ *
 * Run functions
 * ------------------------------------------------------------------ */

function renderArt(landscape: ConceptLandscape): string {
  if (!landscape.sources.length) return "(no close prior art found)";
  return landscape.sources
    .slice(0, 8)
    .map((s, i) => {
      const close = s.closeness != null ? ` (closeness ${s.closeness.toFixed(2)})` : "";
      return `[${i + 1}] ${s.title}${close}${s.snippet ? `\n    ${s.snippet}` : ""}`;
    })
    .join("\n");
}

export async function runGapFramer(
  runAgent: AgentRunner,
  input: { statement: string; verbatim: string[]; landscape: ConceptLandscape; consciousness?: string },
): Promise<GapFramerResult> {
  const system = await loadAgentPrompt("gap-framer");
  const prompt = [
    "THE CONCEPT'S CURRENT STATEMENT:",
    input.statement,
    "",
    "THE INVENTOR'S OWN WORDS FOR IT (the only source of its mechanism):",
    ...input.verbatim.map((v, i) => `[${i + 1}] ${v}`),
    "",
    `THE CLOSEST PRIOR ART (territory: ${input.landscape.territory}):`,
    renderArt(input.landscape),
    ...(input.consciousness
      ? ["", "WHAT'S ALREADY SETTLED FOR THIS PATENT (Shared Consciousness):", input.consciousness]
      : []),
  ].join("\n");
  return runAgent({ agent: "gap-framer", system, prompt, schema: GapFramerOutput, temperature: 0.2 });
}

export async function runDifferentiationFormalizer(
  runAgent: AgentRunner,
  input: { novelty: string; statement: string; artSummary: string; consciousness?: string },
): Promise<DifferentiationFormalizerResult> {
  const system = await loadAgentPrompt("differentiation-formalizer");
  const prompt = [
    "THE INVENTOR'S VERBATIM NOVELTY STATEMENT (your only source of substance):",
    input.novelty,
    "",
    "THE CONCEPT (context):",
    input.statement,
    "",
    "WHAT THE PRIOR ART COVERS (context — do not restate as the invention):",
    input.artSummary,
    ...(input.consciousness
      ? ["", "WHAT'S ALREADY SETTLED FOR THIS PATENT (stay consistent):", input.consciousness]
      : []),
  ].join("\n");
  return runAgent({
    agent: "differentiation-formalizer",
    system,
    prompt,
    schema: DifferentiationFormalizerOutput,
    temperature: 0.1,
  });
}

export async function runDisclosureCompiler(
  runAgent: AgentRunner,
  input: {
    keyConcepts: { title: string; statement: string; differentiation: string }[];
    verbatim: string[];
    artSummary: string;
    consciousness?: string;
  },
): Promise<DisclosureResult> {
  const system = await loadAgentPrompt("disclosure-compiler");
  const prompt = [
    "THE OWNED KEY CONCEPTS (anchors of the disclosure):",
    ...input.keyConcepts.map(
      (k, i) =>
        `(${i + 1}) ${k.title}\n    Statement: ${k.statement}\n    Differentiation: ${k.differentiation}`,
    ),
    "",
    "THE INVENTOR'S OWN WORDS (the only source of technical substance):",
    ...input.verbatim.map((v, i) => `[${i + 1}] ${v}`),
    "",
    "WHAT THE PRIOR ART COVERS (for the Background only — do not present as the invention):",
    input.artSummary || "(no prior-art summary available)",
    ...(input.consciousness
      ? ["", "EVERYTHING SETTLED FOR THIS PATENT (Shared Consciousness — stay consistent):", input.consciousness]
      : []),
  ].join("\n");
  return runAgent({
    agent: "disclosure-compiler",
    system,
    prompt,
    schema: DisclosureOutput,
    temperature: 0.2,
  });
}

export async function runPohcScorer(
  runAgent: AgentRunner,
  input: { title: string; statement: string; differentiation: string; verbatim: string[] },
): Promise<PohcResult> {
  const system = await loadAgentPrompt("pohc-scorer");
  const prompt = [
    `THE KEY CONCEPT: ${input.title}`,
    `Statement: ${input.statement}`,
    `Differentiation against the art: ${input.differentiation}`,
    "",
    "THE INVENTOR'S OWN RECORDED WORDS (the only evidence — quote from these):",
    ...input.verbatim.map((v, i) => `[${i + 1}] ${v}`),
  ].join("\n");
  return runAgent({ agent: "pohc-scorer", system, prompt, schema: PohcOutput, temperature: 0 });
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
  return runAgent({ agent: "verifier", system, prompt, schema: VerifierOutput, temperature: 0 });
}
