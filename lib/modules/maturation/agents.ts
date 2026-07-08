import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { withBackpack, type AgentRunner, type BackpackSection } from "@/lib/modules/shared";
import { buildHelperPrompt, HelperOutput, type HelperResult } from "@/lib/modules/shared/helper-agent";
import { resolveFamilyBlock } from "@/lib/families/helper-context";
import type { AgentName } from "./types";

/**
 * Module 2 (Maturation) — the Deepener. Module 2 owns the prompt and the I/O
 * contract; the Helper owns the model call via the injected `AgentRunner`.
 */

const MODULE_2_DIR = "module-2-maturation";

const PROMPT_FILES: Record<AgentName, string> = {
  deepener: `${MODULE_2_DIR}/01-deepener.md`,
  verifier: `${MODULE_2_DIR}/02-verifier.md`,
  helper: `${MODULE_2_DIR}/00-helper.md`,
};

const AGENT_SECTIONS: Record<AgentName, BackpackSection[]> = {
  deepener: [],
  verifier: [],
  helper: ["helper_doctrine"],
};

const promptCache = new Map<AgentName, string>();

/**
 * Load an agent's system prompt: the shared Backpack prepended to the agent's
 * own prompt file, so every agent reads BOTH shared layers. File cached; the
 * Backpack is prepended on each return.
 */
export async function loadAgentPrompt(agent: AgentName): Promise<string> {
  let contents = promptCache.get(agent);
  if (!contents) {
    const file = path.join(process.cwd(), "prompts", ...PROMPT_FILES[agent].split("/"));
    contents = (await readFile(file, "utf8")).trim();
    promptCache.set(agent, contents);
  }
  return withBackpack(contents, AGENT_SECTIONS[agent]);
}

/** The module Helper — replies to the inventor, teaches, brainstorms (Maturation context). */
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
      "Module 2 (Maturation) — deepening each owned concept into a fuller, search-ready technical statement",
    context: input.context,
    inventorMaterial: input.inventorMaterial,
    conversation: input.conversation,
    ...(input.consciousness ? { consciousness: input.consciousness } : {}),
    ...(familyContext ? { familyContext } : {}),
  });
  return runAgent({ agent: "helper", system, prompt, schema: HelperOutput, temperature: 0.4 });
}

export const DeepenerOutput = z.object({
  deepened_statement: z.string(),
  search_ready: z.boolean(),
  missing_for_search: z.string().default(""),
  /** A concrete, plausible way to specify the search gap, for the inventor to
   *  accept or revise (a starting point, not a ruling). "" when search_ready. */
  search_suggestion: z.string().default(""),
  /**
   * 2–4 short reasons, each anchored to the inventor's verbatim, for WHY the
   * deepened statement is the way it is. Carried into the Shared Consciousness so
   * the Verifier (and downstream modules) can check consistency against each one.
   */
  reasons: z.array(z.string()).default([]),
  inventive_gaps: z
    .array(
      z.object({
        missing_element: z.string(),
        why_routine_insufficient: z.string(),
        /** A concrete candidate fill the inventor can adopt, tweak, or replace —
         *  offered separately (NOT baked into deepened_statement). */
        suggestion: z.string().default(""),
      }),
    )
    .default([]),
});
export type DeepenerResult = z.infer<typeof DeepenerOutput>;

export async function runDeepener(
  runAgent: AgentRunner,
  input: { statement: string; verbatim: string[]; consciousness?: string },
): Promise<DeepenerResult> {
  const system = await loadAgentPrompt("deepener");
  const prompt = [
    "THE CONCEPT'S CURRENT STATEMENT:",
    input.statement,
    "",
    "THE INVENTOR'S ORIGINAL WORDS FOR IT (re-grounding — your only permitted source of substance; elaborate these, add nothing):",
    ...input.verbatim.map((v, i) => `[${i + 1}] ${v}`),
    ...(input.consciousness
      ? ["", "WHAT'S ALREADY IN THE SHARED CONSCIOUSNESS (stay consistent with it):", input.consciousness]
      : []),
  ].join("\n");
  return runAgent({
    agent: "deepener",
    system,
    prompt,
    schema: DeepenerOutput,
    temperature: 0.3,
  });
}

export const VerifierOutput = z.object({
  verdict: z.enum(["pass", "fail"]),
  note: z.string().default(""),
  /**
   * Indices (1-based, matching the numbered list shown to the verifier) of the
   * recorded reasons the piece contradicts or drifts from. [] on a clean pass.
   */
  violated_reasons: z.array(z.number()).default([]),
});
export type VerifierResult = z.infer<typeof VerifierOutput>;

export async function runVerifier(
  runAgent: AgentRunner,
  input: {
    piece: string;
    inventorMaterial: string;
    consciousness?: string;
    /** The reasons the creator recorded — the piece must stay consistent with each. */
    reasons?: string[];
  },
): Promise<VerifierResult> {
  const system = await loadAgentPrompt("verifier");
  const prompt = [
    "THE PIECE TO REVIEW (created by another agent):",
    input.piece,
    "",
    "THE INVENTOR'S OWN STATED MATERIAL (the only thing that counts as theirs):",
    input.inventorMaterial,
    ...(input.reasons?.length
      ? [
          "",
          "THE REASONS THE CREATOR RECORDED (the piece must stay consistent with EACH; list any it contradicts in violated_reasons, by number):",
          ...input.reasons.map((r, i) => `[${i + 1}] ${r}`),
        ]
      : []),
    ...(input.consciousness
      ? ["", "THE SHARED CONSCIOUSNESS (must stay consistent with what's settled):", input.consciousness]
      : []),
  ].join("\n");
  return runAgent({ agent: "verifier", system, prompt, schema: VerifierOutput, temperature: 0 });
}
