import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { sharedConsciousness, projects } from "@/db/schema";
import { NODE_GRAPH } from "@/lib/dag";

/** Ensure every DAG node row exists for a project (idempotent). */
export async function ensureNodes(projectId: string) {
  const existing = await db
    .select({ nodeKey: sharedConsciousness.nodeKey })
    .from(sharedConsciousness)
    .where(eq(sharedConsciousness.projectId, projectId));
  const have = new Set(existing.map((r) => r.nodeKey));

  const toInsert = Object.entries(NODE_GRAPH)
    .filter(([key]) => !have.has(key))
    .map(([key, def]) => ({
      projectId,
      nodeKey: key,
      parents: def.parents,
      humanInputs: [] as string[],
    }));

  if (toInsert.length > 0) {
    await db.insert(sharedConsciousness).values(toInsert);
  }
}

export async function getNodes(projectId: string) {
  return db
    .select()
    .from(sharedConsciousness)
    .where(eq(sharedConsciousness.projectId, projectId));
}

export async function getNode(projectId: string, nodeKey: string) {
  const rows = await db
    .select()
    .from(sharedConsciousness)
    .where(
      and(
        eq(sharedConsciousness.projectId, projectId),
        eq(sharedConsciousness.nodeKey, nodeKey)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Append an exact human quote to a node's inputs (the only source of truth). */
export async function recordHumanInput(
  projectId: string,
  nodeKey: string,
  input: string
) {
  const node = await getNode(projectId, nodeKey);
  const inputs = [...(node?.humanInputs ?? []), input];
  if (node) {
    await db
      .update(sharedConsciousness)
      .set({ humanInputs: inputs, invalidatedAt: null, updatedAt: new Date() })
      .where(eq(sharedConsciousness.id, node.id));
  } else {
    await db.insert(sharedConsciousness).values({
      projectId,
      nodeKey,
      parents: NODE_GRAPH[nodeKey]?.parents ?? [],
      humanInputs: inputs,
    });
  }
  return inputs;
}

/** Persist a verified (or in-progress) draft for a node. */
export async function saveDraft(
  projectId: string,
  nodeKey: string,
  draftOutput: string,
  isVerified: boolean
) {
  await db
    .update(sharedConsciousness)
    .set({
      draftOutput,
      isVerified,
      invalidatedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sharedConsciousness.projectId, projectId),
        eq(sharedConsciousness.nodeKey, nodeKey)
      )
    );
}

/** All human inputs across the project — the corpus the Drafter may synthesize. */
export async function collectHumanInputs(projectId: string) {
  const nodes = await getNodes(projectId);
  const byNode: Record<string, string[]> = {};
  for (const n of nodes) {
    byNode[n.nodeKey] = n.humanInputs ?? [];
  }
  return byNode;
}

export async function setPhase(projectId: string, phase: string) {
  await db
    .update(projects)
    .set({ currentPhase: phase, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

/** Verified, non-invalidated nodes in document order — the sealed draft body. */
export async function getVerifiedDraft(projectId: string) {
  const nodes = await db
    .select()
    .from(sharedConsciousness)
    .where(
      and(
        eq(sharedConsciousness.projectId, projectId),
        isNull(sharedConsciousness.invalidatedAt)
      )
    );
  return nodes.filter((n) => n.isVerified && n.draftOutput);
}
