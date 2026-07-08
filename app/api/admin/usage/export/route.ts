import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { getExportRows, parseUsageFilters } from "@/lib/db/usage";

export const runtime = "nodejs";

/** CSV export of AI-usage rows over the same filters (hard-capped at 50k rows). */
function csvCell(v: unknown): string {
  const s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const filters = parseUsageFilters(url.searchParams);

  try {
    const rows = await getExportRows(filters);
    const header = [
      "createdAt",
      "userEmail",
      "userId",
      "projectId",
      "stage",
      "agentLabel",
      "agentCode",
      "model",
      "provider",
      "inputTokens",
      "outputTokens",
      "cachedTokens",
      "totalTokens",
      "durationMs",
      "status",
      "errorMessage",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.createdAt,
          r.userEmail,
          r.userId,
          r.projectId,
          r.stage,
          r.agentLabel,
          r.agentCode,
          r.model,
          r.provider,
          r.inputTokens,
          r.outputTokens,
          r.cachedTokens,
          r.totalTokens,
          r.durationMs,
          r.status,
          r.errorMessage,
        ]
          .map(csvCell)
          .join(","),
      );
    }
    return new Response(lines.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="ai-usage.csv"',
      },
    });
  } catch (err) {
    console.error("[admin/usage/export] failed", err);
    return NextResponse.json({ error: "export_failed", detail: String(err) }, { status: 500 });
  }
}
