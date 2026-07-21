import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";

/**
 * Durable per-project module state, stored in `projects.module_state` (jsonb).
 *
 * Each module persists a full snapshot under its own key. This is the source of
 * truth for module sessions — engines are loaded from here per request and
 * saved back — so sessions survive server restarts and work across a multi-user,
 * multi-project, multi-instance deployment. Purely additive: it never touches
 * the rest of the project row or any other table.
 *
 * The Shared Consciousness does NOT live here — it is its own append-only table
 * (see consciousness-store.ts), because it is written by many agents at once and
 * a blob rewrite would lose concurrent appends.
 */
export type ModuleStateBlob = {
  orientation?: unknown;
  conception?: unknown;
  maturation?: unknown;
  landscape?: unknown;
  differentiation?: unknown;
  showcase?: unknown;
};

const MAX_CAS_RETRIES = 5;

export async function loadModuleState(projectId: string): Promise<ModuleStateBlob> {
  const rows = await db
    .select({ state: projects.moduleState })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return (rows[0]?.state as ModuleStateBlob | null) ?? {};
}

/**
 * Merge a patch into the project's module state with OPTIMISTIC CONCURRENCY.
 *
 * Reads the current state + version, merges the patch, and writes back only if
 * the version is unchanged (compare-and-swap). If a concurrent writer bumped the
 * version in between, it retries against the now-fresh state — so two writers
 * touching different module keys both land instead of one silently clobbering
 * the other (the multi-tab / multi-instance lost-update bug). Other keys are
 * always preserved by the merge.
 */
export async function saveModuleState(
  projectId: string,
  patch: ModuleStateBlob,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    const rows = await db
      .select({ state: projects.moduleState, version: projects.version })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!rows.length) {
      throw new Error(`saveModuleState: project ${projectId} not found`);
    }
    const current = (rows[0].state as ModuleStateBlob | null) ?? {};
    const version = rows[0].version;
    const merged = { ...current, ...patch };

    const updated = await db
      .update(projects)
      .set({ moduleState: merged, version: version + 1, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.version, version)))
      .returning({ id: projects.id });

    if (updated.length) return; // CAS won
    // Else: a concurrent writer bumped the version — re-read and retry.
  }
  throw new Error(
    `saveModuleState: write contention on project ${projectId}; gave up after ${MAX_CAS_RETRIES} attempts`,
  );
}
