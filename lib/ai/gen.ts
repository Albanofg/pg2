import "server-only";
import {
  generateObject as _generateObject,
  generateText as _generateText,
  streamText as _streamText,
} from "ai";
import { recordUsage } from "./usage-log";
import { getUsageContext } from "./usage-context";

/**
 * Instrumented drop-in replacements for the AI SDK's `generateObject` /
 * `generateText` / `streamText`. Every server-side AI call imports these instead of
 * `"ai"`, so token usage is captured through the single `recordUsage` funnel.
 * Signatures are identical to the SDK's (typed via `typeof`), so call sites keep
 * full inference. Logging never affects the call's result or errors.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

function modelOf(opts: any): { model: string; provider?: string } {
  const m = opts?.model;
  return { model: (m?.modelId as string) ?? "unknown", provider: m?.provider as string | undefined };
}

function tokensOf(result: any): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
} {
  const u = result?.usage ?? {};
  const input = u.promptTokens ?? u.inputTokens ?? 0;
  const output = u.completionTokens ?? u.outputTokens ?? 0;
  const total = u.totalTokens ?? input + output;
  const pm = result?.providerMetadata ?? result?.experimental_providerMetadata ?? {};
  const cached = pm?.openai?.cachedPromptTokens ?? pm?.openai?.cachedTokens ?? u.cachedInputTokens ?? 0;
  return { inputTokens: input, outputTokens: output, totalTokens: total, cachedTokens: cached };
}

export const generateObject: typeof _generateObject = (async (opts: any) => {
  const start = Date.now();
  const info = modelOf(opts);
  try {
    const result: any = await _generateObject(opts);
    recordUsage({ ...info, ...tokensOf(result), durationMs: Date.now() - start, status: "ok" });
    return result;
  } catch (e) {
    recordUsage({
      ...info,
      durationMs: Date.now() - start,
      status: "error",
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}) as any;

export const generateText: typeof _generateText = (async (opts: any) => {
  const start = Date.now();
  const info = modelOf(opts);
  try {
    const result: any = await _generateText(opts);
    recordUsage({ ...info, ...tokensOf(result), durationMs: Date.now() - start, status: "ok" });
    return result;
  } catch (e) {
    recordUsage({
      ...info,
      durationMs: Date.now() - start,
      status: "error",
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}) as any;

export const streamText: typeof _streamText = ((opts: any) => {
  const start = Date.now();
  const info = modelOf(opts);
  // usage/context are lost inside the post-stream .then, so snapshot the context now.
  const ctx = getUsageContext();
  const result: any = _streamText(opts);
  Promise.resolve(result?.usage)
    .then((u: any) =>
      recordUsage(
        { ...info, ...tokensOf({ usage: u }), durationMs: Date.now() - start, status: "ok" },
        ctx,
      ),
    )
    .catch(() => {});
  return result;
}) as any;
