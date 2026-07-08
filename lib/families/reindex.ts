import "server-only";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { projects, projectFamilyContextFiles } from "@/db/schema";
import { withUsageContext } from "@/lib/ai/usage-context";
import { refreshFamilyArtifacts } from "./digest";
import { indexFileChunks } from "./context-files";

/**
 * One-off backfill: embed everything that was written before semantic retrieval
 * existed (or before the pgvector DDL landed). Recomputes each family project's
 * digest (which now embeds) and re-chunks + embeds every extracted reference
 * document. Idempotent and best-effort — safe to run repeatedly. Sequential to keep
 * embedding load gentle. Wrap each unit in a usage context so the tokens attribute.
 */
export async function reindexFamilyEmbeddings(): Promise<{ projects: number; files: number }> {
  const famProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(isNotNull(projects.familyId));
  for (const p of famProjects) {
    await withUsageContext({ projectId: p.id, stage: "reindex", agentCode: "families/embed" }, () =>
      refreshFamilyArtifacts(p.id, "all"),
    );
  }

  const files = await db
    .select({
      id: projectFamilyContextFiles.id,
      familyId: projectFamilyContextFiles.familyId,
      filename: projectFamilyContextFiles.filename,
      extractedText: projectFamilyContextFiles.extractedText,
    })
    .from(projectFamilyContextFiles)
    .where(
      and(
        eq(projectFamilyContextFiles.extractionStatus, "ok"),
        isNull(projectFamilyContextFiles.deletedAt),
      ),
    );
  let fileCount = 0;
  for (const f of files) {
    if (!f.extractedText || !f.familyId) continue;
    await withUsageContext(
      { projectId: undefined, stage: "reindex", agentCode: "families/embed" },
      () => indexFileChunks(f.id, f.familyId as string, f.filename, f.extractedText as string),
    );
    fileCount++;
  }

  return { projects: famProjects.length, files: fileCount };
}
