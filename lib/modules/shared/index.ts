/**
 * Shared cross-module layer. Pure / client-safe — import freely from client or
 * server. Holds the concept model, the proof ledger, and the agent seam that
 * every module builds on.
 */

export {
  type Provenance,
  type ConceptStatus,
  type ConceptionTrailItem,
  type ConceptProvenancePart,
  type ConceptObject,
  statusLabel,
} from "./concept";

export {
  type Origin,
  type LedgerEntry,
  type AppendOptions,
  EvidenceLedger,
  defaultGenId,
} from "./ledger";

export {
  type ConsciousnessKind,
  type ConsciousnessStatus,
  type ConsciousnessEntry,
  type Verification,
  type RecordOptions,
  type VerifyOptions,
  SharedConsciousness,
} from "./consciousness";

export {
  type BoundaryClassification,
  type BoundaryVerdict,
  type BoundaryClassifier,
  type Screened,
  screen,
  screenAll,
} from "./boundary";

export {
  type Grade,
  type GradeResult,
  applyGrade,
} from "./grading";

export {
  type HelperTurn,
  type HelperQuestion,
  type HelperTeachingPoint,
} from "./helper";

export {
  type BackpackSection,
  INVENTORSHIP_LAW,
  INVENTOR_SUPREMACY,
  OUTPUT_FRAMING,
  DRAFTING_PRINCIPLES,
  CORE,
  SECTIONS,
  V1_PROMPT_SOURCES,
  DISCLOSURE_KNOWLEDGE,
  BACKPACK,
  backpack,
  withBackpack,
} from "./backpack";

export {
  type AgentRunRequest,
  type AgentRunner,
} from "./agent-runner";
