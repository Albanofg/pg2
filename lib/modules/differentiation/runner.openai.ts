import "server-only";
import { generateObject } from "ai";
import { MODELS } from "@/lib/ai/openai";
import type { AgentRunner } from "@/lib/modules/shared";
import type { AgentName } from "./types";

/**
 * OPTIONAL reference AgentRunner for Module 4. The Helper owns the real model
 * transport; this runs the module out of the box and can be swapped or deleted.
 */
const MODEL_FOR: Record<AgentName, (typeof MODELS)[keyof typeof MODELS]> = {
  "gap-framer": MODELS.drafter,
  "differentiation-formalizer": MODELS.drafter,
  "disclosure-compiler": MODELS.drafter,
  "pohc-scorer": MODELS.drafter,
  // Independent cross-check on a DIFFERENT model (Gemini) than the agents it reviews.
  verifier: MODELS.verifier,
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
