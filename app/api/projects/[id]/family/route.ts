import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { attachProjectToFamily, detachProjectFromFamily } from "@/lib/db/families";

export const runtime = "nodejs";

/** Attach this project to a family (both must be owned). Triggers a digest refresh. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { familyId?: string };
  if (!body.familyId) return NextResponse.json({ error: "familyId_required" }, { status: 400 });
  const ok = await attachProjectToFamily(params.id, body.familyId, user.userId);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Detach this project from its family (keeps the Project + its cached artifacts). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ok = await detachProjectFromFamily(params.id, user.userId);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
