import "server-only";
import { EvidenceLedger } from "@/lib/modules/shared";
import type {
  ConceptObject,
  LedgerEntry,
  SharedConsciousness,
} from "@/lib/modules/shared";
import { loadModuleState, saveModuleState } from "@/lib/modules/persistence";
import {
  loadConsciousness,
  persistConsciousness,
} from "@/lib/modules/shared/consciousness-store";
import { MaturationModule, type MaturationSnapshot } from "./controller";
import { MATURATION_HUMAN_SOURCE_TYPES } from "./types";
import { openaiAgentRunner } from "./runner.openai";

/**
 * DB-backed maturation sessions. `module_state.maturation` on the project row is
 * the source of truth for the module snapshot (load → run → save per request,
 * with optimistic concurrency) — durable across restarts and correct for
 * multi-user / multi-project / multi-instance.
 *
 * The Shared Consciousness is persisted in its own append-only table
 * (consciousness-store.ts), continuous with Conception — loaded per project,
 * threaded into the engine, and persisted as a diff.
 */

/** Load the project's maturation engine, or null if it has no saved state. */
export async function loadMaturation(
  projectId: string,
): Promise<MaturationModule | null> {
  const [state, consciousness] = await Promise.all([
    loadModuleState(projectId),
    loadConsciousness(projectId),
  ]);
  if (!state.maturation) return null;
  return MaturationModule.fromSnapshot(state.maturation as MaturationSnapshot, {
    runAgent: openaiAgentRunner,
    consciousness,
    concepts: [],
  });
}

/**
 * Create a fresh maturation engine seeded with the concepts handed off from
 * Conception, threading the conception ledger entries AND the shared draft
 * memory in so both the inventor's notebook and the draft memory are one
 * continuous trail across both modules.
 */
export function seedMaturation(
  concepts: ConceptObject[],
  conceptionLedger: LedgerEntry[],
  consciousness?: SharedConsciousness,
): MaturationModule {
  const ledger = EvidenceLedger.fromEntries(
    conceptionLedger,
    MATURATION_HUMAN_SOURCE_TYPES,
  );
  return new MaturationModule({
    runAgent: openaiAgentRunner,
    concepts,
    ledger,
    ...(consciousness ? { consciousness } : {}),
  });
}

export async function saveMaturation(
  projectId: string,
  engine: MaturationModule,
): Promise<void> {
  await saveModuleState(projectId, { maturation: engine.toSnapshot() });
  await persistConsciousness(projectId, engine.consciousnessInstance());
}

/** Clear the project's maturation session (used by reset). */
export async function clearMaturation(projectId: string): Promise<void> {
  await saveModuleState(projectId, { maturation: null });
}
