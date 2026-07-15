/**
 * Module 5 (Showcase) tunables — plain constants, no env, no magic numbers in the
 * prompts. Layer 4 caps live here per the redesign: the prompts never carry a
 * target count; the safety cap and emergent survivor target are config, applied by
 * the controller. The three standard build-styles are always present on top of the
 * emergent set, so these numbers size only the EMERGENT extras.
 */
export const SHOWCASE_CONFIG = {
  layer4: {
    /**
     * How many EMERGENT trees to surface beyond the three mandatory build-styles,
     * sized to the breadth of the invention (the "forest"). The three standard ways
     * (AI-assisted / AI-native / agentic) are ALWAYS present on top of this; the
     * emergent set scales here — a narrow genus gets a few extras, a broad one many.
     * A floor of at least one emergent survivor is enforced in the controller, so
     * the inventor always lands on the three standard ways PLUS at least one more.
     */
    targetByBreadth: { narrow: 2, moderate: 4, broad: 7 },
    /** Hard safety cap on candidates the enumerator returns, before grading. */
    generationCap: 24,
  },
} as const;
