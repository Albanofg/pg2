import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { withBackpack, type BackpackSection } from "@/lib/modules/shared";
import { buildHelperPrompt, HelperOutput, type HelperResult } from "@/lib/modules/shared/helper-agent";
import type { AgentName, AgentRunner, ConceptLandscape, SectionAgent } from "./types";

/**
 * Module 4 (Differentiation) — the Slice-A sub-agents. Module 4 owns each agent's
 * prompt + I/O contract; the Helper owns the model call via the injected
 * AgentRunner. Each prompt is the shared Backpack (CORE + the agent's relevant
 * knowledge sections) prepended to the agent's own prompt file.
 */

const MODULE_4_DIR = "module-4-differentiation";

const SEC_DIR = `${MODULE_4_DIR}/sections`;

const PROMPT_FILES: Record<AgentName, string> = {
  helper: `${MODULE_4_DIR}/00-helper.md`,
  "key-concept-decomposer": `${MODULE_4_DIR}/06-key-concept-decomposer.md`,
  whitespace: `${MODULE_4_DIR}/01-whitespace.md`,
  "differentiation-teacher": `${MODULE_4_DIR}/07-teacher.md`,
  "gap-framer": `${MODULE_4_DIR}/01-gap-framer.md`,
  "differentiation-formalizer": `${MODULE_4_DIR}/02-differentiation-formalizer.md`,
  verifier: `${MODULE_4_DIR}/03-verifier.md`,
  "pohc-scorer": `${MODULE_4_DIR}/05-pohc.md`,
  // The nine per-section disclosure specialists.
  "sec-title": `${SEC_DIR}/title.md`,
  "sec-background": `${SEC_DIR}/background.md`,
  "sec-summary": `${SEC_DIR}/summary.md`,
  "sec-abstract": `${SEC_DIR}/abstract.md`,
  "sec-architecture": `${SEC_DIR}/architecture.md`,
  "sec-data-structures": `${SEC_DIR}/data-structures.md`,
  "sec-operations": `${SEC_DIR}/operations.md`,
  "sec-alternatives": `${SEC_DIR}/alternatives.md`,
  "sec-ramifications": `${SEC_DIR}/ramifications.md`,
};

/** Which Backpack knowledge sections each agent pulls in (on top of CORE). */
const AGENT_SECTIONS: Record<AgentName, BackpackSection[]> = {
  helper: ["helper_doctrine"],
  "key-concept-decomposer": [],
  whitespace: ["examiner_grounds"],
  "differentiation-teacher": [],
  "gap-framer": ["examiner_grounds"],
  "differentiation-formalizer": [],
  verifier: [],
  "pohc-scorer": ["inventorship_factors"],
  "sec-title": [],
  "sec-background": [],
  "sec-summary": [],
  "sec-abstract": ["abstract_rules"],
  "sec-architecture": ["enablement_101"],
  "sec-data-structures": ["enablement_101"],
  "sec-operations": ["enablement_101"],
  "sec-alternatives": ["broadening"],
  "sec-ramifications": [],
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

/**
 * Splits one carried Concept into its distinct novel elements — one element per
 * Key Concept, by technical density, each traceable to the inventor's words. It
 * splits what is genuinely there; it never manufactures concepts to look thorough.
 */
export const KeyConceptDecomposerOutput = z.object({
  concepts: z
    .array(
      z.object({
        title: z.string(),
        statement: z.string(),
        source_excerpts: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});
export type KeyConceptDecomposerResult = z.infer<typeof KeyConceptDecomposerOutput>;

export async function runKeyConceptDecomposer(
  runAgent: AgentRunner,
  input: { title: string; statement: string; verbatim: string[] },
): Promise<KeyConceptDecomposerResult> {
  const system = await loadAgentPrompt("key-concept-decomposer");
  const prompt = [
    `THE CONCEPT: ${input.title}`,
    `Current statement: ${input.statement}`,
    "",
    "THE INVENTOR'S OWN WORDS (the ONLY source — split only what is genuinely distinct here; cite the excerpts each split rests on):",
    ...input.verbatim.map((v, i) => `[${i + 1}] ${v}`),
  ].join("\n");
  return runAgent({
    agent: "key-concept-decomposer",
    system,
    prompt,
    schema: KeyConceptDecomposerOutput,
    temperature: 0.2,
  });
}

/** V1 whitespace ("open landscape") — the full prior-art mechanism surfacing + synthesis. */
export const WhitespaceOutput = z.object({
  totalPatentsAnalyzed: z.number().default(0),
  patentAnalyses: z
    .array(
      z.object({
        patentNumber: z.string().default(""),
        patentTitle: z.string().default(""),
        patentStatus: z.enum(["GRANTED", "PENDING", "UNKNOWN"]).default("UNKNOWN"),
        extractedMechanisms: z.array(z.string()).default([]),
        inventorClarificationQuestions: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  crossPatentClarificationQuestions: z.array(z.string()).default([]),
  overallMatchLevel: z
    .object({
      level: z.enum(["Green Match", "Yellow Match", "Red Match"]).default("Green Match"),
      directMatches: z.number().default(0),
      adjacentMatches: z.number().default(0),
      unrelatedReferences: z.number().default(0),
    })
    .default({ level: "Green Match", directMatches: 0, adjacentMatches: 0, unrelatedReferences: 0 }),
  consolidatedOpenLandscapeAnalysis: z.string().default(""),
  primaryDistinguishingFeatures: z.array(z.string()).default([]),
  keyConceptDevelopmentGuidance: z.string().default(""),
});
export type WhitespaceResult = z.infer<typeof WhitespaceOutput>;

export async function runWhitespace(
  runAgent: AgentRunner,
  input: {
    title: string;
    statement: string;
    references: {
      publicationNumber: string;
      title: string;
      summary: string;
      relevanceScore?: number;
    }[];
  },
): Promise<WhitespaceResult> {
  const system = await loadAgentPrompt("whitespace");
  const prompt = [
    "THE KEY CONCEPT (the inventor's owned, distinct technological description):",
    `${input.title}: ${input.statement}`,
    "",
    `THE PRIOR-ART REFERENCES (${input.references.length}):`,
    input.references.length
      ? input.references
          .map(
            (r, i) =>
              `[${i + 1}] ${r.publicationNumber || "(no number)"} — ${r.title}\n    summary: ${r.summary || "(no summary provided)"}\n    relevance: ${r.relevanceScore ?? "n/a"}`,
          )
          .join("\n")
      : "(no prior art found — return totalPatentsAnalyzed 0, a Green Match, an empty patentAnalyses list, and an open-landscape paragraph noting the area appears open)",
  ].join("\n");
  return runAgent({ agent: "whitespace", system, prompt, schema: WhitespaceOutput, temperature: 0.2 });
}

/**
 * The Differentiation Teacher — turns the raw whitespace analysis into a TIGHT,
 * scannable plain-English lesson (~20 seconds to read) that leads the inventor to
 * their own distinction. It never writes the inventor's differentiation; the
 * scaffold has blanks the inventor fills.
 */
export const DiffTeachOutput = z.object({
  intro: z.string().default(""),
  buckets: z
    .array(
      z.object({
        label: z.string().default(""),
        plain: z.string().default(""),
        not_you: z.string().default(""),
      }),
    )
    .default([]),
  distinction: z.string().default(""),
  key_terms: z
    .array(z.object({ term: z.string().default(""), meaning: z.string().default("") }))
    .default([]),
  analogy: z.string().default(""),
  scaffold: z.string().default(""),
  prompt: z.string().default(""),
});
export type DiffTeachResult = z.infer<typeof DiffTeachOutput>;

export async function runDifferentiationTeacher(
  runAgent: AgentRunner,
  input: { title: string; statement: string; analysis: WhitespaceResult },
): Promise<DiffTeachResult> {
  const system = await loadAgentPrompt("differentiation-teacher");
  const a = input.analysis;
  const prompt = [
    "THE KEY CONCEPT:",
    `${input.title}: ${input.statement}`,
    "",
    `THE ANALYSIS — ${a.totalPatentsAnalyzed} existing-art reference(s), Match Level: ${a.overallMatchLevel.level}.`,
    "",
    "REFERENCES AND THE MECHANISMS THEY DESCRIBE (group these into 2–4 plain-English buckets — never one bucket per reference):",
    a.patentAnalyses.length
      ? a.patentAnalyses
          .map(
            (p, i) =>
              `[${i + 1}] ${p.patentTitle || p.patentNumber || "(untitled)"}: ${
                p.extractedMechanisms.length ? p.extractedMechanisms.join("; ") : "(no specific mechanism extracted)"
              }`,
          )
          .join("\n")
      : "(no close existing art — the area appears open)",
    "",
    "THE DISTINGUISHING FEATURES ALREADY SURFACED (draw the distinction and key terms from these — invent nothing):",
    a.primaryDistinguishingFeatures.length
      ? a.primaryDistinguishingFeatures.map((f) => `• ${f}`).join("\n")
      : "(none surfaced)",
    "",
    "THE OPEN-LANDSCAPE SYNTHESIS (context):",
    a.consolidatedOpenLandscapeAnalysis || "(none)",
  ].join("\n");
  return runAgent({
    agent: "differentiation-teacher",
    system,
    prompt,
    schema: DiffTeachOutput,
    temperature: 0.3,
  });
}

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

/** Every per-section drafter returns one field: the raw prose for its section. */
export const SectionOutput = z.object({ body: z.string().default("") });
export type SectionResult = z.infer<typeof SectionOutput>;

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

/**
 * Draft ONE disclosure section with its specialist agent. Every section gets the
 * same rich material — Key Concepts, the inventor's full verbatim, the
 * representative code, the prior-art summary — plus any already-drafted sections
 * it depends on (so reference numerals, component names, and Data Object names
 * stay consistent across the disclosure). The section's own prompt file enforces
 * its depth rules; this only assembles the fuel.
 */
export async function runSection(
  runAgent: AgentRunner,
  agent: SectionAgent,
  input: {
    keyConcepts: { title: string; statement: string; differentiation: string }[];
    verbatim: string[];
    code?: { language: string; code: string } | null;
    artSummary: string;
    priorSections?: { label: string; body: string }[];
    consciousness?: string;
  },
): Promise<SectionResult> {
  const system = await loadAgentPrompt(agent);
  const prompt = [
    "THE OWNED KEY CONCEPTS (anchors of the disclosure):",
    ...input.keyConcepts.map(
      (k, i) =>
        `(${i + 1}) ${k.title}\n    Statement: ${k.statement}\n    Differentiation: ${k.differentiation}`,
    ),
    "",
    "THE INVENTOR'S OWN WORDS (the only source of technical substance — draw on these, invent nothing beyond them):",
    ...input.verbatim.map((v, i) => `[${i + 1}] ${v}`),
    ...(input.code?.code?.trim()
      ? [
          "",
          `REPRESENTATIVE CODE (${input.code.language}) — concrete implementation the inventor approved; mine it for components, data fields, and steps, but add no mechanism it does not show:`,
          input.code.code,
        ]
      : []),
    ...(input.artSummary?.trim()
      ? [
          "",
          "WHAT THE PRIOR ART COVERS (Background context only — never present it as the invention):",
          input.artSummary,
        ]
      : []),
    ...(input.priorSections?.length
      ? [
          "",
          "SECTIONS ALREADY DRAFTED FOR THIS DISCLOSURE — reuse their reference numerals, component names, and Data Object names EXACTLY; do not renumber or rename:",
          ...input.priorSections.map((s) => `### ${s.label}\n${s.body}`),
        ]
      : []),
    ...(input.consciousness
      ? [
          "",
          "EVERYTHING SETTLED FOR THIS PATENT (Shared Consciousness — stay consistent):",
          input.consciousness,
        ]
      : []),
  ].join("\n");
  return runAgent({ agent, system, prompt, schema: SectionOutput, temperature: 0.3 });
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

/** The module Helper — replies to the inventor, teaches, brainstorms (Differentiation context). */
export async function runHelper(
  runAgent: AgentRunner,
  input: {
    message: string;
    context: string;
    inventorMaterial: string;
    conversation: { role: string; text: string }[];
    consciousness?: string;
    /** Phase-aware "where you are" line; falls back to the capture-phase framing. */
    where?: string;
  },
): Promise<HelperResult> {
  const system = await loadAgentPrompt("helper");
  const prompt = buildHelperPrompt({
    message: input.message,
    where:
      input.where ??
      "Module 4 (Differentiation) — the heavy moment: per concept, framing the prior-art gap and capturing, in the inventor's own words, what is genuinely new",
    context: input.context,
    inventorMaterial: input.inventorMaterial,
    conversation: input.conversation,
    ...(input.consciousness ? { consciousness: input.consciousness } : {}),
  });
  return runAgent({ agent: "helper", system, prompt, schema: HelperOutput, temperature: 0.4 });
}
