import "server-only";
import { generateObject } from "@/lib/ai/gen";
import { withUsageContext } from "@/lib/ai/usage-context";
import { MODELS } from "@/lib/ai/openai";
import type { AgentRunner } from "@/lib/modules/shared";
import { familyAugmentedSystem } from "@/lib/modules/shared/family-inject";
import type { AgentName } from "./types";

/** OPTIONAL reference AgentRunner for Module 5. Swappable / deletable. */
const MODEL_FOR: Record<AgentName, (typeof MODELS)[keyof typeof MODELS]> = {
  helper: MODELS.drafter,
  "genus-extractor": MODELS.drafter,
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
  "section-polisher": MODELS.drafter,
  // Layer 4: enumerate on the drafter; GRADE on the other model (fresh-context
  // skeptic, per the spec) — the verifier model is the pair's second model.
  "criterion-fragmenter": MODELS.drafter,
  "breadth-assessor": MODELS.drafter,
  "baseline-builder": MODELS.drafter,
  // Verify chains run on the second model of the pair (spec R1).
  "kc-hygiene-verify": MODELS.verifier,
  "constraint-miner": MODELS.drafter,
  "genus-verify": MODELS.verifier,
  "delta-miner": MODELS.drafter,
  "kc-independent": MODELS.drafter,
  "kc-dependent": MODELS.drafter,
  // The exit evaluation is a fresh-context judge — run it on the second model.
  "exit-evaluator": MODELS.verifier,
  "forest-expander": MODELS.drafter,
  enumerator: MODELS.drafter,
  grader: MODELS.verifier,
  formalizer: MODELS.drafter,
};

export const openaiAgentRunner: AgentRunner = async (req) =>
  withUsageContext({ agentCode: `showcase/${req.agent}` }, async () => {
    const system = await familyAugmentedSystem(req.agent, req.system, req.subject ?? req.prompt);
    const { object } = await generateObject({
      model: MODEL_FOR[req.agent as AgentName] ?? MODELS.drafter,
      schema: req.schema,
      system,
      prompt: req.prompt,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    });
    return object;
  });
