import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, projectFamilyArtifacts } from "@/db/schema";
import { embedDocuments } from "@/lib/ai/embed";

/**
 * The cost-control digest cache. A project's notable content is digested exactly
 * once per save (zero AI — it reads the live typed engines and hashes their text),
 * so every later cross-sibling overlap check is a pure indexed SQL read. See
 * `lib/families/read.ts` for the readers.
 */

export type ArtifactKind = "idea_summary" | "extracted_idea" | "key_concept";
export type DigestScope = "all" | "conception" | "differentiation" | "showcase";

// Which artifact kinds a given save touches. key_concept is shared by
// differentiation + showcase (same concept id), so either triggers a full
// key_concept recompute from both sources.
const KINDS_FOR: Record<DigestScope, ArtifactKind[]> = {
  all: ["idea_summary", "extracted_idea", "key_concept"],
  conception: ["idea_summary", "extracted_idea"],
  differentiation: ["key_concept"],
  showcase: ["key_concept"],
};

/** Whitespace/case-insensitive, otherwise exact — the overlap-match normalizer. */
export function normalizeForHash(t: string): string {
  return t.trim().replace(/\s+/g, " ").toLowerCase();
}
export function digestHash(t: string): string {
  return createHash("sha256").update(normalizeForHash(t)).digest("hex");
}

type Row = { artifactKind: ArtifactKind; artifactRef: string; preview: string; charCount: number; hash: string };
function row(kind: ArtifactKind, ref: string, text: string): Row {
  const preview = text.trim();
  return { artifactKind: kind, artifactRef: ref, preview, charCount: preview.length, hash: digestHash(preview) };
}

/**
 * Recompute + cache the digest rows for a project. Per touched kind: delete then
 * re-insert (idempotent; neon-http has no transactions, so a momentary gap
 * self-heals on the next save). Skips entirely for standalone projects (no family →
 * nothing to compare against). Defensive: unknown/empty engine state → zero rows.
 */
export async function refreshFamilyArtifacts(projectId: string, scope: DigestScope = "all"): Promise<void> {
  const [p] = await db
    .select({ familyId: projects.familyId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const familyId = p?.familyId ?? null;
  if (!familyId) return; // standalone — no digests needed

  const kinds = KINDS_FOR[scope];
  const rows: Row[] = [];

  if (kinds.includes("idea_summary") || kinds.includes("extracted_idea")) {
    const { loadConception } = await import("@/lib/modules/conception/registry");
    const c = await loadConception(projectId);
    if (kinds.includes("idea_summary")) {
      const s = c.view().statement?.text?.trim();
      if (s) rows.push(row("idea_summary", "statement", s));
    }
    if (kinds.includes("extracted_idea")) {
      for (const concept of c.getConcepts()) {
        if (concept.status?.state && concept.status.state !== "active") continue;
        const text = [concept.title, concept.formalized_statement].filter(Boolean).join(": ");
        if (text.trim()) rows.push(row("extracted_idea", concept.id, text));
      }
    }
  }

  if (kinds.includes("key_concept")) {
    // key_concept flows differentiation → showcase (same concept id); the broadened
    // showcase form wins where present.
    const byRef = new Map<string, Row>();
    const { loadDifferentiation } = await import("@/lib/modules/differentiation/registry");
    const d = await loadDifferentiation(projectId);
    if (d) {
      for (const kc of d.finish()) {
        const text = [kc.title, kc.differentiation_statement || kc.formalized_statement].filter(Boolean).join(": ");
        if (text.trim()) byRef.set(kc.id, row("key_concept", kc.id, text));
      }
    }
    const { loadShowcase } = await import("@/lib/modules/showcase/registry");
    const sc = await loadShowcase(projectId);
    if (sc) {
      for (const kc of sc.finish()) {
        const text = [kc.title, kc.broadened || kc.statement].filter(Boolean).join(": ");
        if (text.trim()) byRef.set(kc.id, row("key_concept", kc.id, text));
      }
    }
    rows.push(...byRef.values());
  }

  // Embed all rows' text once (best-effort, aligned to `rows`); null where it fails
  // so the row still writes and simply stays invisible to semantic retrieval.
  const vectors = rows.length ? await embedDocuments(rows.map((r) => r.preview)) : [];
  const embOf = new Map<Row, number[] | null>();
  rows.forEach((r, i) => embOf.set(r, vectors[i] ?? null));

  // Write per kind: clear that kind, then insert the fresh set (removed concepts vanish).
  for (const kind of kinds) {
    await db
      .delete(projectFamilyArtifacts)
      .where(and(eq(projectFamilyArtifacts.projectId, projectId), eq(projectFamilyArtifacts.artifactKind, kind)));
    const kindRows = rows.filter((r) => r.artifactKind === kind);
    if (kindRows.length) {
      await db
        .insert(projectFamilyArtifacts)
        .values(kindRows.map((r) => ({ projectId, familyId, ...r, embedding: embOf.get(r) ?? null })));
    }
  }
}

/** Fire-and-forget — never blocks the save/attach; logs and swallows failures. */
export function refreshFamilyArtifactsBackground(projectId: string, scope: DigestScope = "all"): void {
  void refreshFamilyArtifacts(projectId, scope).catch((e) =>
    console.error("[families] digest refresh failed", e instanceof Error ? e.message : e),
  );
}
