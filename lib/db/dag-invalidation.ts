import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { sharedConsciousness } from "@/db/schema";
import { descendantsOf, earliestPhase } from "@/lib/dag";
import { setPhase } from "./shared-consciousness";

/**
 * Disavowal cascade. Given the node a user disavowed, recursively invalidate it
 * and every downstream node: clear their drafts, mark them unverified, and
 * timestamp the invalidation. Returns the affected keys and the phase the
 * Helper should rewind to.
 */
export async function invalidateCascade(projectId: string, startNodeKey: string) {
  const affected = descendantsOf(startNodeKey);

  await db
    .update(sharedConsciousness)
    .set({
      draftOutput: null,
      isVerified: false,
      invalidatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sharedConsciousness.projectId, projectId),
        inArray(sharedConsciousness.nodeKey, affected)
      )
    );

  const rewindPhase = earliestPhase(affected);
  await setPhase(projectId, rewindPhase);

  return { affected, rewindPhase };
}

/**
 * Map a disavowed quote to the node(s) whose draft contains it. A selection may
 * span two nodes; we return every node whose draftOutput includes the quote.
 */
export async function nodesContainingText(
  projectId: string,
  quote: string
): Promise<string[]> {
  const rows = await db
    .select()
    .from(sharedConsciousness)
    .where(eq(sharedConsciousness.projectId, projectId));

  const needle = quote.trim().toLowerCase();
  const hits = rows
    .filter((r) => r.draftOutput?.toLowerCase().includes(needle))
    .map((r) => r.nodeKey);

  return hits;
}
