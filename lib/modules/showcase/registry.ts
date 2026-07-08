import "server-only";
import { EvidenceLedger } from "@/lib/modules/shared";
import type { LedgerEntry, SharedConsciousness } from "@/lib/modules/shared";
import { loadModuleState, saveModuleState } from "@/lib/modules/persistence";
import {
  loadConsciousness,
  persistConsciousness,
} from "@/lib/modules/shared/consciousness-store";
import { ShowcaseModule, type ShowcaseSnapshot } from "./controller";
import { SHOWCASE_HUMAN_SOURCE_TYPES } from "./types";
import type { DisclosureSection, ShowcaseKeyConcept } from "./types";
import { openaiAgentRunner } from "./runner.openai";
import { refreshFamilyArtifactsBackground } from "@/lib/families/digest";

/**
 * DB-backed showcase sessions. `module_state.showcase` is the source of truth for
 * the module snapshot (load → run → save, optimistic concurrency). The Shared
 * Consciousness is persisted in its own append-only table.
 */

export async function loadShowcase(projectId: string): Promise<ShowcaseModule | null> {
  const [state, consciousness] = await Promise.all([
    loadModuleState(projectId),
    loadConsciousness(projectId),
  ]);
  if (!state.showcase) return null;
  return ShowcaseModule.fromSnapshot(state.showcase as ShowcaseSnapshot, {
    runAgent: openaiAgentRunner,
    consciousness,
    keyConcepts: [],
  });
}

/** Create a fresh showcase engine seeded with the certified Key Concepts +
 *  the compiled disclosure from Module 4, threading the prior ledger + SC. */
export function seedShowcase(
  keyConcepts: ShowcaseKeyConcept[],
  disclosure: DisclosureSection[],
  priorLedger: LedgerEntry[],
  consciousness?: SharedConsciousness,
): ShowcaseModule {
  const ledger = EvidenceLedger.fromEntries(priorLedger, SHOWCASE_HUMAN_SOURCE_TYPES);
  return new ShowcaseModule({
    runAgent: openaiAgentRunner,
    keyConcepts,
    disclosure,
    ledger,
    ...(consciousness ? { consciousness } : {}),
  });
}

export async function saveShowcase(projectId: string, engine: ShowcaseModule): Promise<void> {
  await saveModuleState(projectId, { showcase: engine.toSnapshot() });
  await persistConsciousness(projectId, engine.consciousnessInstance());
  refreshFamilyArtifactsBackground(projectId, "showcase");
}

export async function clearShowcase(projectId: string): Promise<void> {
  await saveModuleState(projectId, { showcase: null });
  refreshFamilyArtifactsBackground(projectId, "showcase");
}
