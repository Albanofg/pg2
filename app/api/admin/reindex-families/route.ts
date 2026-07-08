import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { reindexFamilyEmbeddings } from "@/lib/families/reindex";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/admin/reindex-families — admin-only one-off backfill of family
 * embeddings (artifacts + reference-document chunks). Idempotent; safe to re-run if
 * it times out on a large dataset.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const result = await reindexFamilyEmbeddings();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[reindex-families] failed", err);
    return NextResponse.json({ error: "reindex_failed", detail: String(err) }, { status: 500 });
  }
}
