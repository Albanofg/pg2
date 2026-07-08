import "server-only";
import { generateObject } from "@/lib/ai/gen";
import { withUsageContext } from "@/lib/ai/usage-context";
import { z } from "zod";
import { MODELS } from "./openai";
import { INVENTORSHIP_LAW, PHASE_GUIDE } from "./backpack";

/**
 * The Drafter synthesizes a patent section from ONLY the human's inputs. If it
 * cannot complete the section without inventing, it returns a GapDetected object
 * instead of bridging the gap itself.
 */
const DrafterOutput = z.object({
  status: z.enum(["drafted", "gap_detected"]),
  // When drafted: the section prose. When gap: empty.
  draft: z.string().default(""),
  // When gap_detected: a one-line description of the missing technical detail.
  gap: z.string().default(""),
});

export type DrafterResult = z.infer<typeof DrafterOutput>;

export async function runDrafter(opts: {
  nodeKey: string;
  phase: string;
  humanInputs: string[];
  priorSections?: string;
}): Promise<DrafterResult> {
  const { nodeKey, phase, humanInputs, priorSections } = opts;

  if (humanInputs.length === 0) {
    return { status: "gap_detected", draft: "", gap: `No inventor input yet for ${nodeKey}.` };
  }

  const { object } = await withUsageContext({ agentCode: "mesh/drafter" }, () =>
    generateObject({
      model: MODELS.drafter,
      schema: DrafterOutput,
    system: [
      "You are the Drafter agent in a patent-drafting mesh.",
      INVENTORSHIP_LAW,
      PHASE_GUIDE[phase] ?? PHASE_GUIDE.core_novelty,
      "Write in formal provisional-patent prose. Synthesize ONLY from the inventor's exact inputs below. If a section cannot be completed without introducing technical substance the inventor did not state, set status to 'gap_detected' and describe the single missing detail in `gap`. Otherwise set status 'drafted' and put the section in `draft'.",
    ].join("\n\n"),
    prompt: [
      `SECTION TO DRAFT: ${nodeKey}`,
      priorSections ? `ALREADY-VERIFIED SECTIONS (for continuity only):\n${priorSections}` : "",
      "INVENTOR'S EXACT INPUTS (your only permitted source of technical substance):",
      ...humanInputs.map((h, i) => `[${i + 1}] ${h}`),
    ]
      .filter(Boolean)
      .join("\n\n"),
    temperature: 0.2,
    }),
  );

  return object;
}
