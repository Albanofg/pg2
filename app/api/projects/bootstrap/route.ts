import { NextResponse } from "next/server";
import { getLocalUser } from "@/lib/auth";
import { bootstrapProject } from "@/lib/db/projects";
import { getNodes } from "@/lib/db/shared-consciousness";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { userId, email } = getLocalUser();

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

    return NextResponse.json({
      project: {
        id: project.id,
        title: project.title,
        currentPhase: project.currentPhase,
      },
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
