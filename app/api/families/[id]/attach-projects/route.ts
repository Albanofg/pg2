import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { attachProjectToFamily } from "@/lib/db/families";

export const runtime = "nodejs";

/**
 * Bulk-attach existing Projects to this family. Per-project so one failure doesn't
 * abort the batch; not-owned (or bad) ids come back in `skipped`, not silently dropped.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { projectIds?: string[] };
  const ids = Array.isArray(body.projectIds) ? body.projectIds : [];

  const attached: string[] = [];
  const skipped: string[] = [];
  for (const pid of ids) {
    const ok = await attachProjectToFamily(pid, params.id, user.userId);
    (ok ? attached : skipped).push(pid);
  }
  return NextResponse.json({ attached, skipped });
}
