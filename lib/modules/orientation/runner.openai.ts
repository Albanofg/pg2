import "server-only";
import { generateObject } from "@/lib/ai/gen";
import { withUsageContext } from "@/lib/ai/usage-context";
import { MODELS } from "@/lib/ai/openai";
import type { AgentRunner } from "@/lib/modules/shared";
import type { AgentName } from "./types";

/**
 * Reference AgentRunner for Module 0 (Orientation). Maps each sub-agent to a
 * model and performs a structured-output call, validating against the schema the
 * module supplied. No family injection here — orientation runs before any
 * per-project family context exists.
 */

const MODEL_FOR: Record<AgentName, (typeof MODELS)[keyof typeof MODELS]> = {
  // The Socratic conversational brain.
  helper: MODELS.helper,
  // Assembles the brief strictly from the inventor's material — a drafting task.
  "brief-writer": MODELS.drafter,
  // The forward-vs-discovery classifier — a fast, deterministic judgment.
  router: MODELS.drafter,
  // Reads the whole conversation into the structured session + maturity — a
  // careful extraction; route to the strong drafter.
  structurer: MODELS.drafter,
};

export const openaiAgentRunner: AgentRunner = async (req) =>
  withUsageContext({ agentCode: `orientation/${req.agent}` }, async () => {
    const { object } = await generateObject({
      model: MODEL_FOR[req.agent as AgentName] ?? MODELS.drafter,
      schema: req.schema,
      system: req.system,
      prompt: req.prompt,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    });
    return object;
  });
