import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { assertOwnership } from "@/lib/db/projects";
import { findOverlapsInFamily } from "@/lib/families/read";

export const runtime = "nodejs";

/**
 * Hash-based overlap check against the family's OTHER projects' cached digests.
 * Body `{ candidates: [{ kind?, text }] }`. Pure indexed SQL lookup, zero AI.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await assertOwnership(params.id, user.userId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    candidates?: { kind?: string; text: string }[];
  };
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const overlaps = await findOverlapsInFamily(params.id, candidates);
  return NextResponse.json({ overlaps });
}
