import { NextResponse } from "next/server";
import { getLocalUser } from "@/lib/auth";
import { deleteProject, renameProject } from "@/lib/db/projects";

export const runtime = "nodejs";

type Params = { params: { id: string } };

/** DELETE /api/projects/:id — delete a project and everything under it. */
export async function DELETE(_req: Request, { params }: Params) {
  const { userId } = getLocalUser();
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

/** PATCH /api/projects/:id — rename a project. Body: { title: string }. */
export async function PATCH(req: Request, { params }: Params) {
  const { userId } = getLocalUser();
  let title = "";
  try {
    const body = (await req.json()) as { title?: string };
    title = body?.title ?? "";
  } catch {
    // fall through to validation below
  }
  if (!title.trim()) {
    return NextResponse.json({ error: "title_required" }, { status: 400 });
  }

  try {
    const ok = await renameProject(userId, params.id, title);
    if (!ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[projects] rename failed", err);
    return NextResponse.json(
      { error: "rename_failed", detail: String(err) },
      { status: 500 }
    );
  }
}
