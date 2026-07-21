import { NextResponse } from "next/server";
import { withUsageContext } from "@/lib/ai/usage-context";
import {
  loadOrientation,
  resetOrientation,
  saveOrientation,
} from "@/lib/modules/orientation/registry";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body =
  | { op: "view"; projectId: string }
  | { op: "ingest"; projectId: string; raw: string }
  | { op: "message"; projectId: string; text: string }
  | { op: "build_brief"; projectId: string }
  | { op: "edit_brief"; projectId: string; text: string }
  | { op: "finish"; projectId: string }
  | { op: "reset"; projectId: string };

/**
 * Drives Module 0 (Orientation). Durable: every op loads the engine from the
 * project's DB snapshot, runs, and saves it back.
 *   view        — current view (no write)
 *   ingest      — the inventor's raw idea (recorded verbatim; opens the conversation)
 *   message     — free-text to the Socratic Helper
 *   build_brief — assemble the detailed brief from the inventor's material
 *   edit_brief  — the inventor's edit of the brief
 *   finish      — mark orientation complete (they're carrying the brief into Conception)
 *   reset       — start over
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

  return withUsageContext({ projectId: body.projectId, stage: "orientation" }, async () => {
    try {
      if (body.op === "view") {
        const engine = await loadOrientation(body.projectId);
        return NextResponse.json(engine.view());
      }
      if (body.op === "reset") {
        const engine = await resetOrientation(body.projectId);
        return NextResponse.json(engine.view());
      }

      const engine = await loadOrientation(body.projectId);
      let view;
      if (body.op === "ingest") view = await engine.ingest(body.raw ?? "");
      else if (body.op === "message") view = await engine.tell(body.text ?? "");
      else if (body.op === "build_brief") view = await engine.buildBrief();
      else if (body.op === "edit_brief") view = engine.editBrief(body.text ?? "");
      else if (body.op === "finish") view = engine.finish();
      else return NextResponse.json({ error: "unknown_op" }, { status: 400 });

      await saveOrientation(body.projectId, engine);
      return NextResponse.json(view);
    } catch (err) {
      console.error("[orientation] failed", err);
      return NextResponse.json(
        { error: "orientation_failed", detail: String(err) },
        { status: 500 },
      );
    }
  });
}
