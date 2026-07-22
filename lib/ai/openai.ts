import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

/**
 * Central model registry (multi-provider).
 *
 * OpenAI drives the structured agents. Deep cross-verification runs on Google
 * Gemini, reached through Google's OpenAI-compatible endpoint — so we reuse the
 * @ai-sdk/openai client and need no extra provider package.
 */

/**
 * Reasoning-style models — the whole gpt-5.6 family (sol / terra / luna) plus gpt-5.5.
 * They (a) reject a custom `temperature`/`topP` — stripped in lib/ai/gen.ts — and
 * (b) require `reasoning_effort: "none"` to use function tools (structured output) on
 * /v1/chat/completions, which is how the agents get schemas. gpt-5.4 is NOT reasoning.
 */
export function isReasoningModel(modelId: string | undefined): boolean {
  return !!modelId && (modelId.startsWith("gpt-5.6-") || modelId === "gpt-5.5");
}

/**
 * The installed @ai-sdk/openai (0.0.66) predates reasoning models — it can't send
 * `reasoning_effort`. So inject it into the request body at the fetch layer for
 * reasoning models (and belt-and-suspenders strip temperature/top_p). Without this,
 * OpenAI applies its own non-none default and rejects our function-tool calls.
 */
const reasoningFetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  if (init?.body && typeof init.body === "string") {
    try {
      const body = JSON.parse(init.body);
      if (body && typeof body.model === "string" && isReasoningModel(body.model)) {
        body.reasoning_effort = "none";
        delete body.temperature;
        delete body.top_p;
        init = { ...init, body: JSON.stringify(body) };
      }
    } catch {
      /* non-JSON body — pass through untouched */
    }
  }
  return fetch(input, init);
}) as typeof fetch;

export const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  fetch: reasoningFetch,
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
 * Model tiers, mapped by requirement onto the gpt-5.6 family:
 *  - verifier  → gpt-5.6-sol   (MAX capability: deep verification, grading, patentability)
 *  - helper/drafter → gpt-5.6-terra (BALANCED cost/perf: conversation + all structured drafting)
 *  - distiller → gpt-5.6-luna  (FAST/cheap: bulk stubs, classifiers, high-volume)
 * All are reasoning models, so custom temperature is stripped (lib/ai/gen.ts) and
 * `reasoning_effort: "none"` is injected via the client `fetch` above (the old SDK can't
 * set it) — that also keeps them fast. Gemini stays ONLY for what these can't do:
 * multimodal PDF reading (geminiFlashNative) + embeddings (EMBED_MODEL).
 * NOTE: verification now runs on the same model FAMILY it checks — the old
 * cross-provider (Gemini-verifies-OpenAI) safeguard is gone; flag if that matters.
 */
export const MODELS = {
  helper: openai("gpt-5.6-terra"),
  drafter: openai("gpt-5.6-terra"),
  verifier: openai("gpt-5.6-sol"),
  distiller: openai("gpt-5.6-luna"),
  // Gemini handles kept for the reference-doc / multimodal paths only.
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
