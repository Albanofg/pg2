/**
 * Module 2 — Maturation. Server-side entry point. Import from server code only
 * (pulls `server-only`). Client components import contracts from
 * "@/lib/modules/maturation/types".
 */

export { MaturationModule, type MaturationSnapshot } from "./controller";
export { EvidenceLedger } from "@/lib/modules/shared";
export {
  loadAgentPrompt,
  runDeepener,
  DeepenerOutput,
  type DeepenerResult,
} from "./agents";
export {
  loadMaturation,
  saveMaturation,
  seedMaturation,
  clearMaturation,
} from "./registry";
export { openaiAgentRunner } from "./runner.openai";
export * from "./types";
