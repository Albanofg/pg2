import { NextResponse } from "next/server";
import { loadShowcase, saveShowcase } from "@/lib/modules/showcase/registry";
import { DiagramApiError, generateFiguresFromPlan, warmDiagrams } from "@/lib/modules/showcase/diagrams";

export const runtime = "nodejs";
// A cold start (~50–60s) plus a heavy multi-figure render can push a single call
// past 2 minutes, so give the function generous headroom — it must exceed the
// client fetch timeout (180s) so our own AbortSignal fires first with a clean
// error, rather than the platform killing the function. (Requires a Vercel plan
// that allows it; Hobby caps at 60s — see the note in the panel/README.)
export const maxDuration = 300;

/**
 * Generate the ICB's figures — PLAN MODE. app 2 plans the figure set (the
 * figure-planner agent: figure set + numeral ledger + a grounded description per
 * figure), the diagram service only DRAWS the plan, and we fuse each rendered
 * figure with its plan-authored description and persist it on the project (so it's
 * a permanent, re-viewable part of the ICB). The API key stays server-side.
 * `{ warm: true }` just boots the (sleep-after-idle) service ahead of a real run.
 */
export async function POST(req: Request) {
  let body: { projectId?: string; warm?: boolean };
  try {
    body = (await req.json()) as { projectId?: string; warm?: boolean };
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (body.warm) {
    await warmDiagrams();
    return NextResponse.json({ ok: true });
  }

  const { projectId } = body;
  if (!projectId) {
    return NextResponse.json({ error: "projectId_required" }, { status: 400 });
  }

  try {
    const engine = await loadShowcase(projectId);
    if (!engine) {
      return NextResponse.json(
        { error: "no_showcase", detail: "Complete the last part before generating diagrams." },
        { status: 409 },
      );
    }

    const keyConcepts = engine.finish();
    const disclosure = engine.getDisclosure() ?? [];
    if (!keyConcepts.length && !disclosure.length) {
      return NextResponse.json(
        { error: "no_content", detail: "There isn't enough drafted content to generate diagrams yet." },
        { status: 409 },
      );
    }

    // Plan → draw → fuse descriptions, all inside the engine. Persist the result.
    const view = await engine.generateDrawings((plan) => generateFiguresFromPlan(plan));
    await saveShowcase(projectId, engine);

    if (!view.drawings.length) {
      return NextResponse.json(
        {
          error: "no_figures",
          detail: "We couldn't derive any figures from this draft — try adding more concrete components and how they connect.",
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ drawings: view.drawings });
  } catch (err) {
    if (err instanceof DiagramApiError) {
      // A 400 is deterministic (text too short / nothing drawable) — a content
      // problem the user can fix.
      if (err.status === 400) {
        console.warn("[showcase/diagrams] undrawable draft", err.message);
        return NextResponse.json(
          {
            error: "undrawable",
            detail: "We couldn't derive figures from this draft yet — try fleshing out the components and how they connect, then generate again.",
          },
          { status: 422 },
        );
      }
      // 401/403 = wrong/missing API key — a config problem. Not user-fixable; log
      // the real cause explicitly so it's obvious in the server output.
      if (err.status === 401 || err.status === 403) {
        console.error(
          "[showcase/diagrams] auth rejected — check PATENTGEYSER_API_KEY in the environment",
          err.status,
        );
        return NextResponse.json(
          { error: "diagram_auth", detail: "Couldn't reach the diagram service (authentication). Please try again shortly." },
          { status: 502 },
        );
      }
      // 504 = our own client timeout: the render ran longer than we waited.
      if (err.status === 504) {
        console.error("[showcase/diagrams] timed out waiting for the render");
        return NextResponse.json(
          { error: "diagram_timeout", detail: "The diagrams are taking longer than usual to render. Please try again in a moment." },
          { status: 504 },
        );
      }
      console.error("[showcase/diagrams] upstream error", err.status, err.message);
      return NextResponse.json(
        {
          error: "diagram_service",
          detail: "The diagram service is unavailable or still warming up. Please try again in a moment.",
        },
        { status: 502 },
      );
    }
    console.error("[showcase/diagrams] failed", err);
    return NextResponse.json(
      { error: "diagrams_failed", detail: "Couldn't generate diagrams just now. Please try again in a moment." },
      { status: 500 },
    );
  }
}
