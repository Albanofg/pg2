import "server-only";
import { generateObject } from "@/lib/ai/gen";
import { withUsageContext } from "@/lib/ai/usage-context";
import { MODELS } from "@/lib/ai/openai";
import type { AgentRunner } from "@/lib/modules/shared";
import type { AgentName } from "./types";

/**
 * OPTIONAL reference AgentRunner for Module 2. The Helper owns the real model
 * transport; this is provided so the module runs out of the box and can be
 * swapped or deleted.
 */
const MODEL_FOR: Record<AgentName, (typeof MODELS)[keyof typeof MODELS]> = {
  deepener: MODELS.drafter,
  // Independent cross-check on a DIFFERENT model (Gemini) than the agents it reviews.
  verifier: MODELS.verifier,
  helper: MODELS.drafter,
};

export const openaiAgentRunner: AgentRunner = async (req) =>
  withUsageContext({ agentCode: `maturation/${req.agent}` }, async () => {
    const { object } = await generateObject({
      model: MODEL_FOR[req.agent as AgentName] ?? MODELS.drafter,
      schema: req.schema,
      system: req.system,
      prompt: req.prompt,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    });
    return object;
  });
