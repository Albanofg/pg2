import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, projectFamilies } from "@/db/schema";
import { getUsageContext } from "@/lib/ai/usage-context";
import { embedQuery } from "@/lib/ai/embed";
import {
  getSiblingsReference,
  getRelevantFamilyArtifacts,
  getRelevantDocChunks,
  type RelevantArtifact,
  type RelevantPassage,
} from "./read";
import { getContextFilesForPrompt } from "./context-files";

/**
 * Per-turn family-context assembly + injection plumbing.
 *
 * Two consumers:
 *  - the Helper gets a `## FAMILY CONTEXT` block (semantic when a query is present,
 *    else the recency fallback);
 *  - every working agent gets a leaner `## FAMILY KNOWLEDGE` block of the passages
 *    most relevant to what it's analyzing/drafting.
 *
 * Everything is fetched server-side (the client payload can't be trusted to carry
 * familyId), lazy, and memoized per request. Semantic retrieval degrades gracefully
 * to the recency path whenever there's no query or nothing has been embedded yet.
 */

const SIBLING_PROMPT_CAP = 10; // top-N siblings by recency (recency mode)
const PROMPT_ARTIFACT_SOFT_CAP = 4000;
const PASSAGE_SOFT_CAP = 1500;
const CONTEXT_FILE_PROMPT_CAP = 25; // max reference documents referenced per turn
const FILE_TEXT_PER_FILE = 12000; // per-document full-text budget (chars, recency mode)
const FILE_TEXT_TOTAL = 40000; // total full-text budget across documents (recency mode)
const SEM_CONCEPTS_TOPK = 8;
const SEM_PASSAGES_TOPK = 6;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Cut at the last full sentence within budget (else last word), never mid-word. */
export function truncateAtSentenceBoundary(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const sentence = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (sentence > max * 0.5) return `${t.slice(0, sentence + 1).trim()} […]`;
  const word = slice.lastIndexOf(" ");
  return `${t.slice(0, word > 0 ? word : max).trim()} […]`;
}

// ── query embedding, memoized per request (ALS store) + query ────────────────
const queryVecMemo = new WeakMap<object, Map<string, Promise<number[] | null>>>();

function embedQueryMemoized(query: string): Promise<number[] | null> {
  const q = query.trim();
  if (!q) return Promise.resolve(null);
  const ctx = getUsageContext();
  if (!ctx) return embedQuery(q);
  let m = queryVecMemo.get(ctx);
  if (!m) {
    m = new Map();
    queryVecMemo.set(ctx, m);
  }
  let p = m.get(q);
  if (!p) {
    p = embedQuery(q);
    m.set(q, p);
  }
  return p;
}

async function familyMetaOf(projectId: string): Promise<{ familyId: string; context: string | null } | null> {
  const [row] = await db
    .select({ familyId: projects.familyId, context: projectFamilies.context })
    .from(projects)
    .leftJoin(projectFamilies, eq(projects.familyId, projectFamilies.id))
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!row?.familyId) return null;
  return { familyId: row.familyId, context: row.context ?? null };
}

/** Embed the query once and pull the most-relevant concepts + passages, or null if
 *  no query embeds / nothing relevant has been embedded yet (→ caller falls back). */
async function retrieveRelevant(
  projectId: string,
  familyId: string,
  query: string,
): Promise<{ concepts: RelevantArtifact[]; passages: RelevantPassage[] } | null> {
  const vec = await embedQueryMemoized(query);
  if (!vec) return null;
  const [concepts, passages] = await Promise.all([
    getRelevantFamilyArtifacts(projectId, vec, SEM_CONCEPTS_TOPK),
    getRelevantDocChunks(familyId, vec, SEM_PASSAGES_TOPK),
  ]);
  if (!concepts.length && !passages.length) return null;
  return { concepts, passages };
}

const renderConcepts = (concepts: RelevantArtifact[]) =>
  concepts.map((c) => ({
    siblingId: c.siblingProjectId,
    kind: c.kind,
    preview: truncateAtSentenceBoundary(c.preview, PROMPT_ARTIFACT_SOFT_CAP),
    relevance: r2(c.score),
  }));

const renderPassages = (passages: RelevantPassage[]) =>
  passages.map((p) => ({
    filename: p.filename,
    snippet: truncateAtSentenceBoundary(p.content, PASSAGE_SOFT_CAP),
    relevance: r2(p.score),
  }));

/**
 * The `## FAMILY CONTEXT` block for a project's Helper turn, or null if standalone.
 * Semantic mode when `query` is present and something relevant is embedded; else the
 * recency fallback (top-N recent siblings + budgeted reference-doc full text).
 */
export async function buildFamilyContext(projectId: string, query?: string): Promise<string | null> {
  const [row] = await db
    .select({
      familyId: projects.familyId,
      context: projectFamilies.context,
      inventorNames: projects.inventorNames,
      filedDate: projects.filedDate,
      status: projects.status,
      applicationNumber: projects.applicationNumber,
    })
    .from(projects)
    .leftJoin(projectFamilies, eq(projects.familyId, projectFamilies.id))
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!row?.familyId) return null;

  // The current Project's filing status — drives the doctrine's TONE-by-status
  // behavior (filed/granted/archived → maintenance tone). Only emitted when set.
  const filedStatus =
    row.status || row.filedDate || row.applicationNumber || row.inventorNames
      ? {
          status: row.status ?? null,
          filedDate: row.filedDate ?? null,
          applicationNumber: row.applicationNumber ?? null,
          inventorNames: row.inventorNames
            ? row.inventorNames.split(",").map((n) => n.trim()).filter(Boolean)
            : [],
        }
      : null;

  // ── Semantic mode ──────────────────────────────────────────────────────────
  if (query && query.trim()) {
    const rel = await retrieveRelevant(projectId, row.familyId, query);
    if (rel) {
      const files = await getContextFilesForPrompt(row.familyId);
      const payload = {
        familyId: row.familyId,
        familyContext: row.context ?? null,
        projectFiledStatus: filedStatus,
        retrievalMode: "semantic" as const,
        relevantConcepts: renderConcepts(rel.concepts),
        relevantPassages: renderPassages(rel.passages),
        // Compact index of every attached document (no full text — passages above
        // carry the relevant content).
        documents: files.map((f) => ({
          filename: f.filename,
          summary: f.summary ?? null,
          status: f.extractionStatus === "ok" ? "ready" : f.extractionStatus,
        })),
      };
      return `## FAMILY CONTEXT\n${JSON.stringify(payload, null, 2)}`;
    }
    // nothing relevant embedded yet → fall through to recency
  }

  // ── Recency fallback (Phase-1 behavior) ────────────────────────────────────
  const siblings = await getSiblingsReference(projectId);
  const capped = siblings.slice(0, SIBLING_PROMPT_CAP);

  const files = await getContextFilesForPrompt(row.familyId);
  const cappedFiles = files.slice(0, CONTEXT_FILE_PROMPT_CAP);
  let textBudget = FILE_TEXT_TOTAL;
  const referenceFiles = cappedFiles.map((f) => {
    const base = {
      fileId: f.id,
      filename: f.filename,
      summary: f.summary ?? null,
      extractionStatus: f.extractionStatus === "ok" ? "ready" : f.extractionStatus,
    };
    if (f.extractionStatus !== "ok" || !f.extractedText || textBudget <= 0) {
      return { ...base, fullText: null as string | null, fullTextTruncated: f.extractionStatus === "ok" };
    }
    const perFile = Math.min(FILE_TEXT_PER_FILE, textBudget);
    const truncated = f.extractedText.length > perFile;
    const slice = truncated ? truncateAtSentenceBoundary(f.extractedText, perFile) : f.extractedText.trim();
    textBudget -= slice.length;
    return { ...base, fullText: slice, fullTextTruncated: truncated };
  });

  const payload = {
    familyId: row.familyId,
    familyContext: row.context ?? null,
    projectFiledStatus: filedStatus,
    retrievalMode: "recency" as const,
    siblings: capped.map((s) => ({
      siblingId: s.siblingId,
      title: s.title,
      stage: s.stage,
      ideaSummary: s.ideaSummary ? truncateAtSentenceBoundary(s.ideaSummary, PROMPT_ARTIFACT_SOFT_CAP) : null,
      extractedIdeaTitles: s.extractedIdeas.map((e) => truncateAtSentenceBoundary(e, PROMPT_ARTIFACT_SOFT_CAP)),
      keyConceptPreviews: s.keyConcepts.map((k) => truncateAtSentenceBoundary(k, PROMPT_ARTIFACT_SOFT_CAP)),
    })),
    siblingsOverflow: Math.max(0, siblings.length - capped.length),
    referenceFiles,
    referenceFilesOverflow: Math.max(0, files.length - cappedFiles.length),
  };
  if (!payload.siblings.length && !payload.familyContext && !filedStatus && !referenceFiles.length)
    return null;
  return `## FAMILY CONTEXT\n${JSON.stringify(payload, null, 2)}`;
}

/**
 * The `## FAMILY KNOWLEDGE` block for a WORKING agent's turn (not the Helper) — the
 * concepts + reference passages most relevant to `query` (the subject under analysis
 * / drafting). Leaner than the Helper block and headed "background only". Null when
 * standalone or nothing relevant is embedded. The CORE doctrine (backpack) tells the
 * agent how to treat it.
 */
export async function resolveAgentFamilyBlock(query: string): Promise<string | null> {
  const ctx = getUsageContext();
  if (!ctx?.projectId) return null;
  const q = query?.trim();
  if (!q) return null;
  const meta = await familyMetaOf(ctx.projectId);
  if (!meta) return null;
  const rel = await retrieveRelevant(ctx.projectId, meta.familyId, q);
  if (!rel) return null;
  const payload = {
    familyContext: meta.context,
    relevantConcepts: renderConcepts(rel.concepts),
    relevantPassages: renderPassages(rel.passages),
  };
  return `## FAMILY KNOWLEDGE (background only — not the inventor's material)\n${JSON.stringify(payload, null, 2)}`;
}

/**
 * Resolve the FAMILY CONTEXT block for the current request's project (Helper turns).
 * projectId comes from the usage-context ALS every route already sets; memoized per
 * request + query so only a turn that runs the Helper pays, and only once.
 */
const memo = new WeakMap<object, Map<string, Promise<string | null>>>();

export function resolveFamilyBlock(query?: string): Promise<string | null> {
  const ctx = getUsageContext();
  if (!ctx?.projectId) return Promise.resolve(null);
  let byQuery = memo.get(ctx);
  if (!byQuery) {
    byQuery = new Map();
    memo.set(ctx, byQuery);
  }
  const key = query?.trim() ?? "";
  let cached = byQuery.get(key);
  if (!cached) {
    cached = buildFamilyContext(ctx.projectId, query);
    byQuery.set(key, cached);
  }
  return cached;
}
