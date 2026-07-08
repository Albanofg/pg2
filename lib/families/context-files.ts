import "server-only";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { projectFamilyContextFiles, projectFamilyContextFileChunks } from "@/db/schema";
import { generateObject, generateText } from "@/lib/ai/gen";
import { embedDocuments } from "@/lib/ai/embed";
import { MODELS } from "@/lib/ai/openai";

/**
 * Family reference documents — the upload → extract → summarize pipeline and the
 * owner-scoped CRUD around it. A file is uploaded once per family (PDF/DOCX), its
 * text extracted, then AI-summarized to one line. Extraction mirrors V1: a PDF is
 * sent inline to Gemini (which reads it and summarizes in one call — so scanned
 * PDFs work too); a DOCX is read locally (mammoth), since Gemini rejects the
 * Office MIME as inline data, then summarized. The Helper reads the summary (and,
 * budgeted, the full text) as background — citing by name, never lifting. UPL-safe
 * throughout: "reference documents", never "prior art".
 */

export const PDF_MIME = "application/pdf";
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

export type DocKind = "pdf" | "docx";

/** Decide the parser by file extension first (browsers misreport DOCX MIME), then
 *  fall back to the reported MIME. Returns null for anything we can't extract. */
export function docKind(filename: string, mimeType: string): DocKind | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pdf")) return "pdf";
  if (mimeType === DOCX_MIME) return "docx";
  if (mimeType === PDF_MIME) return "pdf";
  return null;
}

const GENERIC_SUMMARY = "Reference document (summary unavailable).";

/** Read a DOCX to plain text locally (mammoth pulls the <w:t> runs). Gemini can't
 *  ingest the Office MIME as inline data, so DOCX never touches the model here. */
async function extractDocx(buffer: Buffer): Promise<string> {
  const { extractRawText } = await import("mammoth");
  const result = await extractRawText({ buffer });
  return (result.value ?? "").trim();
}

const PdfExtract = z.object({
  extractedText: z
    .string()
    .describe("The document's full text, verbatim, in reading order. Empty string if unreadable."),
  summary: z
    .string()
    .describe("ONE plain factual sentence (max 40 words): what the document is and its core subject."),
});

/** Read a PDF inline with native Gemini — extracts full text + a one-line summary
 *  in a single call (so scanned/image PDFs still yield text). Mirrors V1. */
async function extractPdfWithGemini(
  filename: string,
  buffer: Buffer,
): Promise<{ extractedText: string; summary: string }> {
  const { object } = await generateObject({
    model: MODELS.geminiFlashNative,
    schema: PdfExtract,
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `Read this reference document (${filename}) that the inventor attached as background.`,
              "Return its full text verbatim in reading order, plus ONE plain factual sentence saying what it is.",
              "Be neutral. Do NOT draw legal conclusions; do NOT say patentable / prior art / novel.",
            ].join("\n"),
          },
          { type: "file", data: buffer, mimeType: "application/pdf" },
        ],
      },
    ],
  });
  return {
    extractedText: object.extractedText.trim(),
    summary: object.summary.trim().replace(/\s+/g, " "),
  };
}

/** One-line, UPL-safe summary of already-extracted text (the DOCX path). Never
 *  fails the ingest — callers fall back to a generic label if this throws. */
async function summarizeText(filename: string, text: string): Promise<string> {
  const { text: summary } = await generateText({
    model: MODELS.geminiFlash,
    temperature: 0.2,
    prompt: [
      "You summarize a reference document the inventor attached as background.",
      "Write ONE plain sentence (max 40 words): what the document is and its core subject.",
      "Be factual and neutral. Do NOT draw legal conclusions, do NOT say patentable / prior art / novel.",
      "",
      `FILENAME: ${filename}`,
      "DOCUMENT TEXT (may be truncated):",
      text.slice(0, 6000) || "(no extractable text)",
    ].join("\n"),
  });
  return summary.trim().replace(/\s+/g, " ");
}

/** Split extracted text into overlapping chunks for embedding. Whitespace is
 *  collapsed for consistent chunk sizes; capped so a huge document can't explode. */
function chunkText(
  text: string,
  { size = 1200, overlap = 200, maxChunks = 200 } = {},
): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < maxChunks) {
    const end = Math.min(start + size, clean.length);
    chunks.push(clean.slice(start, end));
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return chunks;
}

/** Chunk + embed a file's extracted text into the semantic-retrieval corpus.
 *  Best-effort: replaces any prior chunks; a failure leaves the file usable via its
 *  summary. Runs AFTER the file is marked `ok`, so a timeout here never loses text. */
export async function indexFileChunks(
  fileId: string,
  familyId: string,
  filename: string,
  text: string,
): Promise<void> {
  try {
    await db
      .delete(projectFamilyContextFileChunks)
      .where(eq(projectFamilyContextFileChunks.fileId, fileId));
    const chunks = chunkText(text);
    if (!chunks.length) return;
    const vectors = await embedDocuments(chunks);
    const values = chunks.map((content, i) => ({
      fileId,
      familyId,
      filename,
      chunkIndex: i,
      content,
      embedding: vectors[i] ?? null,
    }));
    // Insert in batches to keep each neon-http statement small.
    for (let i = 0; i < values.length; i += 50) {
      await db.insert(projectFamilyContextFileChunks).values(values.slice(i, i + 50));
    }
  } catch (err) {
    console.error("[context-files] chunk indexing failed", err instanceof Error ? err.message : err);
  }
}

/**
 * Run extraction + summarization for a freshly-uploaded file and write the result.
 * PDF goes to Gemini inline (text + summary together); DOCX is read locally then
 * summarized. A summarization failure still marks the row `ok` (we have the text);
 * only an extraction failure (unreadable / empty document) marks it `failed`. On
 * success the text is chunked + embedded for semantic retrieval (best-effort).
 */
export async function ingestContextFile(
  fileId: string,
  familyId: string,
  kind: DocKind,
  filename: string,
  buffer: Buffer,
): Promise<void> {
  try {
    let text = "";
    let summary = GENERIC_SUMMARY;

    if (kind === "pdf") {
      const r = await extractPdfWithGemini(filename, buffer);
      text = r.extractedText;
      if (r.summary) summary = r.summary;
    } else {
      text = await extractDocx(buffer);
      if (text) {
        try {
          const s = await summarizeText(filename, text);
          if (s) summary = s;
        } catch (err) {
          console.error("[context-files] summarize failed", err);
        }
      }
    }

    if (!text) {
      await db
        .update(projectFamilyContextFiles)
        .set({
          extractionStatus: "failed",
          extractionError: "No extractable text (the document may be scanned or empty).",
          updatedAt: new Date(),
        })
        .where(eq(projectFamilyContextFiles.id, fileId));
      return;
    }

    await db
      .update(projectFamilyContextFiles)
      .set({
        extractedText: text,
        summary,
        extractionStatus: "ok",
        extractionError: null,
        updatedAt: new Date(),
      })
      .where(eq(projectFamilyContextFiles.id, fileId));

    // Semantic index (best-effort; the file is already `ok` and usable without it).
    await indexFileChunks(fileId, familyId, filename, text);
  } catch (err) {
    await db
      .update(projectFamilyContextFiles)
      .set({
        extractionStatus: "failed",
        extractionError: err instanceof Error ? err.message : String(err),
        updatedAt: new Date(),
      })
      .where(eq(projectFamilyContextFiles.id, fileId));
  }
}

/** Insert a pending file row (before extraction runs). */
export async function createContextFile(input: {
  familyId: string;
  uploadedByUserId: string;
  filename: string;
  mimeType: string;
  blobUrl: string;
  sizeBytes: number;
}) {
  const [row] = await db
    .insert(projectFamilyContextFiles)
    .values({
      familyId: input.familyId,
      uploadedByUserId: input.uploadedByUserId,
      filename: input.filename,
      mimeType: input.mimeType,
      blobUrl: input.blobUrl,
      sizeBytes: input.sizeBytes,
      extractionStatus: "pending",
    })
    .returning();
  return row;
}

/** Metadata-only list for a family (never ships extracted_text). Newest first. */
export async function listContextFiles(familyId: string) {
  return db
    .select({
      id: projectFamilyContextFiles.id,
      filename: projectFamilyContextFiles.filename,
      mimeType: projectFamilyContextFiles.mimeType,
      sizeBytes: projectFamilyContextFiles.sizeBytes,
      summary: projectFamilyContextFiles.summary,
      extractionStatus: projectFamilyContextFiles.extractionStatus,
      extractionError: projectFamilyContextFiles.extractionError,
      createdAt: projectFamilyContextFiles.createdAt,
    })
    .from(projectFamilyContextFiles)
    .where(
      and(
        eq(projectFamilyContextFiles.familyId, familyId),
        isNull(projectFamilyContextFiles.deletedAt),
      ),
    )
    .orderBy(desc(projectFamilyContextFiles.createdAt));
}

/** A single file (full row) if it belongs to the family and isn't deleted. */
export async function getContextFile(fileId: string, familyId: string) {
  const [row] = await db
    .select()
    .from(projectFamilyContextFiles)
    .where(
      and(
        eq(projectFamilyContextFiles.id, fileId),
        eq(projectFamilyContextFiles.familyId, familyId),
        isNull(projectFamilyContextFiles.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Soft-delete a file (must belong to the family). Returns false if not found.
 *  Its embedding chunks are hard-deleted so they leave the retrieval corpus. */
export async function softDeleteContextFile(fileId: string, familyId: string) {
  const existing = await getContextFile(fileId, familyId);
  if (!existing) return false;
  await db
    .update(projectFamilyContextFiles)
    .set({ deletedAt: new Date() })
    .where(eq(projectFamilyContextFiles.id, fileId));
  await db
    .delete(projectFamilyContextFileChunks)
    .where(eq(projectFamilyContextFileChunks.fileId, fileId));
  return true;
}

/** Reference files shaped for the Helper's FAMILY CONTEXT block — includes the
 *  full extracted text (the caller budgets it). Newest first. */
export async function getContextFilesForPrompt(familyId: string) {
  return db
    .select({
      id: projectFamilyContextFiles.id,
      filename: projectFamilyContextFiles.filename,
      summary: projectFamilyContextFiles.summary,
      extractionStatus: projectFamilyContextFiles.extractionStatus,
      extractedText: projectFamilyContextFiles.extractedText,
    })
    .from(projectFamilyContextFiles)
    .where(
      and(
        eq(projectFamilyContextFiles.familyId, familyId),
        isNull(projectFamilyContextFiles.deletedAt),
      ),
    )
    .orderBy(desc(projectFamilyContextFiles.createdAt));
}
