import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

/**
 * Central model registry (multi-provider).
 *
 * OpenAI (gpt-4o family) drives the structured agents. Deep cross-verification
 * runs on Google Gemini, reached through Google's OpenAI-compatible endpoint —
 * so we reuse the @ai-sdk/openai client and need no extra provider package.
 */
export const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Gemini via Google's OpenAI-compatible API. Uses GEMINI_API_KEY. Marked
 * `compatible` so the client doesn't send OpenAI-only request fields.
 */
export const gemini = createOpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  compatibility: "compatible",
});

/**
 * Gemini through Google's NATIVE endpoint (not the OpenAI-compat shim). Needed for
 * multimodal file input — the compat endpoint can't ingest a PDF as inline data,
 * but the native provider maps a `file` message part to Gemini `inlineData`. Used
 * only for reading uploaded reference documents (PDF text extraction).
 */
export const googleNative = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/** Embedding vector dimension — must match the `vector(N)` DB columns + Neon DDL. */
export const EMBED_DIMS = 1536;

/**
 * Model choices (verified against the live keys on 2026-06-22):
 *  - gpt-5.4 / gpt-5.4-mini accept a custom `temperature` (which the agents and
 *    the deterministic boundary gate rely on). The newer gpt-5.5 is a reasoning
 *    model that only allows the default temperature, so we don't use it here.
 *  - Deep inventorship verification runs on Gemini 2.5 Pro (replacing the old,
 *    inaccessible o1-preview).
 */
export const MODELS = {
  helper: openai("gpt-5.4"),
  drafter: openai("gpt-5.4"),
  verifier: gemini("gemini-2.5-pro"),
  distiller: openai("gpt-5.4-mini"),
  // Available Gemini handles for agents that want them.
  geminiPro: gemini("gemini-2.5-pro"),
  geminiFlash: gemini("gemini-2.5-flash"),
  // Native Gemini flash — multimodal (reads PDF inline data). Reference-doc extraction.
  geminiFlashNative: googleNative("gemini-2.5-flash"),
} as const;

/**
 * The embedding model — kept OUT of `MODELS` (which is the language-model registry
 * the module runners map over) so its `EmbeddingModelV1` type doesn't widen that
 * union. Google's flagship embedder, truncated to 1536 dims (native 3072) so vectors
 * fit under pgvector's ≤2000-dim HNSW index limit. Semantic family retrieval.
 */
export const EMBED_MODEL = googleNative.textEmbeddingModel("gemini-embedding-001", {
  outputDimensionality: EMBED_DIMS,
});

export function hasOpenAIKey() {
  return !!process.env.OPENAI_API_KEY;
}

export function hasGeminiKey() {
  return !!process.env.GEMINI_API_KEY;
}
