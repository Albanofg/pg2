import { NextResponse } from "next/server";
import { withUsageContext } from "@/lib/ai/usage-context";
import { loadConception } from "@/lib/modules/conception/registry";
import {
  clearMaturation,
  loadMaturation,
  saveMaturation,
  seedMaturation,
} from "@/lib/modules/maturation/registry";
import type { CardActionInput, Module2View } from "@/lib/modules/maturation/types";

export const runtime = "nodejs";

const EMPTY_VIEW: Module2View = {
  phase: "maturing",
  cards: [],
  concepts: [],
  conversation: [],
  ledger: [],
  complete: false,
};

type Body =
  | { op: "view"; projectId: string }
  | { op: "start"; projectId: string }
  | { op: "act"; projectId: string; cardId: string; input: CardActionInput }
  | { op: "message"; projectId: string; text: string }
  | { op: "set_carry"; projectId: string; conceptId: string; carry: boolean }
  | { op: "edit"; projectId: string; conceptId: string; text: string }
  | { op: "reset"; projectId: string };

/**
 * Drives Module 2 (Maturation). State is durable per project (DB). `start` is
 * idempotent: it returns the saved session if it has real progress, otherwise
 * (re)seeds from the project's conception concepts.
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

  return withUsageContext({ projectId: body.projectId, stage: "maturation" }, async () => {
  try {
    switch (body.op) {
      case "view": {
        const engine = await loadMaturation(body.projectId);
        return NextResponse.json(engine ? engine.view() : EMPTY_VIEW);
      }
      case "start": {
        const existing = await loadMaturation(body.projectId);
        const v = existing?.view();
        const hasProgress =
          !!v &&
          (v.cards.length > 0 ||
            v.complete ||
            v.concepts.some((c) => c.deepened_statement || c.decision !== "undecided"));
        if (existing && hasProgress) return NextResponse.json(v);

        const conception = await loadConception(body.projectId);
        const engine = seedMaturation(
          conception.getConcepts(),
          conception.ledgerEntries(),
          conception.consciousnessInstance(),
        );
        const view = await engine.start();
        await saveMaturation(body.projectId, engine);
        return NextResponse.json(view);
      }
      case "act": {
        const engine = await loadMaturation(body.projectId);
        if (!engine) return NextResponse.json(EMPTY_VIEW);
        const view = await engine.act(body.cardId, body.input);
        await saveMaturation(body.projectId, engine);
        return NextResponse.json(view);
      }
      case "message": {
        const engine = await loadMaturation(body.projectId);
        if (!engine) return NextResponse.json(EMPTY_VIEW);
        const view = await engine.tell(body.text ?? "");
        await saveMaturation(body.projectId, engine);
        return NextResponse.json(view);
      }
      case "set_carry": {
        const engine = await loadMaturation(body.projectId);
        if (!engine) return NextResponse.json(EMPTY_VIEW);
        const view = engine.setCarry(body.conceptId, body.carry);
        await saveMaturation(body.projectId, engine);
        return NextResponse.json(view);
      }
      case "edit": {
        const engine = await loadMaturation(body.projectId);
        if (!engine) return NextResponse.json(EMPTY_VIEW);
        const view = engine.editConcept(body.conceptId, body.text ?? "");
        await saveMaturation(body.projectId, engine);
        return NextResponse.json(view);
      }
      case "reset": {
        await clearMaturation(body.projectId);
        return NextResponse.json(EMPTY_VIEW);
      }
      default:
        return NextResponse.json({ error: "unknown_op" }, { status: 400 });
    }
  } catch (err) {
    console.error("[maturation] failed", err);
    return NextResponse.json(
      { error: "maturation_failed", detail: String(err) },
      { status: 500 }
    );
  }
  });
}
