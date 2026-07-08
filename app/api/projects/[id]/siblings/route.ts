import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { assertOwnership } from "@/lib/db/projects";
import { getSiblingsReference } from "@/lib/families/read";

export const runtime = "nodejs";

/** Cached sibling digests for this project — `[]` if standalone. Pure SQL, 0 AI. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await assertOwnership(params.id, user.userId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const siblings = await getSiblingsReference(params.id);
  return NextResponse.json({ siblings });
}
