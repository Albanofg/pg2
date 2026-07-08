import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getFamily } from "@/lib/db/families";
import { softDeleteContextFile } from "@/lib/families/context-files";

export const runtime = "nodejs";

/** DELETE /api/families/:id/context-files/:fileId — soft-delete a reference doc. */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; fileId: string } },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await getFamily(params.id, user.userId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const ok = await softDeleteContextFile(params.fileId, params.id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
