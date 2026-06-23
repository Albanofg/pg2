import "server-only";
import { EvidenceLedger } from "@/lib/modules/shared";
import type { ConceptObject, LedgerEntry } from "@/lib/modules/shared";
import { loadModuleState, saveModuleState } from "@/lib/modules/persistence";
import { LandscapeModule, type LandscapeSnapshot } from "./controller";
import { LANDSCAPE_HUMAN_SOURCE_TYPES } from "./types";
import { n8nPriorArtSearch } from "./search.n8n";

/**
 * DB-backed landscape sessions. `module_state.landscape` on the project row is
 * the source of truth (load → run → save per request). Durable across restarts;
 * correct for multi-user / multi-project / multi-instance.
 */
const search = n8nPriorArtSearch;

/** Load the project's landscape engine, or null if it has no saved state. */
export async function loadLandscape(
  projectId: string,
): Promise<LandscapeModule | null> {
  const state = await loadModuleState(projectId);
  if (!state.landscape) return null;
  return LandscapeModule.fromSnapshot(state.landscape as LandscapeSnapshot, {
    concepts: [],
    context: "",
    search,
  });
}

/**
 * Create a fresh landscape engine seeded with the carried-forward ideas and the
 * expanded description (context), threading the prior ledger entries in so the
 * inventor's notebook is one continuous trail across modules.
 */
export function seedLandscape(
  concepts: ConceptObject[],
  context: string,
  priorLedger: LedgerEntry[],
): LandscapeModule {
  const ledger = EvidenceLedger.fromEntries(
    priorLedger,
    LANDSCAPE_HUMAN_SOURCE_TYPES,
  );
  return new LandscapeModule({ concepts, context, search, ledger });
}

export async function saveLandscape(
  projectId: string,
  engine: LandscapeModule,
): Promise<void> {
  await saveModuleState(projectId, { landscape: engine.toSnapshot() });
}

export async function clearLandscape(projectId: string): Promise<void> {
  await saveModuleState(projectId, { landscape: null });
}
