import "server-only";
import { generateObject } from "@/lib/ai/gen";
import { withUsageContext } from "@/lib/ai/usage-context";
import { MODELS } from "@/lib/ai/openai";
import type { AgentRunner } from "@/lib/modules/shared";

/**
 * Reference AgentRunner for Module 3. Landscape itself is a search stage (no LLM
 * drafting), so the only agent is the user-facing Helper — always the drafter model.
 */
export const openaiAgentRunner: AgentRunner = async (req) =>
  withUsageContext({ agentCode: `landscape/${req.agent}` }, async () => {
    const { object } = await generateObject({
      model: MODELS.drafter,
      schema: req.schema,
      system: req.system,
      prompt: req.prompt,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    });
    return object;
  });
