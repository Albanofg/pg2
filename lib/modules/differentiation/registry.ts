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
import { DifferentiationModule, type DifferentiationSnapshot } from "./controller";
import { DIFFERENTIATION_HUMAN_SOURCE_TYPES } from "./types";
import type { ConceptLandscape } from "./types";
import { openaiAgentRunner } from "./runner.openai";
import { refreshFamilyArtifactsBackground } from "@/lib/families/digest";

/**
 * DB-backed differentiation sessions. `module_state.differentiation` is the
 * source of truth for the module snapshot (load → run → save, optimistic
 * concurrency). The Shared Consciousness is persisted in its own append-only
 * table (continuous with the prior modules).
 */

/** Load the project's differentiation engine, or null if it has no saved state. */
export async function loadDifferentiation(
  projectId: string,
): Promise<DifferentiationModule | null> {
  const [state, consciousness] = await Promise.all([
    loadModuleState(projectId),
    loadConsciousness(projectId),
  ]);
  if (!state.differentiation) return null;
  return DifferentiationModule.fromSnapshot(
    state.differentiation as DifferentiationSnapshot,
    { runAgent: openaiAgentRunner, consciousness, concepts: [], landscape: [] },
  );
}

/**
 * Create a fresh differentiation engine seeded with the carried Concepts (from
 * Maturation) + their prior-art landscape (from Module 3), threading the prior
 * ledger and the shared draft memory so both trails are continuous.
 */
export function seedDifferentiation(
  concepts: ConceptObject[],
  landscape: ConceptLandscape[],
  priorLedger: LedgerEntry[],
  consciousness?: SharedConsciousness,
  representativeCode?: { language: string; code: string } | null,
): DifferentiationModule {
  const ledger = EvidenceLedger.fromEntries(
    priorLedger,
    DIFFERENTIATION_HUMAN_SOURCE_TYPES,
  );
  return new DifferentiationModule({
    runAgent: openaiAgentRunner,
    concepts,
    landscape,
    ledger,
    ...(consciousness ? { consciousness } : {}),
    ...(representativeCode ? { representativeCode } : {}),
  });
}

export async function saveDifferentiation(
  projectId: string,
  engine: DifferentiationModule,
): Promise<void> {
  await saveModuleState(projectId, { differentiation: engine.toSnapshot() });
  await persistConsciousness(projectId, engine.consciousnessInstance());
  refreshFamilyArtifactsBackground(projectId, "differentiation");
}

export async function clearDifferentiation(projectId: string): Promise<void> {
  await saveModuleState(projectId, { differentiation: null });
  refreshFamilyArtifactsBackground(projectId, "differentiation");
}
