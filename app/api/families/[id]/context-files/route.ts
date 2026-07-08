import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getSessionUser } from "@/lib/auth";
import { getFamily } from "@/lib/db/families";
import {
  createContextFile,
  docKind,
  ingestContextFile,
  listContextFiles,
  MAX_UPLOAD_BYTES,
} from "@/lib/families/context-files";

export const runtime = "nodejs";
export const maxDuration = 60; // extraction + one summary call

/** GET /api/families/:id/context-files — metadata-only list (no extracted text). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await getFamily(params.id, user.userId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const files = await listContextFiles(params.id);
  return NextResponse.json({ files });
}

/**
 * POST /api/families/:id/context-files?filename=… — the raw body IS the file
 * (PDF/DOCX). Streams it to Vercel Blob, registers it, then extracts + summarizes
 * synchronously so the row is `ok`/`failed` by the time we respond.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!(await getFamily(params.id, user.userId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const filename = new URL(req.url).searchParams.get("filename");
  if (!filename) {
    return NextResponse.json({ error: "filename is required" }, { status: 400 });
  }
  if (!req.body) {
    return NextResponse.json({ error: "empty body" }, { status: 400 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN not configured" }, { status: 500 });
  }

  const mimeType = req.headers.get("content-type") ?? "";
  const kind = docKind(filename, mimeType);
  if (!kind) {
    return NextResponse.json(
      { error: "unsupported_type", detail: "Only PDF and DOCX files are supported." },
      { status: 415 },
    );
  }

  const buffer = Buffer.from(await req.arrayBuffer());
  if (buffer.byteLength === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "too_large", detail: "Files must be 15 MB or smaller." },
      { status: 413 },
    );
  }

  try {
    const blob = await put(`families/${params.id}/${filename}`, buffer, {
      access: "public",
      addRandomSuffix: true,
      contentType: mimeType || undefined,
    });

    const row = await createContextFile({
      familyId: params.id,
      uploadedByUserId: user.userId,
      filename,
      mimeType: mimeType || (kind === "pdf" ? "application/pdf" : "application/octet-stream"),
      blobUrl: blob.url,
      sizeBytes: buffer.byteLength,
    });

    await ingestContextFile(row.id, params.id, kind, filename, buffer);

    // Return fresh metadata (post-extraction) so the client shows the final state.
    const files = await listContextFiles(params.id);
    const file = files.find((f) => f.id === row.id) ?? null;
    return NextResponse.json({ file });
  } catch (err) {
    console.error("[context-files] upload failed", err);
    return NextResponse.json({ error: "upload_failed", detail: String(err) }, { status: 500 });
  }
}
