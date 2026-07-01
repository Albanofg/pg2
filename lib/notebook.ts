import "server-only";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { messages, projects } from "@/db/schema";
import { getVerifiedDraft } from "@/lib/db/shared-consciousness";
import { NODE_ORDER, NODE_GRAPH } from "@/lib/dag";

/**
 * Assemble the Inventor's Notebook: the complete, ordered transcript of the
 * human's inputs plus the verified draft. This exact string is what gets
 * SHA-256 hashed and timestamped, so its construction must be deterministic.
 */
export async function buildNotebook(projectId: string): Promise<{
  content: string;
  title: string;
}> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const chat = await db
    .select()
    .from(messages)
    .where(eq(messages.projectId, projectId))
    .orderBy(asc(messages.createdAt));

  const draftNodes = await getVerifiedDraft(projectId);
  const ordered = [...draftNodes].sort(
    (a, b) => NODE_ORDER.indexOf(a.nodeKey as any) - NODE_ORDER.indexOf(b.nodeKey as any)
  );

  const title = project?.title ?? "Untitled Draft";

  const lines: string[] = [];
  lines.push("# INVENTOR'S NOTEBOOK");
  lines.push(`## ${title}`);
  lines.push("");
  lines.push(
    "This notebook is a complete, ordered record of the inventor's own inputs and the verified Invention Concept Blueprint synthesized exclusively from them. No technical substance herein was introduced by the system."
  );
  lines.push("");
  lines.push("---");
  lines.push("## Transcript of Human Conception");
  for (const m of chat) {
    const who = m.role === "user" ? "INVENTOR" : "HELPER";
    const tag = m.isDisavowal ? " [DISAVOWAL]" : "";
    lines.push(`\n[${m.createdAt.toISOString()}] ${who}${tag}:`);
    lines.push(m.content);
  }
  lines.push("");
  lines.push("---");
  lines.push("## Verified Invention Concept Blueprint");
  for (const n of ordered) {
    lines.push(`\n### ${NODE_GRAPH[n.nodeKey]?.label ?? n.nodeKey}`);
    lines.push(n.draftOutput ?? "");
  }

  return { content: lines.join("\n"), title };
}
