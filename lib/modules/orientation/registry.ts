import "server-only";
import { loadModuleState, saveModuleState } from "@/lib/modules/persistence";
import { OrientationModule, type OrientationSnapshot } from "./controller";
import { openaiAgentRunner } from "./runner.openai";

/**
 * DB-backed orientation sessions. `module_state.orientation` is the source of
 * truth for the snapshot: each request loads the engine from it, runs the op, and
 * saves back. Orientation is the ledger-chain origin (the raw idea is recorded
 * here first), so Conception seeds its ledger from this one.
 */

export async function loadOrientation(projectId: string): Promise<OrientationModule> {
  const state = await loadModuleState(projectId);
  const deps = { runAgent: openaiAgentRunner };
  return state.orientation
    ? OrientationModule.fromSnapshot(state.orientation as OrientationSnapshot, deps)
    : new OrientationModule(deps);
}

export async function saveOrientation(
  projectId: string,
  engine: OrientationModule,
): Promise<void> {
  await saveModuleState(projectId, { orientation: engine.toSnapshot() });
}

export async function resetOrientation(projectId: string): Promise<OrientationModule> {
  const engine = new OrientationModule({ runAgent: openaiAgentRunner });
  await saveOrientation(projectId, engine);
  return engine;
}
