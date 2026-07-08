import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { projects, projectFamilyArtifacts, projectFamilyContextFileChunks } from "@/db/schema";
import { toVectorLiteral } from "@/lib/ai/embed";
import { digestHash, type ArtifactKind } from "./digest";

/**
 * Read side of the digest cache — pure indexed SQL, zero AI, no live re-read of
 * other projects. Powers the sibling-reference panel, the Helper's family context,
 * and the overlap check.
 */

export type SiblingReference = {
  siblingId: string;
  title: string;
  stage: string;
  ideaSummary: string | null;
  extractedIdeas: string[];
  keyConcepts: string[];
};

/** Every OTHER project in the same family + its cached digests, shaped per sibling. */
export async function getSiblingsReference(projectId: string): Promise<SiblingReference[]> {
  const [self] = await db
    .select({ familyId: projects.familyId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const familyId = self?.familyId ?? null;
  if (!familyId) return [];

  const sibs = await db
    .select({ id: projects.id, title: projects.title, currentPhase: projects.currentPhase })
    .from(projects)
    .where(and(eq(projects.familyId, familyId), ne(projects.id, projectId)));
  if (!sibs.length) return [];

  const arts = await db
    .select({
      projectId: projectFamilyArtifacts.projectId,
      artifactKind: projectFamilyArtifacts.artifactKind,
      preview: projectFamilyArtifacts.preview,
    })
    .from(projectFamilyArtifacts)
    .where(
      and(
        eq(projectFamilyArtifacts.familyId, familyId),
        inArray(
          projectFamilyArtifacts.projectId,
          sibs.map((s) => s.id),
        ),
      ),
    );

  const byProject = new Map<string, { ideaSummary: string | null; extractedIdeas: string[]; keyConcepts: string[] }>();
  for (const s of sibs) byProject.set(s.id, { ideaSummary: null, extractedIdeas: [], keyConcepts: [] });
  for (const a of arts) {
    const g = byProject.get(a.projectId);
    if (!g) continue;
    if (a.artifactKind === "idea_summary") g.ideaSummary = a.preview;
    else if (a.artifactKind === "extracted_idea") g.extractedIdeas.push(a.preview);
    else if (a.artifactKind === "key_concept") g.keyConcepts.push(a.preview);
  }

  return sibs.map((s) => {
    const g = byProject.get(s.id) ?? { ideaSummary: null, extractedIdeas: [], keyConcepts: [] };
    return { siblingId: s.id, title: s.title, stage: s.currentPhase, ...g };
  });
}

export type OverlapHit = {
  siblingProjectId: string;
  kind: ArtifactKind;
  hash: string;
  preview: string;
};

/**
 * Hash the caller's candidate texts and find exact (normalized) matches among the
 * family's OTHER projects' cached digests. Indexed `hash IN (…)` lookup — <50ms,
 * zero AI. Whitespace/case-insensitive (same normalizer as the writer).
 */
export async function findOverlapsInFamily(
  projectId: string,
  candidates: { kind?: string; text: string }[],
): Promise<OverlapHit[]> {
  const [self] = await db
    .select({ familyId: projects.familyId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const familyId = self?.familyId ?? null;
  const texts = candidates.map((c) => c.text).filter((t) => t && t.trim());
  if (!familyId || !texts.length) return [];

  const hashes = [...new Set(texts.map((t) => digestHash(t)))];
  const rows = await db
    .select({
      siblingProjectId: projectFamilyArtifacts.projectId,
      kind: projectFamilyArtifacts.artifactKind,
      hash: projectFamilyArtifacts.hash,
      preview: projectFamilyArtifacts.preview,
    })
    .from(projectFamilyArtifacts)
    .where(
      and(
        eq(projectFamilyArtifacts.familyId, familyId),
        ne(projectFamilyArtifacts.projectId, projectId),
        inArray(projectFamilyArtifacts.hash, hashes),
      ),
    );

  return rows.map((r) => ({ ...r, kind: r.kind as ArtifactKind }));
}

/** neon-http `execute` result → row array (shape-tolerant across driver versions). */
function rowsOf(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown })?.rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

export type RelevantArtifact = {
  siblingProjectId: string;
  kind: ArtifactKind;
  preview: string;
  score: number;
};

/**
 * Semantic top-K sibling concept artifacts by cosine similarity to a query vector,
 * scoped to the caller's family and excluding the caller. Uses pgvector's `<=>`
 * (HNSW cosine index) via raw SQL. Returns [] when standalone / no query / no
 * embedded rows — so callers degrade to the recency path.
 */
export async function getRelevantFamilyArtifacts(
  projectId: string,
  queryVec: number[],
  topK = 8,
): Promise<RelevantArtifact[]> {
  if (!queryVec?.length) return [];
  const [self] = await db
    .select({ familyId: projects.familyId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const familyId = self?.familyId ?? null;
  if (!familyId) return [];

  const lit = toVectorLiteral(queryVec);
  const res = await db.execute(sql`
    SELECT ${projectFamilyArtifacts.projectId} AS sibling_project_id,
           ${projectFamilyArtifacts.artifactKind} AS kind,
           ${projectFamilyArtifacts.preview} AS preview,
           1 - (${projectFamilyArtifacts.embedding} <=> ${lit}::vector) AS score
    FROM ${projectFamilyArtifacts}
    WHERE ${projectFamilyArtifacts.familyId} = ${familyId}
      AND ${projectFamilyArtifacts.projectId} <> ${projectId}
      AND ${projectFamilyArtifacts.embedding} IS NOT NULL
    ORDER BY ${projectFamilyArtifacts.embedding} <=> ${lit}::vector
    LIMIT ${topK}
  `);
  return rowsOf(res).map((r) => ({
    siblingProjectId: String(r.sibling_project_id),
    kind: String(r.kind) as ArtifactKind,
    preview: String(r.preview),
    score: Number(r.score),
  }));
}

export type RelevantPassage = {
  fileId: string;
  filename: string;
  content: string;
  score: number;
};

/**
 * Semantic top-K reference-document passages by cosine similarity to a query vector,
 * scoped to a family. Join-free (filename denormalized on the chunk row). Returns []
 * when no query / no embedded chunks.
 */
export async function getRelevantDocChunks(
  familyId: string,
  queryVec: number[],
  topK = 6,
): Promise<RelevantPassage[]> {
  if (!familyId || !queryVec?.length) return [];
  const lit = toVectorLiteral(queryVec);
  const res = await db.execute(sql`
    SELECT ${projectFamilyContextFileChunks.fileId} AS file_id,
           ${projectFamilyContextFileChunks.filename} AS filename,
           ${projectFamilyContextFileChunks.content} AS content,
           1 - (${projectFamilyContextFileChunks.embedding} <=> ${lit}::vector) AS score
    FROM ${projectFamilyContextFileChunks}
    WHERE ${projectFamilyContextFileChunks.familyId} = ${familyId}
      AND ${projectFamilyContextFileChunks.embedding} IS NOT NULL
    ORDER BY ${projectFamilyContextFileChunks.embedding} <=> ${lit}::vector
    LIMIT ${topK}
  `);
  return rowsOf(res).map((r) => ({
    fileId: String(r.file_id),
    filename: String(r.filename),
    content: String(r.content),
    score: Number(r.score),
  }));
}
