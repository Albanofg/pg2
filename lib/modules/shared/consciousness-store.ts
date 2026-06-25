import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { consciousnessEntries } from "@/db/schema";
import { SharedConsciousness, type ConsciousnessEntry } from "./consciousness";

/**
 * DB-backed persistence for the Shared Consciousness — an APPEND-ONLY table, one
 * row per entry. This is what makes it safe under real concurrency: appends are
 * conflict-free INSERTs (two agents/requests writing at once both survive, where
 * a whole-blob rewrite would have lost one). Status changes are row-scoped
 * UPDATEs. The in-memory `SharedConsciousness` keeps all the logic; this module
 * only moves rows in and out.
 *
 * Note: the neon-http driver has no multi-statement transactions, so a persist
 * is a batched INSERT for new rows followed by per-row UPDATEs for changed ones.
 * Each statement is atomic; the inserts (the high-frequency, conflict-prone path)
 * are a single atomic statement.
 */

type Row = typeof consciousnessEntries.$inferSelect;

function rowToEntry(r: Row): ConsciousnessEntry {
  return {
    id: r.id,
    part: r.part,
    kind: r.kind as ConsciousnessEntry["kind"],
    content: r.content,
    why: r.why ?? "",
    ...(r.reasons?.length ? { reasons: r.reasons } : {}),
    agent: r.agent,
    createdAt: r.createdAt,
    derivedFrom: r.derivedFrom ?? [],
    ...(r.tracesTo ? { tracesTo: r.tracesTo } : {}),
    status: r.status as ConsciousnessEntry["status"],
    ...(r.supersedes ? { supersedes: r.supersedes } : {}),
    ...(r.supersededBy ? { supersededBy: r.supersededBy } : {}),
    ...(r.stale != null ? { stale: r.stale } : {}),
    ...(r.verification ? { verification: r.verification } : {}),
    tags: r.tags ?? [],
  };
}

function entryToInsert(projectId: string, e: ConsciousnessEntry) {
  return {
    id: e.id,
    projectId,
    part: e.part,
    kind: e.kind,
    content: e.content,
    why: e.why,
    reasons: e.reasons ?? null,
    agent: e.agent,
    createdAt: e.createdAt,
    derivedFrom: e.derivedFrom,
    tracesTo: e.tracesTo ?? null,
    tags: e.tags,
    status: e.status,
    supersedes: e.supersedes ?? null,
    supersededBy: e.supersededBy ?? null,
    stale: e.stale ?? null,
    verification: e.verification ?? null,
  };
}

/** Load the project's Shared Consciousness from the table (fresh if empty). */
export async function loadConsciousness(
  projectId: string,
): Promise<SharedConsciousness> {
  const rows = await db
    .select()
    .from(consciousnessEntries)
    .where(eq(consciousnessEntries.projectId, projectId))
    .orderBy(asc(consciousnessEntries.seq));
  return SharedConsciousness.fromEntries(rows.map(rowToEntry));
}

/**
 * Persist the diff since load: INSERT new entries (conflict-free), UPDATE the
 * mutable fields of any entry whose status/flags changed. Then mark the store
 * persisted so the next save only diffs what changed after this one.
 */
export async function persistConsciousness(
  projectId: string,
  sc: SharedConsciousness,
): Promise<void> {
  const inserts = sc.pendingInserts();
  const updates = sc.dirtyUpdates();

  if (inserts.length) {
    await db
      .insert(consciousnessEntries)
      .values(inserts.map((e) => entryToInsert(projectId, e)));
  }

  for (const e of updates) {
    await db
      .update(consciousnessEntries)
      .set({
        status: e.status,
        supersededBy: e.supersededBy ?? null,
        stale: e.stale ?? null,
        verification: e.verification ?? null,
      })
      .where(eq(consciousnessEntries.id, e.id));
  }

  sc.markPersisted();
}
