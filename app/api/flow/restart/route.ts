import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { saveModuleState, type ModuleStateBlob } from "@/lib/modules/persistence";

/**
 * Cascade restart. Going back to an earlier part of the process and changing your
 * thinking invalidates every part built on top of it — Maturation is derived from
 * Conception, Landscape from Maturation, and so on. So restarting stage N clears
 * the saved state of every stage AFTER N (this endpoint), while the stage itself
 * is re-initialized by its own panel. Downstream stages re-seed from the fresh
 * upstream the next time they're opened.
 */
export const runtime = "nodejs";

// The pipeline order. A stage depends on everything before it.
const ORDER = ["conception", "maturation", "landscape", "differentiation", "showcase"] as const;
type Stage = (typeof ORDER)[number];

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    fromStage?: string;
  };
  if (!body.projectId) {
    return NextResponse.json({ error: "projectId_required" }, { status: 400 });
  }
  const fromIndex = ORDER.indexOf(body.fromStage as Stage);
  if (fromIndex < 0) {
    return NextResponse.json({ error: "invalid_stage" }, { status: 400 });
  }

  // Everything strictly AFTER the target stage — those are the parts built on it.
  const downstream = ORDER.slice(fromIndex + 1);
  if (downstream.length === 0) {
    return NextResponse.json({ cleared: [] });
  }
  const patch: ModuleStateBlob = {};
  for (const key of downstream) patch[key] = null;

  try {
    await saveModuleState(body.projectId, patch);
    return NextResponse.json({ cleared: downstream });
  } catch (err) {
    console.error("[flow/restart] failed", err);
    return NextResponse.json({ error: "restart_failed", detail: String(err) }, { status: 500 });
  }
}
