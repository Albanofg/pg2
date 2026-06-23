/**
 * Module 1 — Conception. Server-side entry point.
 *
 * Import this from server code (route handlers, server actions) where the
 * Helper calls sub-agents. It pulls in `server-only` modules, so it must NOT be
 * imported from client components.
 *
 * Client components that only need to render cards should import the shared
 * contracts directly from "@/lib/modules/conception/types".
 */

export { ConceptionModule } from "./controller";
export { EvidenceLedger } from "@/lib/modules/shared";
export {
  loadAgentPrompt,
  runDistiller,
  runClarifier,
  runExaminer,
  runDecomposer,
  runBoundaryClassifier,
  runFormalizer,
  runCodeGenerator,
  DistillerOutput,
  ClarifierOutput,
  ExaminerOutput,
  DecomposerOutput,
  BoundaryOutput,
  FormalizerOutput,
  CodeGeneratorOutput,
  type DistillerResult,
  type ClarifierResult,
  type ExaminerResult,
  type DecomposerResult,
  type BoundaryResult,
  type FormalizerResult,
  type CodeGeneratorResult,
} from "./agents";
export { openaiAgentRunner } from "./runner.openai";
export * from "./types";
