import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { withBackpack, type BackpackSection } from "@/lib/modules/shared";
import { buildHelperPrompt, HelperOutput, type HelperResult } from "@/lib/modules/shared/helper-agent";
import { resolveFamilyBlock } from "@/lib/families/helper-context";
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
  // Genus & Species Expansion agents live in their own subfolder.
  "genus-extractor": `${MODULE_5_DIR}/genus-species/01-genus-extractor.md`,
  "key-concept-broadener": `${MODULE_5_DIR}/03-key-concept-broadener.md`,
  verifier: `${MODULE_5_DIR}/04-verifier.md`,
  // The 5c extender second pass.
  "background-extender": `${MODULE_5_DIR}/05-background-extender.md`,
  "summary-extender": `${MODULE_5_DIR}/06-summary-extender.md`,
  "detail-description-extender": `${MODULE_5_DIR}/07-detail-description-extender.md`,
  "abstract-rewriter": `${MODULE_5_DIR}/08-abstract-rewriter.md`,
  "key-concept-appender": `${MODULE_5_DIR}/09-key-concept-appender.md`,
  "figure-planner": `${MODULE_5_DIR}/10-figure-planner.md`,
  "section-polisher": `${MODULE_5_DIR}/11-section-polisher.md`,
  // Layer 4/5 (redesign) — genus-species subfolder.
  "criterion-fragmenter": `${MODULE_5_DIR}/genus-species/05-criterion-fragmenter.md`,
  "breadth-assessor": `${MODULE_5_DIR}/genus-species/07-breadth-assessor.md`,
  "baseline-builder": `${MODULE_5_DIR}/genus-species/08-baseline-builder.md`,
  enumerator: `${MODULE_5_DIR}/genus-species/03-enumerator.md`,
  grader: `${MODULE_5_DIR}/genus-species/04-grader.md`,
  formalizer: `${MODULE_5_DIR}/genus-species/06-formalizer.md`,
};

const AGENT_SECTIONS: Record<AgentName, BackpackSection[]> = {
  helper: ["helper_doctrine"],
  "genus-extractor": ["broadening"],
  "key-concept-broadener": ["broadening"],
  verifier: [],
  "background-extender": ["broadening"],
  "summary-extender": ["broadening"],
  "detail-description-extender": ["broadening", "enablement_101"],
  "abstract-rewriter": ["broadening", "abstract_rules"],
  "key-concept-appender": ["broadening"],
  // The figure planner needs the CORE vocabulary discipline only — no broadening.
  "figure-planner": [],
  // The section polisher composes established material into prose; broadening
  // gives it the vocabulary discipline, abstract_rules the Abstract constraints.
  "section-polisher": ["broadening", "abstract_rules"],
  // Layer 4 agents are retrieval/grading only — CORE vocabulary discipline suffices.
  "criterion-fragmenter": [],
  "breadth-assessor": [],
  "baseline-builder": [],
  enumerator: [],
  grader: [],
  // The formalizer restates a kept card into disclosure prose — broadening gives
  // it the vocabulary discipline; it never enriches (strict restate-only prompt).
  formalizer: ["broadening"],
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

/** A gap an agent declares in its output when substance is absent (see DeclaredGap). */
export const DeclaredGapOutput = z.object({
  gap_class: z.enum([
    "missing_constraint",
    "missing_invariant",
    "missing_mechanism",
    "missing_step",
    "missing_criterion_source",
  ]),
  field: z.string().default(""),
  note: z.string().default(""),
});

export const GenusOutput = z.object({
  genus_name: z.string(),
  genus_description: z.string(),
  input_pattern: z.string().default(""),
  transformation_pattern: z.string().default(""),
  output_pattern: z.string().default(""),
  // Constraints and invariants FORMALIZED FROM THE INPUTS only — empty when the
  // inputs supply none. The Extractor never authors these (genus_extractor_v2.1).
  computational_constraints: z.array(z.string()).default([]),
  logical_invariants: z.array(z.string()).default([]),
  // The rule-engine / language-model / agent implementability narrative.
  paradigm_neutrality_check: z.string().default(""),
  // Gaps the Extractor opened instead of authoring missing substance. Recorded to
  // the pipeline gap object by the controller (gap_opened Ledger event).
  gaps: z.array(DeclaredGapOutput).default([]),
});
export type GenusResult = z.infer<typeof GenusOutput>;

export const SpeciesOutput = z.object({
  species_type: z.enum(["ai_assisted", "ai_native", "agentic"]),
  species_name: z.string(),
  architectural_description: z.string().default(""),
  // V2 §112 algorithmic disclosure — the step-by-step corresponding structure and
  // the genus constraint/invariant discharge maps. Empty on V1-drafted species.
  sequence_of_operations: z.array(z.string()).default([]),
  data_flow: z.string().default(""),
  key_components: z.array(z.string()).default([]),
  constraint_enforcement_map: z.array(z.string()).default([]),
  invariant_preservation_map: z.array(z.string()).default([]),
  technical_improvements: z.array(z.string()).default([]),
  // V2 renamed differentiation_from_traditional → differentiation_from_siblings.
  // Accept both so V1 and V2 prompt outputs both parse; downstream prefers siblings.
  differentiation_from_siblings: z.string().default(""),
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

/**
 * The figure PLAN: the complete drawing set + numeral ledger + a grounded
 * description per figure. app 2 owns this stage (plan-mode); the diagram service
 * only draws it. `briefDescription`/`detailedDescription` are OUR document text —
 * each is built strictly from that figure's ledger numerals, never invented.
 */
export const FigurePlanOutput = z.object({
  figures: z
    .array(
      z.object({
        figNumber: z.number().int(),
        figType: z.enum([
          "system",
          "module",
          "flowchart",
          "dataflow",
          "sequence",
          "state",
          "hardware",
          "record",
        ]),
        title: z.string().default(""),
        briefDescription: z.string().default(""),
        detailedDescription: z.string().default(""),
        outline: z.string().default(""),
        numerals: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  numerals: z
    .array(
      z.object({
        ref: z.string(),
        feature: z.string().default(""),
        figures: z.array(z.number().int()).default([]),
        definedInSpec: z.boolean().default(false),
      }),
    )
    .default([]),
  gaps: z.array(z.string()).default([]),
});
export type FigurePlanResult = z.infer<typeof FigurePlanOutput>;

export async function runFigurePlanner(
  runAgent: AgentRunner,
  input: { specText: string },
): Promise<FigurePlanResult> {
  const system = await loadAgentPrompt("figure-planner");
  const prompt = [
    "THE INVENTION CONCEPT BLUEPRINT (draft sections + Key Concepts):",
    "",
    input.specText,
  ].join("\n");
  return runAgent({
    agent: "figure-planner",
    system,
    prompt,
    schema: FigurePlanOutput,
    temperature: 0.2,
  });
}

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
    ...(g.computational_constraints?.length
      ? ["computational_constraints:", ...g.computational_constraints.map((c) => `  - ${c}`)]
      : []),
    ...(g.logical_invariants?.length
      ? ["logical_invariants:", ...g.logical_invariants.map((v) => `  - ${v}`)]
      : []),
    ...(g.paradigm_neutrality_check
      ? [`paradigm_neutrality_check: ${g.paradigm_neutrality_check}`]
      : []),
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
  return runAgent({
    agent: "genus-extractor",
    system,
    prompt,
    schema: GenusOutput,
    temperature: 0.2,
    subject: input.keyConcepts.map((k) => k.title).join("; "),
  });
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
    subject: input.original,
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
  return runAgent({
    agent: "verifier",
    system,
    prompt,
    schema: VerifierOutput,
    temperature: 0,
    subject: input.piece,
  });
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
        `    differentiation: ${s.differentiation_from_siblings || s.differentiation_from_traditional || ""}`,
      ].join("\n"),
    )
    .join("\n\n");
}

/** Extenders that APPEND paragraphs to an existing section (background, summary). */
export const ExtenderOutput = z.object({
  additional: z.string().default(""),
  // V1's audit trails (background + summary extenders emit different subsets).
  ai_categories_covered: z.array(z.string()).default([]),
  limitations_identified: z.array(z.string()).default([]),
  aspects_covered: z.array(z.string()).default([]),
  species_named: z.array(z.string()).default([]),
  continuity_check: z.string().default(""),
});
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
  return runAgent({
    agent,
    system,
    prompt,
    schema: ExtenderOutput,
    temperature: 0.3,
    subject: input.genus.genus_name,
  });
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

/** V1's "Across Implementations" body: a fixed-order sequence of subsections. */
export const DetailDescriptionOutput = z.object({
  subsections: z
    .array(
      z.object({
        subsection_title: z.string().default(""),
        subsection_content: z.string().default(""),
      }),
    )
    .default([]),
  species_covered: z.array(z.string()).default([]),
});
export type DetailDescriptionResult = z.infer<typeof DetailDescriptionOutput>;

export async function runDetailDescriptionExtender(
  runAgent: AgentRunner,
  input: { genus: Genus; species: Species[]; existing?: string },
): Promise<DetailDescriptionResult> {
  const system = await loadAgentPrompt("detail-description-extender");
  const prompt = [
    "THE EXISTING DETAILED TECHNICAL SECTIONS (continue their voice; never repeat their content):",
    input.existing?.trim() || "(none provided)",
    "",
    "THE PARADIGM-NEUTRAL GENUS:",
    renderGenus(input.genus),
    "",
    "THE APPROVED ALTERNATIVE IMPLEMENTATIONS (species) WITH FULL DETAILS:",
    renderSpecies(input.species),
  ].join("\n");
  return runAgent({
    agent: "detail-description-extender",
    system,
    prompt,
    schema: DetailDescriptionOutput,
    temperature: 0.3,
    subject: input.genus.genus_name,
  });
}

/** A complete replacement Abstract that folds in mechanism + species + hardware. */
export const AbstractRewriteOutput = z.object({
  abstract: z.string().default(""),
  // V1's audit trail.
  word_count: z.coerce.number().default(0),
  aspects_covered: z.array(z.string()).default([]),
  species_named: z.array(z.string()).default([]),
  word_budget_check: z.string().default(""),
});
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
    subject: input.genus.genus_name,
  });
}

/** A new Key Concept covering one of the genus/species/hardware aspects. */
export const AppendedConceptOutput = z.object({
  title: z.string().default(""),
  key_concept_text: z.string().default(""),
  // V1's audit trail — what the concept covers + why it doesn't duplicate.
  covers: z.array(z.string()).default([]),
  non_duplication_check: z.string().default(""),
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
    /** The FULL existing Key Concepts — V1's non-duplication audit reads their
     *  content, not just their titles. */
    existing: { title: string; statement: string }[];
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
    "THE EXISTING KEY CONCEPTS (audit these — the new concept must add content none of them already carries):",
    ...input.existing.map((k, i) => `(${i + 1}) ${k.title}: ${k.statement}`),
  ].join("\n");
  return runAgent({
    agent: "key-concept-appender",
    system,
    prompt,
    schema: AppendedConceptOutput,
    temperature: 0.3,
    subject: `${input.aspect}: ${input.genus.genus_name}`,
  });
}

/* ------------------------------------------------------------------ *
 * Section polisher — the on-demand "Draft / Revise with AI" in the editor.
 * Composes already-established material into cleaner prose for ONE narrative
 * section; never invents. "revise" preserves the inventor's version and only
 * improves it; "draft" rebuilds from the established material. Both preserve
 * every substantive point (the prompt's PRESERVATION_FIRST law).
 * ------------------------------------------------------------------ */

export type SectionPolishMode = "draft" | "revise";

export const SectionPolishOutput = z.object({
  body: z.string().default(""),
  change_summary: z.string().default(""),
  preserved_points: z.array(z.string()).default([]),
  // Substance the section needs but the inputs don't supply — flagged, not filled.
  gaps: z.array(DeclaredGapOutput).default([]),
});
export type SectionPolishResult = z.infer<typeof SectionPolishOutput>;

export async function runSectionPolisher(
  runAgent: AgentRunner,
  input: {
    sectionLabel: string;
    mode: SectionPolishMode;
    currentBody: string;
    genus: Genus | null;
    species: Species[];
    keyConcepts: { title: string; statement: string; broadened?: string }[];
    /** The other draft sections, for voice/consistency (label + body). */
    otherSections: { label: string; body: string }[];
  },
): Promise<SectionPolishResult> {
  const system = await loadAgentPrompt("section-polisher");
  const others = input.otherSections
    .filter((s) => s.body.trim())
    .map((s) => `### ${s.label}\n${s.body}`)
    .join("\n\n");
  const prompt = [
    `MODE: ${input.mode}`,
    `SECTION TO ${input.mode === "draft" ? "DRAFT" : "REVISE"}: ${input.sectionLabel}`,
    "",
    "CURRENT TEXT OF THIS SECTION (preserve every substantive point it makes):",
    input.currentBody.trim() || "(empty — there is no current text; compose it from the established material)",
    "",
    "THE KEY CONCEPTS (the inventor's owned anchors; 'broadened' is the widened wording when present):",
    input.keyConcepts.length
      ? input.keyConcepts
          .map((k, i) => `(${i + 1}) ${k.title}: ${k.broadened || k.statement}`)
          .join("\n")
      : "(none)",
    "",
    "THE PARADIGM-NEUTRAL GENUS:",
    input.genus ? renderGenus(input.genus) : "(none)",
    "",
    "THE APPROVED ALTERNATIVE IMPLEMENTATIONS (species):",
    renderSpecies(input.species),
    "",
    "THE OTHER DRAFT SECTIONS (match their voice and tense; do not repeat their content):",
    others || "(none)",
  ].join("\n");
  return runAgent({
    agent: "section-polisher",
    system,
    prompt,
    schema: SectionPolishOutput,
    temperature: 0.3,
    subject: input.sectionLabel,
  });
}

/* ------------------------------------------------------------------ *
 * Layer 4 (redesign) — criterion fragmenter → enumerator → skeptic grader.
 * Retrieval + grading only; these never author a mechanism. Not yet wired into
 * the live expansion flow (that cutover needs Layer 5 to consume survivors).
 * ------------------------------------------------------------------ */

export const CriterionFragmentOutput = z.object({
  fragments: z
    .array(
      z.object({
        text: z.string().default(""),
        source_id: z.string().default(""),
      }),
    )
    .default([]),
});
export type CriterionFragmentResult = z.infer<typeof CriterionFragmentOutput>;

/** Lift verbatim criterion fragments from the inventor's own upstream statements. */
export async function runCriterionFragmenter(
  runAgent: AgentRunner,
  input: { statements: { id: string; text: string }[] },
): Promise<CriterionFragmentResult> {
  const system = await loadAgentPrompt("criterion-fragmenter");
  const prompt = [
    "THE INVENTOR'S STATEMENTS (lift criterion fragments verbatim from these; cite the id):",
    ...input.statements.map((s) => `[${s.id}] ${s.text}`),
  ].join("\n");
  return runAgent({
    agent: "criterion-fragmenter",
    system,
    prompt,
    schema: CriterionFragmentOutput,
    temperature: 0.1,
  });
}

export const BreadthOutput = z.object({
  band: z.enum(["narrow", "moderate", "broad"]).default("moderate"),
  reason: z.string().default(""),
});
export type BreadthResult = z.infer<typeof BreadthOutput>;

/** Size how many genuinely distinct implementations the genus supports (narrow/moderate/broad). */
export async function runBreadthAssessor(
  runAgent: AgentRunner,
  input: { genus: Genus; keyConcepts: { title: string; statement: string }[] },
): Promise<BreadthResult> {
  const system = await loadAgentPrompt("breadth-assessor");
  const prompt = [
    "THE GENUS:",
    renderGenus(input.genus),
    "",
    "THE KEY CONCEPTS (context only):",
    input.keyConcepts.length
      ? input.keyConcepts.map((k, i) => `(${i + 1}) ${k.title}: ${k.statement}`).join("\n")
      : "(none)",
  ].join("\n");
  return runAgent({
    agent: "breadth-assessor",
    system,
    prompt,
    schema: BreadthOutput,
    temperature: 0.1,
    subject: input.genus.genus_name,
  });
}

/**
 * The three MANDATORY build-styles, always present, mapped onto the invention.
 * Runs alongside the Enumerator; the inventor sees these three first, then the
 * emergent forest. species_type is the internal tag; the rest is plain-language.
 */
export const BaselineOutput = z.object({
  builds: z
    .array(
      z.object({
        species_type: z.enum(["ai_assisted", "ai_native", "agentic"]),
        label: z.string().default(""),
        source: z.string().default(""),
        mapping: z.string().default(""),
        tradeoff: z.string().default(""),
      }),
    )
    .default([]),
});
export type BaselineResult = z.infer<typeof BaselineOutput>;

/** Map the invention onto the three standard build-styles (always exactly three). */
export async function runBaselineBuilder(
  runAgent: AgentRunner,
  input: { genus: Genus; confirmedConstraints: string[] },
): Promise<BaselineResult> {
  const system = await loadAgentPrompt("baseline-builder");
  const prompt = [
    "THE MECHANISM (what the invention does):",
    renderGenus(input.genus),
    "",
    "THE CONFIRMED CONSTRAINTS:",
    input.confirmedConstraints.length
      ? input.confirmedConstraints.map((c) => `- ${c}`).join("\n")
      : "(none provided)",
  ].join("\n");
  return runAgent({
    agent: "baseline-builder",
    system,
    prompt,
    schema: BaselineOutput,
    temperature: 0.4,
    subject: input.genus.genus_name,
  });
}

export const EnumeratorOutput = z.object({
  candidates: z
    .array(
      z.object({
        family: z.string().default(""),
        label: z.string().default(""),
        source: z.string().default(""),
        mapping: z.string().default(""),
        tradeoff: z.string().default(""),
      }),
    )
    .default([]),
  gaps: z.array(DeclaredGapOutput).default([]),
});
export type EnumeratorResult = z.infer<typeof EnumeratorOutput>;

/** Surface genuinely distinct ways to build the invention, sized to a target count. */
export async function runEnumerator(
  runAgent: AgentRunner,
  input: { genus: Genus; confirmedConstraints: string[]; target: number },
): Promise<EnumeratorResult> {
  const system = await loadAgentPrompt("enumerator");
  const prompt = [
    "THE MECHANISM (what the invention does):",
    renderGenus(input.genus),
    "",
    "THE CONFIRMED CONSTRAINTS:",
    input.confirmedConstraints.length
      ? input.confirmedConstraints.map((c) => `- ${c}`).join("\n")
      : "(none provided)",
    "",
    `TARGET COUNT (aim for roughly this many genuinely distinct ways): ${input.target}`,
  ].join("\n");
  return runAgent({
    agent: "enumerator",
    system,
    prompt,
    schema: EnumeratorOutput,
    temperature: 0.6,
    subject: input.genus.genus_name,
  });
}

export const GraderOutput = z.object({
  grades: z
    .array(
      z.object({
        label: z.string().default(""),
        traceability: z.coerce.number().default(0),
        fidelity: z.coerce.number().default(0),
        specificity: z.coerce.number().default(0),
        distinctness: z.coerce.number().default(0),
        verdict: z.enum(["survive", "demote", "reject"]).default("demote"),
        reason: z.string().default(""),
      }),
    )
    .default([]),
});
export type GraderResult = z.infer<typeof GraderOutput>;

/** Skeptic grading pass — demotes/rejects; never adds. Ideally the other model. */
export async function runGrader(
  runAgent: AgentRunner,
  input: {
    candidates: { label: string; source: string; mapping: string; tradeoff: string }[];
    genus: Genus;
    confirmedConstraints: string[];
  },
): Promise<GraderResult> {
  const system = await loadAgentPrompt("grader");
  const prompt = [
    "THE CANDIDATES (grade each; one entry per candidate, same order):",
    ...input.candidates.map(
      (c, i) =>
        `(${i + 1}) [${c.label}]\n    source: ${c.source}\n    mapping: ${c.mapping}\n    tradeoff: ${c.tradeoff}`,
    ),
    "",
    "THE GENUS:",
    renderGenus(input.genus),
    "",
    "THE CONFIRMED CONSTRAINTS:",
    input.confirmedConstraints.length
      ? input.confirmedConstraints.map((c) => `- ${c}`).join("\n")
      : "(none provided)",
  ].join("\n");
  return runAgent({
    agent: "grader",
    system,
    prompt,
    schema: GraderOutput,
    temperature: 0.2,
    subject: input.genus.genus_name,
  });
}

export const FormalizerOutput = z.object({
  title: z.string().default(""),
  body: z.string().default(""),
  // Substance the disclosure needs but the three inputs don't supply — flagged,
  // never filled. Both gap classes are accepted (missing_mechanism | missing_step).
  gaps: z.array(DeclaredGapOutput).default([]),
});
export type FormalizerResult = z.infer<typeof FormalizerOutput>;

/** Write disclosure prose for ONE kept candidate — restate only; open gaps; never extend. */
export async function runFormalizer(
  runAgent: AgentRunner,
  input: {
    card: { label: string; source: string; mapping: string; tradeoff: string };
    inventorMaterial: string;
    confirmedConstraints: string[];
  },
): Promise<FormalizerResult> {
  const system = await loadAgentPrompt("formalizer");
  const prompt = [
    "THE KEPT CARD:",
    `  label: ${input.card.label}`,
    `  source: ${input.card.source}`,
    `  mapping: ${input.card.mapping}`,
    `  tradeoff: ${input.card.tradeoff}`,
    "",
    "THE INVENTOR'S UPSTREAM MATERIAL (their own words — one of your only three sources):",
    input.inventorMaterial || "(none)",
    "",
    "THE CONFIRMED CONSTRAINTS:",
    input.confirmedConstraints.length
      ? input.confirmedConstraints.map((c) => `- ${c}`).join("\n")
      : "(none provided)",
  ].join("\n");
  return runAgent({
    agent: "formalizer",
    system,
    prompt,
    schema: FormalizerOutput,
    temperature: 0.2,
    subject: input.card.label,
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
  const familyContext = (await resolveFamilyBlock(input.message)) ?? undefined;
  const prompt = buildHelperPrompt({
    message: input.message,
    where:
      "Module 5 (Showcase) — optionally broadening the Key Concepts across alternative implementations so the mechanism is covered however it's built",
    context: input.context,
    inventorMaterial: input.inventorMaterial,
    conversation: input.conversation,
    ...(input.consciousness ? { consciousness: input.consciousness } : {}),
    ...(familyContext ? { familyContext } : {}),
  });
  return runAgent({ agent: "helper", system, prompt, schema: HelperOutput, temperature: 0.4 });
}
