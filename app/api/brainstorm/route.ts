import { NextResponse } from "next/server";
import { runBrainstormEngine } from "@/lib/modules/brainstorm/engine";
import { brainstormRunner } from "@/lib/modules/brainstorm/runner.openai";
import { sampleBackpack, sampleProblem } from "@/lib/modules/brainstorm/fixtures";
import type { Backpack, SubProblem } from "@/lib/modules/brainstorm/types";

/**
 * Dev harness for the Module 0 backstage engine — runs the whole pipeline (grid →
 * generate → score → select frontier → trace → reverse) and returns the result.
 *
 *   GET  /api/brainstorm                 → runs on the sample problem + backpack
 *   POST /api/brainstorm { problem, backpack?, subProblems?, n? }
 *
 * Disabled in production: it is an unauthenticated, token-spending demo endpoint.
 * The real entry point will be the front-of-house Socratic panel.
 */
export const maxDuration = 300;

function blockInProd() {
  return process.env.NODE_ENV === "production"
    ? NextResponse.json({ error: "disabled in production" }, { status: 404 })
    : null;
}

export async function GET() {
  const blocked = blockInProd();
  if (blocked) return blocked;
  const result = await runBrainstormEngine(brainstormRunner, {
    problem: sampleProblem,
    backpack: sampleBackpack,
    n: 16,
  });
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const blocked = blockInProd();
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as {
    problem?: string;
    backpack?: Backpack;
    subProblems?: SubProblem[];
    n?: number;
  };
  const result = await runBrainstormEngine(brainstormRunner, {
    problem: body.problem?.trim() || sampleProblem,
    backpack: body.backpack ?? sampleBackpack,
    subProblems: body.subProblems,
    n: body.n ?? 16,
  });
  return NextResponse.json(result);
}
