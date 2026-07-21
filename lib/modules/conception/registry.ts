import "server-only";
import { loadModuleState, saveModuleState } from "@/lib/modules/persistence";
import {
  loadConsciousness,
  persistConsciousness,
} from "@/lib/modules/shared/consciousness-store";
import { EvidenceLedger, type LedgerEntry } from "@/lib/modules/shared";
import { ConceptionModule, type ConceptionSnapshot } from "./controller";
import { MODULE1_HUMAN_SOURCE_TYPES } from "./types";
import { openaiAgentRunner } from "./runner.openai";
import { refreshFamilyArtifactsBackground } from "@/lib/families/digest";

/**
 * DB-backed conception sessions. The project row's `module_state.conception`
 * jsonb is the source of truth for the module snapshot: each request loads the
 * engine from it, runs the op, and saves the snapshot back (with optimistic
 * concurrency). State is keyed by the project, never held in process memory.
 *
 * The Shared Consciousness is persisted SEPARATELY in its own append-only table
 * (consciousness-store.ts) so concurrent agent writes don't clobber each other.
 * It is loaded per project, threaded into the engine, and persisted as a diff.
 */

/** Load the project's conception engine (a fresh one if it has no saved state). */
export async function loadConception(projectId: string): Promise<ConceptionModule> {
  const [state, consciousness] = await Promise.all([
    loadModuleState(projectId),
    loadConsciousness(projectId),
  ]);
  if (state.conception) {
    return ConceptionModule.fromSnapshot(state.conception as ConceptionSnapshot, {
      runAgent: openaiAgentRunner,
      consciousness,
    });
  }
  // Fresh Conception: seed the ledger from Orientation (Module 0) if it ran, so
  // the inventor's raw idea + orientation trail are the CONTINUOUS origin of the
  // proof chain rather than being dropped.
  const orient = state.orientation as { ledger?: LedgerEntry[] } | undefined;
  const seedLedger = orient?.ledger?.length
    ? EvidenceLedger.fromEntries(orient.ledger, MODULE1_HUMAN_SOURCE_TYPES)
    : undefined;
  return new ConceptionModule({
    runAgent: openaiAgentRunner,
    consciousness,
    ...(seedLedger ? { ledger: seedLedger } : {}),
  });
}

/** Persist the project's conception snapshot + the shared draft-memory diff. */
export async function saveConception(
  projectId: string,
  engine: ConceptionModule,
): Promise<void> {
  await saveModuleState(projectId, { conception: engine.toSnapshot() });
  await persistConsciousness(projectId, engine.consciousnessInstance());
  refreshFamilyArtifactsBackground(projectId, "conception");
}

/** Start the conception session over — the shared draft memory is untouched. */
export async function resetConception(projectId: string): Promise<ConceptionModule> {
  const consciousness = await loadConsciousness(projectId);
  const engine = new ConceptionModule({
    runAgent: openaiAgentRunner,
    consciousness,
  });
  await saveConception(projectId, engine);
  return engine;
}
