import "server-only";
import { generateObject } from "ai";
import { MODELS } from "@/lib/ai/openai";
import type { AgentRunner } from "@/lib/modules/shared";
import type { AgentName } from "./types";

/**
 * Reference AgentRunner for Module 0. Bulk stub generation runs on the CHEAP model
 * (gpt-5.4-mini) — it is the ~1000x call and only instantiates skeletal stubs. The
 * scorer, derivation tracer, and the inventorship-critical reversal compiler run on
 * the stronger model.
 */
const MODEL_FOR: Record<AgentName, (typeof MODELS)[keyof typeof MODELS]> = {
  "stub-generator": MODELS.distiller, // gpt-5.4-mini — cheap, bulk
  "idea-scorer": MODELS.drafter,
  "derivation-tracer": MODELS.drafter,
  "reversal-compiler": MODELS.drafter,
  // The market read is the trust-critical, knowledge-heavy step — strong model.
  "market-analyst": MODELS.drafter,
  // The first-sixty-seconds excavation — the delight + §101 reasoning. Strong model.
  excavator: MODELS.drafter,
  // The §101 eligibility gate + constraint-injector — legal-reasoning-heavy. Strong model.
  "section-101": MODELS.drafter,
};

export const brainstormRunner: AgentRunner = async (req) => {
  const { object } = await generateObject({
    model: MODEL_FOR[req.agent as AgentName] ?? MODELS.drafter,
    schema: req.schema,
    system: req.system,
    prompt: req.prompt,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
  });
  return object;
};
