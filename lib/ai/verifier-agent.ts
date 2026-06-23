import "server-only";
import { generateText } from "ai";
import { MODELS } from "./openai";
import { VERIFIER_LAW } from "./backpack";

export type VerifierVerdict = {
  approved: boolean;
  reason: string;
};

/**
 * The Verifier cross-checks the Drafter's output against the human inputs using
 * a deeper reasoning model (o1-preview). It approves only if the draft contains
 * no technical substance absent from the inputs.
 *
 * o1 models accept neither a system role nor temperature, so the full
 * instruction is folded into a single prompt and the verdict is parsed from a
 * strict first-line contract.
 */
export async function runVerifier(opts: {
  draft: string;
  humanInputs: string[];
}): Promise<VerifierVerdict> {
  const { draft, humanInputs } = opts;

  const prompt = [
    VERIFIER_LAW,
    "",
    "HUMAN INPUTS (the ONLY permitted source of technical substance):",
    ...humanInputs.map((h, i) => `[${i + 1}] ${h}`),
    "",
    "DRAFTER OUTPUT TO AUDIT:",
    draft,
    "",
    "Decide. Respond with EXACTLY one line:",
    "  APPROVE",
    "or",
    "  REJECT: <the specific invented substance the Drafter introduced>",
  ].join("\n");

  const { text } = await generateText({
    model: MODELS.verifier,
    prompt,
  });

  const firstLine = text.trim().split("\n")[0]?.trim() ?? "";
  if (/^approve/i.test(firstLine)) {
    return { approved: true, reason: "" };
  }
  return {
    approved: false,
    reason: firstLine.replace(/^reject:?\s*/i, "").trim() || "Unverified.",
  };
}
