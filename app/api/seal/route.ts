import { NextRequest, NextResponse } from "next/server";
import { getLocalUser } from "@/lib/auth";
import { db } from "@/db";
import { notebooks } from "@/db/schema";
import { assertOwnership } from "@/lib/db/projects";
import { buildNotebook } from "@/lib/notebook";
import { sealNotebook } from "@/lib/crypto/rfc3161";

export const runtime = "nodejs";

/**
 * Seal the Inventor's Notebook: build the deterministic content, hash it,
 * obtain an RFC 3161 timestamp token, and persist the proof.
 */
export async function POST(req: NextRequest) {
  const { userId } = getLocalUser();

  const { projectId } = await req.json();
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  if (!(await assertOwnership(projectId, userId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { content } = await buildNotebook(projectId);
    const seal = await sealNotebook(content);

    const [row] = await db
      .insert(notebooks)
      .values({
        projectId,
        contentHash: seal.contentHash,
        rfc3161Token: seal.rfc3161Token,
        sealedAt: seal.sealedAt,
      })
      .returning();

    return NextResponse.json({
      sealedAt: row.sealedAt.toISOString(),
      contentHash: row.contentHash,
      tsaStatus: seal.tsaStatus,
      hasToken: !!seal.rfc3161Token,
    });
  } catch (err) {
    console.error("[seal] failed", err);
    return NextResponse.json(
      { error: "seal_failed", detail: String(err) },
      { status: 500 }
    );
  }
}
