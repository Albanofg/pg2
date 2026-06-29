import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { openLens, runExcavationFrontier } from "@/lib/modules/brainstorm/frontier";
import { runReversalStep } from "@/lib/modules/brainstorm/agents";
import { brainstormRunner } from "@/lib/modules/brainstorm/runner.openai";
import { sampleBackpack, sampleProblem } from "@/lib/modules/brainstorm/fixtures";
import type {
  Backpack,
  DerivationTrace,
  LensCard,
  WalkTurn,
} from "@/lib/modules/brainstorm/types";

/**
 * Module 0 — Step 1. The first-sixty-seconds excavation.
 *
 *   POST /api/brainstorm                       → 3 lens cards + clarifier (frontier)
 *   POST /api/brainstorm { op:"open", card }   → trace + opening walk step for a picked card
 *   POST /api/brainstorm { op:"step", trace }  → next adaptive walk step
 *   GET  /api/brainstorm                       → runs the frontier on the sample spark
 *
 * Auth required (it spends model tokens). The deeper grid engine is off this path.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await runExcavationFrontier(brainstormRunner, { spark: sampleProblem });
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    op?: "frontier" | "open" | "step";
    problem?: string;
    clarifierAnswer?: string;
    backpack?: Backpack;
    card?: LensCard;
    trace?: DerivationTrace;
    conversation?: WalkTurn[];
    pushDeeper?: boolean;
  };

  // op: "open" — the inventor picked a card; reconstruct + open its walk.
  if (body.op === "open") {
    if (!body.card) {
      return NextResponse.json({ error: "card_required" }, { status: 400 });
    }
    const opened = await openLens(brainstormRunner, {
      spark: body.problem?.trim() || sampleProblem,
      card: body.card,
      backpack: body.backpack ?? sampleBackpack,
    });
    return NextResponse.json(opened);
  }

  // op: "step" — one adaptive walk step, reacting to the conversation so far.
  if (body.op === "step") {
    if (!body.trace) {
      return NextResponse.json({ error: "trace_required" }, { status: 400 });
    }
    const step = await runReversalStep(brainstormRunner, {
      trace: body.trace,
      backpack: body.backpack ?? sampleBackpack,
      conversation: Array.isArray(body.conversation) ? body.conversation : [],
      ...(body.pushDeeper ? { pushDeeper: true } : {}),
    });
    return NextResponse.json(step);
  }

  // default — the Step-1 frontier (three lens cards + market reads).
  const result = await runExcavationFrontier(brainstormRunner, {
    spark: body.problem?.trim() || sampleProblem,
    ...(body.clarifierAnswer ? { clarifierAnswer: body.clarifierAnswer } : {}),
  });
  return NextResponse.json(result);
}
