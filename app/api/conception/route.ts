import { NextResponse } from "next/server";
import {
  loadConception,
  resetConception,
  saveConception,
} from "@/lib/modules/conception/registry";
import type { CardActionInput } from "@/lib/modules/conception/types";

export const runtime = "nodejs";

type Body =
  | { op: "view"; projectId: string }
  | { op: "ingest"; projectId: string; raw: string }
  | { op: "act"; projectId: string; cardId: string; input: CardActionInput }
  | { op: "message"; projectId: string; text: string }
  | { op: "reset"; projectId: string };

/**
 * Drives Module 1 (Conception). State is durable: every op loads the engine from
 * the project's DB-stored snapshot, runs, and saves it back.
 *   view   — current view (no write)
 *   ingest — submit the inventor's raw idea
 *   act    — apply an inventor action to a card
 *   message— free-text to the Helper (refine / add)
 *   reset  — start the conception session over
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
    if (body.op === "view") {
      const engine = await loadConception(body.projectId);
      return NextResponse.json(engine.view());
    }

    if (body.op === "reset") {
      const engine = await resetConception(body.projectId);
      return NextResponse.json(engine.view());
    }

    const engine = await loadConception(body.projectId);
    let view;
    if (body.op === "ingest") view = await engine.ingest(body.raw ?? "");
    else if (body.op === "act") view = await engine.act(body.cardId, body.input);
    else if (body.op === "message") view = await engine.tell(body.text ?? "");
    else return NextResponse.json({ error: "unknown_op" }, { status: 400 });

    await saveConception(body.projectId, engine);
    return NextResponse.json(view);
  } catch (err) {
    console.error("[conception] failed", err);
    return NextResponse.json(
      { error: "conception_failed", detail: String(err) },
      { status: 500 }
    );
  }
}
