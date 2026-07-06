import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { bootstrapProject } from "@/lib/db/projects";
import { getNodes } from "@/lib/db/shared-consciousness";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { userId, email } = user;

  // Optional: load a specific project chosen from the dashboard.
  let projectId: string | null = null;
  try {
    const body = (await req.json()) as { projectId?: string };
    projectId = body?.projectId ?? null;
  } catch {
    // No/invalid body — fall back to the most recent project.
  }

  try {
    const project = await bootstrapProject(userId, email, projectId);
    const nodes = await getNodes(project.id);

    // Distill the "Current Idea" from the core_novelty node's inputs.
    const core = nodes.find((n) => n.nodeKey === "core_novelty");
    const currentIdea = (core?.humanInputs ?? []).join("\n");

    // Resume where the inventor was: each module writes its own key into
    // module_state only once its engine has run for this project, so the furthest
    // key present is the furthest stage reached. Falls back to Conception (the
    // first working stage) when nothing has been persisted yet.
    const ms = (project.moduleState ?? {}) as Record<string, unknown>;
    const STAGE_ORDER = [
      "showcase",
      "differentiation",
      "landscape",
      "maturation",
      "conception",
    ] as const;
    const stage = STAGE_ORDER.find((k) => ms[k] != null) ?? "conception";

    return NextResponse.json({
      project: {
        id: project.id,
        title: project.title,
        currentPhase: project.currentPhase,
      },
      stage,
      currentIdea,
      nodes: nodes.map((n) => ({
        nodeKey: n.nodeKey,
        draftOutput: n.draftOutput,
        isVerified: n.isVerified,
        invalidatedAt: n.invalidatedAt,
      })),
    });
  } catch (err) {
    console.error("[bootstrap] failed", err);
    return NextResponse.json(
      { error: "bootstrap_failed", detail: String(err) },
      { status: 500 }
    );
  }
}
