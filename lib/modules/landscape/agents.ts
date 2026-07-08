import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { withBackpack, type AgentRunner } from "@/lib/modules/shared";
import {
  buildHelperPrompt,
  HelperOutput,
  type HelperResult,
} from "@/lib/modules/shared/helper-agent";
import { resolveFamilyBlock } from "@/lib/families/helper-context";

/**
 * Module 3 (Landscape) has no drafting agents — it searches real prior art. Its
 * only agent is the user-facing Helper, so the inventor can ask questions during
 * the search stage and get a real answer, not a filed note.
 */
const HELPER_PROMPT = "module-3-landscape/00-helper.md";
let cached: string | undefined;

async function loadHelperPrompt(): Promise<string> {
  if (!cached) {
    const file = path.join(process.cwd(), "prompts", ...HELPER_PROMPT.split("/"));
    cached = (await readFile(file, "utf8")).trim();
  }
  return withBackpack(cached, ["helper_doctrine"]);
}

export async function runHelper(
  runAgent: AgentRunner,
  input: {
    message: string;
    context: string;
    inventorMaterial: string;
    conversation: { role: string; text: string }[];
  },
): Promise<HelperResult> {
  const system = await loadHelperPrompt();
  const familyContext = (await resolveFamilyBlock(input.message)) ?? undefined;
  const prompt = buildHelperPrompt({
    message: input.message,
    where:
      "Module 3 (Landscape) — searching real patents and publications for the prior art closest to each carried-forward concept",
    context: input.context,
    inventorMaterial: input.inventorMaterial,
    conversation: input.conversation,
    ...(familyContext ? { familyContext } : {}),
  });
  return runAgent({ agent: "helper", system, prompt, schema: HelperOutput, temperature: 0.4 });
}
