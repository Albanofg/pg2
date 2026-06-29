import "server-only";

/**
 * The market-retrieval seam — how Module 0 grounds its competitive "market read"
 * in the real world at the ideation moment (the differentiator: nobody else
 * front-loads market + competitive intelligence when the idea is first typed).
 *
 * Real web search runs through **Gemini's native Google Search grounding** — a
 * plain call to the generativelanguage endpoint with the `google_search` tool,
 * reusing GEMINI_API_KEY (no Tavily, no new key, no orchestrator). We use the
 * native endpoint directly because the app reaches Gemini elsewhere via the
 * OpenAI-compat shim, which does NOT expose grounding.
 *
 * With no key, it returns no evidence and the market-analyst falls back to the
 * model's own knowledge, clearly marked `confidence: "model"` so we never dress an
 * unverified guess as a finding. Swapping providers (Tavily, Exa, Brave, an
 * internal corpus) is a one-function change here.
 */

export type MarketEvidence = { title: string; url: string; snippet: string }[];

/** Cheap Gemini model that supports the google_search grounding tool. */
const GROUNDING_MODEL = "gemini-2.5-flash";

/** True when a real search provider is wired (so the read can be "searched", not "model"). */
export function marketSearchEnabled(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

type GeminiGroundingResponse = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    groundingMetadata?: {
      groundingChunks?: { web?: { uri?: string; title?: string } }[];
    };
  }[];
};

export async function searchMarket(query: string): Promise<MarketEvidence> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GROUNDING_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text:
                    `Search the web for existing products, apps, tools, and companies relevant to: ${query}. ` +
                    `List the real ones you find and, for each, one line on what it does. Only real, verifiable products.`,
                },
              ],
            },
          ],
          tools: [{ google_search: {} }],
        }),
      },
    );
    if (!res.ok) {
      console.error("[brainstorm] gemini grounding failed", res.status);
      return [];
    }
    const data = (await res.json()) as GeminiGroundingResponse;
    const cand = data.candidates?.[0];
    const summary = (cand?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join(" ")
      .trim();
    const sources: MarketEvidence = (cand?.groundingMetadata?.groundingChunks ?? [])
      .map((c) => c.web)
      .filter((w): w is { uri: string; title?: string } => !!w?.uri)
      .map((w) => ({ title: w.title ?? "", url: w.uri, snippet: "" }));

    // The grounded synthesis carries the real signal; the source links back it up.
    const evidence: MarketEvidence = summary
      ? [{ title: "Grounded summary", url: "", snippet: summary }, ...sources]
      : sources;
    return evidence;
  } catch (err) {
    console.error("[brainstorm] gemini grounding error", err);
    return [];
  }
}
