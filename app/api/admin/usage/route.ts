import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import {
  getByAgent,
  getByModel,
  getByStage,
  getByUser,
  getDistinctUsers,
  getRows,
  getStageDistribution,
  getSummary,
  parseUsageFilters,
} from "@/lib/db/usage";

export const runtime = "nodejs";

/**
 * The admin AI-usage dashboard's data source. Admin-gated (ADMIN_EMAILS). Returns,
 * over the same filtered window: SQL-aggregated summary + by-model / by-agent /
 * by-user / by-stage breakdowns, a page of raw calls, and the project stage
 * distribution (derived from moduleState).
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const filters = parseUsageFilters(url.searchParams);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 200) || 200, 1000);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);

  try {
    const [summary, byModel, byAgent, byUser, byStage, rows, stageDistribution, users] =
      await Promise.all([
        getSummary(filters),
        getByModel(filters),
        getByAgent(filters),
        getByUser(filters),
        getByStage(filters),
        getRows(filters, limit, offset),
        getStageDistribution(),
        getDistinctUsers(),
      ]);
    return NextResponse.json({ summary, byModel, byAgent, byUser, byStage, rows, stageDistribution, users });
  } catch (err) {
    console.error("[admin/usage] failed", err);
    return NextResponse.json({ error: "usage_failed", detail: String(err) }, { status: 500 });
  }
}
