import "server-only";
import { generateObject } from "ai";
import { MODELS } from "@/lib/ai/openai";
import type { AgentRunner } from "@/lib/modules/shared";
import type { AgentName } from "./types";

/** OPTIONAL reference AgentRunner for Module 5. Swappable / deletable. */
const MODEL_FOR: Record<AgentName, (typeof MODELS)[keyof typeof MODELS]> = {
  helper: MODELS.drafter,
  "genus-extractor": MODELS.drafter,
  "species-synthesizer": MODELS.drafter,
  "key-concept-broadener": MODELS.drafter,
  // Independent Boundary guard at the broadening gates, on a different model.
  verifier: MODELS.verifier,
  // The 5c extender second pass.
  "background-extender": MODELS.drafter,
  "summary-extender": MODELS.drafter,
  "detail-description-extender": MODELS.drafter,
  "abstract-rewriter": MODELS.drafter,
  "key-concept-appender": MODELS.drafter,
  "figure-planner": MODELS.drafter,
};

export const openaiAgentRunner: AgentRunner = async (req) => {
  const { object } = await generateObject({
    model: MODEL_FOR[req.agent as AgentName] ?? MODELS.drafter,
    schema: req.schema,
    system: req.system,
    prompt: req.prompt,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
  });
  return object;
};
