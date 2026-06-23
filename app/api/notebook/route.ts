import { NextRequest } from "next/server";
import { getLocalUser } from "@/lib/auth";
import { assertOwnership } from "@/lib/db/projects";
import { buildNotebook } from "@/lib/notebook";
import { sha256Hex } from "@/lib/crypto/rfc3161";

export const runtime = "nodejs";

/** Download the Inventor's Notebook as Markdown (GET /api/notebook?projectId=). */
export async function GET(req: NextRequest) {
  const { userId } = getLocalUser();

  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) return new Response("projectId required", { status: 400 });
  if (!(await assertOwnership(projectId, userId))) {
    return new Response("forbidden", { status: 403 });
  }

  const { content, title } = await buildNotebook(projectId);
  const withHash = `${content}\n\n---\nSHA-256: ${sha256Hex(content)}\n`;
  const filename = `${title.replace(/[^a-z0-9]+/gi, "_")}_notebook.md`;

  return new Response(withHash, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
