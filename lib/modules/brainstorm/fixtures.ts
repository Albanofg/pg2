import type { Backpack } from "./types";

/**
 * Test fixtures for exercising the engine without the front-of-house. The route's
 * GET runs the whole pipeline on these so you can see the frontier + Socratic walks.
 */

export const sampleBackpack: Backpack = {
  background:
    "Solo founder with a backend engineering background; ships TypeScript web apps.",
  domainFamiliarity:
    "Comfortable with databases, caching, indexes, and APIs; not an ML researcher.",
};

export const sampleProblem =
  "Generating and ranking a large, genuinely diverse set of software-invention " +
  "ideas cheaply, without the model collapsing into near-duplicates.";
