import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { runBrainstormEngine } from "@/lib/modules/brainstorm/engine";
import { runReversalStep } from "@/lib/modules/brainstorm/agents";
import { brainstormRunner } from "@/lib/modules/brainstorm/runner.openai";
import { sampleBackpack, sampleProblem } from "@/lib/modules/brainstorm/fixtures";
import type {
  Backpack,
  DerivationTrace,
  SubProblem,
  WalkTurn,
} from "@/lib/modules/brainstorm/types";

/**
 * Module 0 backstage engine — grid → generate → score → select frontier → trace →
 * reverse. Returns a small frontier of directions, each with its Socratic walk.
 *
 *   GET  /api/brainstorm                 → runs on the sample problem (quick check)
 *   POST /api/brainstorm { problem, backpack?, subProblems?, n? }
 *
 * Auth required (it spends model tokens). API routes enforce their own session
 * check — middleware only gates pages.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await runBrainstormEngine(brainstormRunner, {
    problem: sampleProblem,
    backpack: sampleBackpack,
    n: 16,
  });
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    op?: "frontier" | "step";
    problem?: string;
    backpack?: Backpack;
    subProblems?: SubProblem[];
    n?: number;
    // op: "step"
    trace?: DerivationTrace;
    conversation?: WalkTurn[];
    pushDeeper?: boolean;
  };

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

  // default — compute the frontier (each direction's opening step).
  const result = await runBrainstormEngine(brainstormRunner, {
    problem: body.problem?.trim() || sampleProblem,
    backpack: body.backpack ?? sampleBackpack,
    subProblems: body.subProblems,
    n: body.n ?? 16,
  });
  return NextResponse.json(result);
}
