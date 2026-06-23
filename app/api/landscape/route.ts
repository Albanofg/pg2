import { NextResponse } from "next/server";
import { loadMaturation } from "@/lib/modules/maturation/registry";
import {
  clearLandscape,
  loadLandscape,
  saveLandscape,
  seedLandscape,
} from "@/lib/modules/landscape/registry";
import type { Module3View } from "@/lib/modules/landscape/types";

export const runtime = "nodejs";

const EMPTY_VIEW: Module3View = {
  phase: "idle",
  ideas: [],
  ledger: [],
  complete: false,
};

type Body =
  | { op: "view"; projectId: string }
  | { op: "start"; projectId: string }
  | { op: "research"; projectId: string; conceptId: string }
  | { op: "message"; projectId: string; text: string }
  | { op: "reset"; projectId: string };

/**
 * Drives Module 3 (Landscape). State is durable per project (DB). `start` is
 * idempotent: it returns the saved landscape if it has already searched,
 * otherwise seeds from the project's maturation (carried concepts) and runs
 * the searches.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body?.projectId) {
    return NextResponse.json({ error: "projectId_required" }, { status: 400 });
  }

  try {
    switch (body.op) {
      case "view": {
        const engine = await loadLandscape(body.projectId);
        return NextResponse.json(engine ? engine.view() : EMPTY_VIEW);
      }
      case "start": {
        const existing = await loadLandscape(body.projectId);
        if (existing && existing.view().ideas.length > 0) {
          return NextResponse.json(existing.view());
        }
        const maturation = await loadMaturation(body.projectId);
        if (!maturation) return NextResponse.json(EMPTY_VIEW);
        // Only the matured concepts the inventor carried forward, searched on
        // their deepened statements.
        const carried = maturation
          .view()
          .concepts.filter((c) => c.decision === "carry_forward")
          .map((c) => ({
            ...c,
            formalized_statement: c.deepened_statement || c.formalized_statement,
          }));
        if (carried.length === 0) return NextResponse.json(EMPTY_VIEW);
        const context = carried
          .map((c) => c.deepened_statement || c.formalized_statement)
          .join("\n\n");
        const engine = seedLandscape(carried, context, maturation.ledgerEntries());
        const view = await engine.start();
        await saveLandscape(body.projectId, engine);
        return NextResponse.json(view);
      }
      case "research": {
        const engine = await loadLandscape(body.projectId);
        if (!engine) return NextResponse.json(EMPTY_VIEW);
        const view = await engine.research(body.conceptId);
        await saveLandscape(body.projectId, engine);
        return NextResponse.json(view);
      }
      case "message": {
        const engine = await loadLandscape(body.projectId);
        if (!engine) return NextResponse.json(EMPTY_VIEW);
        const view = await engine.tell(body.text ?? "");
        await saveLandscape(body.projectId, engine);
        return NextResponse.json(view);
      }
      case "reset": {
        await clearLandscape(body.projectId);
        return NextResponse.json(EMPTY_VIEW);
      }
      default:
        return NextResponse.json({ error: "unknown_op" }, { status: 400 });
    }
  } catch (err) {
    console.error("[landscape] failed", err);
    return NextResponse.json(
      { error: "landscape_failed", detail: String(err) },
      { status: 500 }
    );
  }
}
