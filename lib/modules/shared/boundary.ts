/**
 * The Boundary — the single screen every agent output passes before the inventor
 * sees it.
 *
 * The rule (from the process spec): output that restates or organizes the
 * inventor's own material may SURFACE; output that would be a genuinely new
 * inventive idea is WITHHELD and handed back to the inventor as a request. The
 * Helper never authors the invention — the Boundary is what enforces it
 * structurally, in one place, rather than as instructions scattered across each
 * agent's prompt.
 *
 * This module is the pure contract + the screen logic. The classification itself
 * is an injected `BoundaryClassifier` (an LLM call lives behind it), so the
 * Boundary stays testable and model-agnostic. A withheld piece is never shown;
 * the caller routes it back — typically by recording it as a hidden
 * `open_question` in the Shared Consciousness (for later Socratic steering) or by
 * asking the inventor for it in their own words.
 *
 * Pure — no server-only, no model. Client-safe.
 */

export type BoundaryClassification = "surface" | "withhold";

export type BoundaryVerdict = {
  classification: BoundaryClassification;
  /**
   * When withholding, the NAMED inventive element that is missing — described as
   * a gap, never as a solution (so naming it can't itself leak the invention).
   */
  inventiveElement: string;
  reason: string;
};

/** The classifier behind the Boundary. Decides whether a piece may surface. */
export type BoundaryClassifier = (input: {
  content: string;
  /** The inventor's own stated material — the only thing that counts as theirs. */
  inventorMaterial: string;
}) => Promise<BoundaryVerdict>;

export type Screened =
  | { allowed: true; content: string }
  | { allowed: false; inventiveElement: string; reason: string };

/**
 * Pass one piece of agent output through the Boundary. Restatement/organization
 * of the inventor's material is allowed through; a genuinely-new inventive idea
 * is withheld (the caller routes it back rather than showing it).
 */
export async function screen(
  classify: BoundaryClassifier,
  content: string,
  inventorMaterial: string,
): Promise<Screened> {
  const v = await classify({ content, inventorMaterial });
  if (v.classification === "surface") return { allowed: true, content };
  return { allowed: false, inventiveElement: v.inventiveElement, reason: v.reason };
}

/** Screen many pieces; returns the allowed ones and the withheld ones separately. */
export async function screenAll(
  classify: BoundaryClassifier,
  pieces: string[],
  inventorMaterial: string,
): Promise<{
  surfaced: string[];
  withheld: { inventiveElement: string; reason: string }[];
}> {
  const results = await Promise.all(
    pieces.map((p) => screen(classify, p, inventorMaterial)),
  );
  const surfaced: string[] = [];
  const withheld: { inventiveElement: string; reason: string }[] = [];
  for (const r of results) {
    if (r.allowed) surfaced.push(r.content);
    else withheld.push({ inventiveElement: r.inventiveElement, reason: r.reason });
  }
  return { surfaced, withheld };
}
