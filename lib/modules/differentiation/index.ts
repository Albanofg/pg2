import "server-only";

/** Module 4 — Differentiation. Server barrel. */
export { DifferentiationModule } from "./controller";
export type { DifferentiationSnapshot } from "./controller";
export {
  loadDifferentiation,
  seedDifferentiation,
  saveDifferentiation,
  clearDifferentiation,
} from "./registry";
export { openaiAgentRunner } from "./runner.openai";
export * from "./agents";
