import "server-only";
import { embed, embedMany } from "./gen";
import { EMBED_MODEL, EMBED_DIMS, hasGeminiKey } from "./openai";

/**
 * Text embeddings for semantic family retrieval. Single choke point over the
 * embedding model (`MODELS.embedder` = Gemini `gemini-embedding-001` @ 1536 dims)
 * — swap the model there to change providers. Everything is best-effort: a failed
 * call returns nulls instead of throwing, so indexing/retrieval never breaks a save
 * or a turn. Usage flows through the instrumented `embed`/`embedMany` funnel.
 */

export { EMBED_DIMS };

const MAX_BATCH = 96; // stay well under provider per-request input limits

/** Embed many texts. Returns one vector per input (null where a batch failed).
 *  Empty/whitespace inputs map to null without a call. */
export async function embedTexts(texts: string[]): Promise<(number[] | null)[]> {
  const out: (number[] | null)[] = new Array(texts.length).fill(null);
  if (!hasGeminiKey() || texts.length === 0) return out;

  // Indexes of non-empty texts (skip blanks; keep original positions).
  const jobs = texts.map((t, i) => ({ i, t: t?.trim() ?? "" })).filter((j) => j.t.length > 0);

  for (let start = 0; start < jobs.length; start += MAX_BATCH) {
    const batch = jobs.slice(start, start + MAX_BATCH);
    try {
      const { embeddings } = await embedMany({
        model: EMBED_MODEL,
        values: batch.map((j) => j.t),
      });
      batch.forEach((j, k) => {
        const v = embeddings[k];
        if (Array.isArray(v)) out[j.i] = v as number[];
      });
    } catch (err) {
      console.error("[embed] batch failed", err instanceof Error ? err.message : err);
      // leave this batch's slots null; continue with the rest
    }
  }
  return out;
}

/** Embed a single query. Returns the vector, or null on failure/empty. */
export async function embedQuery(text: string): Promise<number[] | null> {
  const q = text?.trim() ?? "";
  if (!hasGeminiKey() || !q) return null;
  try {
    const { embedding } = await embed({ model: EMBED_MODEL, value: q });
    return Array.isArray(embedding) ? (embedding as number[]) : null;
  } catch (err) {
    console.error("[embed] query failed", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Embed a corpus of documents/chunks (alias for clarity at call sites). */
export const embedDocuments = embedTexts;

/** pgvector literal for a raw `<=>` query, e.g. "[0.1,0.2,...]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
