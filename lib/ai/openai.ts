import { createOpenAI } from "@ai-sdk/openai";

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
} as const;

export function hasOpenAIKey() {
  return !!process.env.OPENAI_API_KEY;
}

export function hasGeminiKey() {
  return !!process.env.GEMINI_API_KEY;
}
