import "server-only";
import { generateObject } from "ai";
import { MODELS } from "@/lib/ai/openai";
import type { AgentRunner } from "@/lib/modules/shared";
import type { AgentName } from "./types";

/**
 * OPTIONAL reference AgentRunner.
 *
 * Module 1 does NOT own the model transport — the Helper does. This adapter is
 * provided only so the module is runnable out of the box and to show exactly
 * what shape the seam expects. The Helper may pass its own runner instead
 * (e.g. routing to Claude models, adding retries, telemetry, or caching) and
 * this file can be deleted without touching the rest of Module 1.
 *
 * It maps each sub-agent to a model and performs a structured-output call via
 * the AI SDK's generateObject, validating against the schema Module 1 supplied.
 */

const MODEL_FOR: Record<AgentName, (typeof MODELS)[keyof typeof MODELS]> = {
  // The user-facing teaching brain — route to the strong conversational model.
  helper: MODELS.helper,
  distiller: MODELS.drafter,
  clarifier: MODELS.drafter,
  examiner: MODELS.drafter,
  decomposer: MODELS.drafter,
  // The boundary classifier is the inventorship gate; route it to your
  // strongest reasoning model in production.
  "boundary-classifier": MODELS.drafter,
  formalizer: MODELS.drafter,
  "code-generator": MODELS.drafter,
  reviser: MODELS.drafter,
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
