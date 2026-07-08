import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getFamilyWithMembers, softDeleteFamily, updateFamily } from "@/lib/db/families";

export const runtime = "nodejs";

/** Family detail + member projects. 404 if not owned (don't leak existence). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const family = await getFamilyWithMembers(params.id, user.userId);
  if (!family) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ family });
}

/** Rename / re-describe / edit context. Undefined fields are left untouched. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    description?: string | null;
    context?: string | null;
  };
  const ok = await updateFamily(params.id, user.userId, body);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Soft-delete (detaches members, keeps their Projects + cached artifacts). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ok = await softDeleteFamily(params.id, user.userId);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
