import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createProject, listProjects } from "@/lib/db/projects";

export const runtime = "nodejs";

/** GET /api/projects — list the user's projects (newest first). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { userId } = user;
  try {
    const projects = await listProjects(userId);
    return NextResponse.json({ projects });
  } catch (err) {
    console.error("[projects] list failed", err);
    return NextResponse.json(
      { error: "list_failed", detail: String(err) },
      { status: 500 }
    );
  }
}

/** POST /api/projects — create a new project. Body: { title?: string }. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { userId, email } = user;
  let title = "Untitled Draft";
  try {
    const body = (await req.json()) as { title?: string };
    if (typeof body?.title === "string" && body.title.trim()) title = body.title;
  } catch {
    // No body — use the default title.
  }

  try {
    const project = await createProject(userId, email, title);
    return NextResponse.json({
      project: {
        id: project.id,
        title: project.title,
        currentPhase: project.currentPhase,
      },
    });
  } catch (err) {
    console.error("[projects] create failed", err);
    return NextResponse.json(
      { error: "create_failed", detail: String(err) },
      { status: 500 }
    );
  }
}
