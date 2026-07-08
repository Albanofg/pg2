import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { deleteProject, updateProjectDetails } from "@/lib/db/projects";

export const runtime = "nodejs";

type Params = { params: { id: string } };

/** DELETE /api/projects/:id — delete a project and everything under it. */
export async function DELETE(_req: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { userId } = user;
  try {
    const ok = await deleteProject(userId, params.id);
    if (!ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[projects] delete failed", err);
    return NextResponse.json(
      { error: "delete_failed", detail: String(err) },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/projects/:id — update a project's editable details. Body may include
 * any of: title, inventorNames, filedDate, status, applicationNumber, notes.
 * Undefined fields are left untouched (so a title-only rename still works).
 */
export async function PATCH(req: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { userId } = user;
  let body: {
    title?: string;
    inventorNames?: string | null;
    filedDate?: string | null;
    status?: string | null;
    applicationNumber?: string | null;
    notes?: string | null;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const ok = await updateProjectDetails(userId, params.id, body);
    if (!ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[projects] update failed", err);
    return NextResponse.json({ error: "update_failed", detail: String(err) }, { status: 500 });
  }
}
