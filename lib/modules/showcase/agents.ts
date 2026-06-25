import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { withBackpack, type BackpackSection } from "@/lib/modules/shared";
import { buildHelperPrompt, HelperOutput, type HelperResult } from "@/lib/modules/shared/helper-agent";
import type { AgentName, AgentRunner, Genus, Species, SpeciesType } from "./types";

/**
 * Module 5 (Showcase · Broadening) sub-agents. Each prompt is the shared Backpack
 * (CORE + the agent's knowledge sections) prepended to the agent's own file. The
 * broadening agents pull the `broadening` doctrine; the verifier is the Boundary's
 * faithfulness guard at the gates.
 */

const MODULE_5_DIR = "module-5-showcase";

const PROMPT_FILES: Record<AgentName, string> = {
  helper: `${MODULE_5_DIR}/00-helper.md`,
  "genus-extractor": `${MODULE_5_DIR}/01-genus-extractor.md`,
  "species-synthesizer": `${MODULE_5_DIR}/02-species-synthesizer.md`,
  "key-concept-broadener": `${MODULE_5_DIR}/03-key-concept-broadener.md`,
  verifier: `${MODULE_5_DIR}/04-verifier.md`,
  // The 5c extender second pass.
  "background-extender": `${MODULE_5_DIR}/05-background-extender.md`,
  "summary-extender": `${MODULE_5_DIR}/06-summary-extender.md`,
  "detail-description-extender": `${MODULE_5_DIR}/07-detail-description-extender.md`,
  "abstract-rewriter": `${MODULE_5_DIR}/08-abstract-rewriter.md`,
  "key-concept-appender": `${MODULE_5_DIR}/09-key-concept-appender.md`,
};

const AGENT_SECTIONS: Record<AgentName, BackpackSection[]> = {
  helper: ["helper_doctrine"],
  "genus-extractor": ["broadening"],
  "species-synthesizer": ["broadening"],
  "key-concept-broadener": ["broadening"],
  verifier: [],
  "background-extender": ["broadening"],
  "summary-extender": ["broadening"],
  "detail-description-extender": ["broadening", "enablement_101"],
  "abstract-rewriter": ["broadening", "abstract_rules"],
  "key-concept-appender": ["broadening"],
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

/* ------------------------------------------------------------------ *
 * The 5c "extender" second pass — enrich the disclosure across paradigms.
 * ------------------------------------------------------------------ */

function renderSpecies(species: Species[]): string {
  if (!species.length) return "(none)";
  return species
    .map((s, i) =>
      [
        `(${i + 1}) [${s.species_type}] ${s.species_name}`,
        `    architecture: ${s.architectural_description}`,
        `    data flow: ${s.data_flow}`,
        `    key components: ${s.key_components.join("; ")}`,
        `    technical improvements: ${s.technical_improvements.join("; ")}`,
        `    differentiation: ${s.differentiation_from_traditional}`,
      ].join("\n"),
    )
    .join("\n\n");
}

/** Extenders that APPEND paragraphs to an existing section (background, summary). */
export const ExtenderOutput = z.object({ additional: z.string().default("") });
export type ExtenderResult = z.infer<typeof ExtenderOutput>;

async function runExtender(
  runAgent: AgentRunner,
  agent: "background-extender" | "summary-extender",
  input: { genus: Genus; species: Species[]; existing: string },
): Promise<ExtenderResult> {
  const system = await loadAgentPrompt(agent);
  const prompt = [
    "THE EXISTING SECTION (continue its voice; APPEND new paragraphs, do not rewrite what's there):",
    input.existing,
    "",
    "THE PARADIGM-NEUTRAL GENUS:",
    renderGenus(input.genus),
    "",
    "THE APPROVED ALTERNATIVE IMPLEMENTATIONS (species):",
    renderSpecies(input.species),
  ].join("\n");
  return runAgent({ agent, system, prompt, schema: ExtenderOutput, temperature: 0.3 });
}

export function runBackgroundExtender(
  runAgent: AgentRunner,
  input: { genus: Genus; species: Species[]; existing: string },
): Promise<ExtenderResult> {
  return runExtender(runAgent, "background-extender", input);
}

export function runSummaryExtender(
  runAgent: AgentRunner,
  input: { genus: Genus; species: Species[]; existing: string },
): Promise<ExtenderResult> {
  return runExtender(runAgent, "summary-extender", input);
}

/** The new "Detailed Description — Across Implementations" section body. */
export const SectionBodyOutput = z.object({ body: z.string().default("") });
export type SectionBodyResult = z.infer<typeof SectionBodyOutput>;

export async function runDetailDescriptionExtender(
  runAgent: AgentRunner,
  input: { genus: Genus; species: Species[] },
): Promise<SectionBodyResult> {
  const system = await loadAgentPrompt("detail-description-extender");
  const prompt = [
    "THE PARADIGM-NEUTRAL GENUS:",
    renderGenus(input.genus),
    "",
    "THE APPROVED ALTERNATIVE IMPLEMENTATIONS (species) — render ONE subsection per species, in order, then a technical-improvements paragraph and a hardware-optimization paragraph:",
    renderSpecies(input.species),
  ].join("\n");
  return runAgent({
    agent: "detail-description-extender",
    system,
    prompt,
    schema: SectionBodyOutput,
    temperature: 0.3,
  });
}

/** A complete replacement Abstract that folds in mechanism + species + hardware. */
export const AbstractRewriteOutput = z.object({ abstract: z.string().default("") });
export type AbstractRewriteResult = z.infer<typeof AbstractRewriteOutput>;

export async function runAbstractRewriter(
  runAgent: AgentRunner,
  input: { genus: Genus; species: Species[]; existing: string },
): Promise<AbstractRewriteResult> {
  const system = await loadAgentPrompt("abstract-rewriter");
  const prompt = [
    "THE ORIGINAL ABSTRACT (read it, then write a COMPLETE replacement):",
    input.existing,
    "",
    "THE PARADIGM-NEUTRAL GENUS:",
    renderGenus(input.genus),
    "",
    "THE APPROVED ALTERNATIVE IMPLEMENTATIONS (species):",
    renderSpecies(input.species),
  ].join("\n");
  return runAgent({
    agent: "abstract-rewriter",
    system,
    prompt,
    schema: AbstractRewriteOutput,
    temperature: 0.2,
  });
}

/** A new Key Concept covering one of the genus/species/hardware aspects. */
export const AppendedConceptOutput = z.object({
  title: z.string().default(""),
  key_concept_text: z.string().default(""),
});
export type AppendedConceptResult = z.infer<typeof AppendedConceptOutput>;

export type ConceptAspect =
  | "genus_mechanism"
  | "species_spectrum"
  | "hardware_optimization";

export async function runKeyConceptAppender(
  runAgent: AgentRunner,
  input: {
    genus: Genus;
    species: Species[];
    existingTitles: string[];
    aspect: ConceptAspect;
  },
): Promise<AppendedConceptResult> {
  const system = await loadAgentPrompt("key-concept-appender");
  const prompt = [
    `THE CONCEPT ASPECT TO WRITE: ${input.aspect}`,
    "",
    "THE PARADIGM-NEUTRAL GENUS:",
    renderGenus(input.genus),
    "",
    "THE APPROVED ALTERNATIVE IMPLEMENTATIONS (species):",
    renderSpecies(input.species),
    "",
    "EXISTING KEY CONCEPT TITLES (do NOT duplicate or overlap these):",
    ...input.existingTitles.map((t, i) => `(${i + 1}) ${t}`),
  ].join("\n");
  return runAgent({
    agent: "key-concept-appender",
    system,
    prompt,
    schema: AppendedConceptOutput,
    temperature: 0.3,
  });
}

/** The module Helper — replies to the inventor, teaches, brainstorms (Showcase context). */
export async function runHelper(
  runAgent: AgentRunner,
  input: {
    message: string;
    context: string;
    inventorMaterial: string;
    conversation: { role: string; text: string }[];
    consciousness?: string;
  },
): Promise<HelperResult> {
  const system = await loadAgentPrompt("helper");
  const prompt = buildHelperPrompt({
    message: input.message,
    where:
      "Module 5 (Showcase) — optionally broadening the Key Concepts across alternative implementations so the mechanism is covered however it's built",
    context: input.context,
    inventorMaterial: input.inventorMaterial,
    conversation: input.conversation,
    ...(input.consciousness ? { consciousness: input.consciousness } : {}),
  });
  return runAgent({ agent: "helper", system, prompt, schema: HelperOutput, temperature: 0.4 });
}
