import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { withBackpack, type BackpackSection } from "@/lib/modules/shared";
import type { AgentName, AgentRunner, Genus, Species, SpeciesType } from "./types";

/**
 * Module 5 (Showcase · Broadening) sub-agents. Each prompt is the shared Backpack
 * (CORE + the agent's knowledge sections) prepended to the agent's own file. The
 * broadening agents pull the `broadening` doctrine; the verifier is the Boundary's
 * faithfulness guard at the gates.
 */

const MODULE_5_DIR = "module-5-showcase";

const PROMPT_FILES: Record<AgentName, string> = {
  "genus-extractor": `${MODULE_5_DIR}/01-genus-extractor.md`,
  "species-synthesizer": `${MODULE_5_DIR}/02-species-synthesizer.md`,
  "key-concept-broadener": `${MODULE_5_DIR}/03-key-concept-broadener.md`,
  verifier: `${MODULE_5_DIR}/04-verifier.md`,
};

const AGENT_SECTIONS: Record<AgentName, BackpackSection[]> = {
  "genus-extractor": ["broadening"],
  "species-synthesizer": ["broadening"],
  "key-concept-broadener": ["broadening"],
  verifier: [],
};

const promptCache = new Map<AgentName, string>();

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
 * Schemas
 * ------------------------------------------------------------------ */

export const GenusOutput = z.object({
  genus_name: z.string(),
  genus_description: z.string(),
  input_pattern: z.string().default(""),
  transformation_pattern: z.string().default(""),
  output_pattern: z.string().default(""),
});
export type GenusResult = z.infer<typeof GenusOutput>;

export const SpeciesOutput = z.object({
  species_type: z.enum(["ai_assisted", "ai_native", "agentic"]),
  species_name: z.string(),
  architectural_description: z.string().default(""),
  data_flow: z.string().default(""),
  key_components: z.array(z.string()).default([]),
  technical_improvements: z.array(z.string()).default([]),
  differentiation_from_traditional: z.string().default(""),
});
export type SpeciesResult = z.infer<typeof SpeciesOutput>;

export const BroadenedOutput = z.object({
  broadened_concept_text: z.string(),
  language_changes: z.array(z.string()).default([]),
  meaning_preservation_check: z.string().default(""),
});
export type BroadenedResult = z.infer<typeof BroadenedOutput>;

export const VerifierOutput = z.object({
  verdict: z.enum(["pass", "fail"]),
  note: z.string().default(""),
});
export type VerifierResult = z.infer<typeof VerifierOutput>;

/* ------------------------------------------------------------------ *
 * Run functions
 * ------------------------------------------------------------------ */

function renderGenus(g: Genus): string {
  return [
    `genus_name: ${g.genus_name}`,
    `genus_description: ${g.genus_description}`,
    `input_pattern: ${g.input_pattern}`,
    `transformation_pattern: ${g.transformation_pattern}`,
    `output_pattern: ${g.output_pattern}`,
  ].join("\n");
}

export async function runGenusExtractor(
  runAgent: AgentRunner,
  input: { keyConcepts: { title: string; statement: string }[]; verbatim: string[] },
): Promise<GenusResult> {
  const system = await loadAgentPrompt("genus-extractor");
  const prompt = [
    "THE OWNED KEY CONCEPTS:",
    ...input.keyConcepts.map((k, i) => `(${i + 1}) ${k.title}: ${k.statement}`),
    "",
    "THE INVENTOR'S OWN WORDS (only source of substance):",
    ...input.verbatim.map((v, i) => `[${i + 1}] ${v}`),
  ].join("\n");
  return runAgent({ agent: "genus-extractor", system, prompt, schema: GenusOutput, temperature: 0.2 });
}

export async function runSpeciesSynthesizer(
  runAgent: AgentRunner,
  input: { genus: Genus; speciesType: SpeciesType },
): Promise<SpeciesResult> {
  const system = await loadAgentPrompt("species-synthesizer");
  const prompt = [
    "THE GENUS:",
    renderGenus(input.genus),
    "",
    `THE ASSIGNED SPECIES TYPE: ${input.speciesType}`,
  ].join("\n");
  return runAgent({ agent: "species-synthesizer", system, prompt, schema: SpeciesOutput, temperature: 0.3 });
}

export async function runKeyConceptBroadener(
  runAgent: AgentRunner,
  input: { original: string; genus: Genus; approvedSpecies: Species[]; consciousness?: string },
): Promise<BroadenedResult> {
  const system = await loadAgentPrompt("key-concept-broadener");
  const prompt = [
    "THE ORIGINAL KEY CONCEPT (preserve its meaning exactly):",
    input.original,
    "",
    "THE GENUS (paradigm-neutral vocabulary to draw on):",
    renderGenus(input.genus),
    "",
    "THE APPROVED SPECIES (compatibility tests only — their details must NOT appear):",
    ...input.approvedSpecies.map((s) => `- ${s.species_type}: ${s.species_name}`),
    ...(input.consciousness
      ? ["", "WHAT'S ALREADY SETTLED FOR THIS PATENT (stay consistent):", input.consciousness]
      : []),
  ].join("\n");
  return runAgent({
    agent: "key-concept-broadener",
    system,
    prompt,
    schema: BroadenedOutput,
    temperature: 0.2,
  });
}

export async function runVerifier(
  runAgent: AgentRunner,
  input: { piece: string; inventorMaterial: string; consciousness?: string },
): Promise<VerifierResult> {
  const system = await loadAgentPrompt("verifier");
  const prompt = [
    "THE BROADENING ARTIFACT TO REVIEW (created by another agent):",
    input.piece,
    "",
    "THE INVENTOR'S OWN MATERIAL (the only thing that counts as theirs):",
    input.inventorMaterial,
    ...(input.consciousness
      ? ["", "THE SHARED CONSCIOUSNESS (must stay consistent):", input.consciousness]
      : []),
  ].join("\n");
  return runAgent({ agent: "verifier", system, prompt, schema: VerifierOutput, temperature: 0 });
}
