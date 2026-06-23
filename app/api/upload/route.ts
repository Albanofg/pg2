import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getLocalUser } from "@/lib/auth";
import { assertOwnership, addContextFile } from "@/lib/db/projects";

export const runtime = "nodejs";

/**
 * Streams an uploaded context file straight to Vercel Blob, then registers it
 * against the project. The raw body IS the file (sent by use-upload.ts).
 */
export async function POST(req: NextRequest) {
  const { userId } = getLocalUser();

  const { searchParams } = new URL(req.url);
  const filename = searchParams.get("filename");
  const projectId = searchParams.get("projectId");

  if (!filename || !projectId) {
    return NextResponse.json(
      { error: "filename and projectId are required" },
      { status: 400 }
    );
  }
  if (!req.body) {
    return NextResponse.json({ error: "empty body" }, { status: 400 });
  }
  if (!(await assertOwnership(projectId, userId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not configured" },
      { status: 500 }
    );
  }

  try {
    const blob = await put(`projects/${projectId}/${filename}`, req.body, {
      access: "public",
      addRandomSuffix: true,
      contentType: req.headers.get("content-type") ?? undefined,
    });

    const size = Number(req.headers.get("content-length") ?? 0);
    await addContextFile(projectId, filename, blob.url, size);

    return NextResponse.json({ url: blob.url, name: filename });
  } catch (err) {
    console.error("[upload] failed", err);
    return NextResponse.json(
      { error: "upload_failed", detail: String(err) },
      { status: 500 }
    );
  }
}
