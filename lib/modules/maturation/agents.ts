import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { withBackpack, type AgentRunner } from "@/lib/modules/shared";
import type { AgentName } from "./types";

/**
 * Module 2 (Maturation) — the Deepener. Module 2 owns the prompt and the I/O
 * contract; the Helper owns the model call via the injected `AgentRunner`.
 */

const MODULE_2_DIR = "module-2-maturation";

const PROMPT_FILES: Record<AgentName, string> = {
  deepener: `${MODULE_2_DIR}/01-deepener.md`,
  verifier: `${MODULE_2_DIR}/02-verifier.md`,
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
  return withBackpack(contents);
}

export const DeepenerOutput = z.object({
  deepened_statement: z.string(),
  search_ready: z.boolean(),
  missing_for_search: z.string().default(""),
  inventive_gaps: z
    .array(
      z.object({
        missing_element: z.string(),
        why_routine_insufficient: z.string(),
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
});
export type VerifierResult = z.infer<typeof VerifierOutput>;

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
