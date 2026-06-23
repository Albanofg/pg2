import "server-only";
import type { LandscapeSource, PriorArtSearch } from "./types";

/**
 * Reference prior-art search: POSTs ALL concepts in one batch to the n8n
 * `multi-concept-search` workflow and maps the results to LandscapeSource[]
 * keyed by concept id. The Helper may swap this for any other implementation;
 * Module 3 only depends on the PriorArtSearch seam.
 *
 * Set the workflow URL in .env.local:  LANDSCAPE_SEARCH_URL=...
 *
 * Request body the workflow reads (confirmed against the live v1 workflow):
 *   { sessionId, category, limit, concepts: [{ id, concept }] }
 * where `concept` is the text searched.
 *
 * Response (tolerant — accepts the object or a single-element array wrapping it):
 *   { timestamp, total_concepts, total_patents,
 *     results: { "<concept text>": [ { rank, publication_number, title,
 *                                      abstract, distance_score, patent_url } ] } }
 * `results` is keyed by the concept TEXT we sent, so we map each back to its id.
 * `distance_score` is a DISTANCE (lower = closer) — inverted into closeness.
 */
export const n8nPriorArtSearch: PriorArtSearch = async (input) => {
  const url = process.env.LANDSCAPE_SEARCH_URL;
  if (!url) {
    throw new Error(
      "LANDSCAPE_SEARCH_URL is not set — add your n8n webhook URL to .env.local.",
    );
  }
  if (!input.concepts.length) return {};

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: input.sessionId ?? `landscape-${Date.now()}`,
      category: input.category ?? "Software",
      limit: input.limit ?? 5,
      concepts: input.concepts.map((c) => ({ id: c.id, concept: c.concept })),
    }),
  });
  if (!res.ok) {
    throw new Error(`prior-art search failed (${res.status})`);
  }
  const data: unknown = await res.json();
  return mapBatch(data, input.concepts);
};

/* ------------------------------------------------------------------ */

function mapBatch(
  data: unknown,
  concepts: { id: string; concept: string }[],
): Record<string, LandscapeSource[]> {
  const root = Array.isArray(data) ? data[0] : data;
  const results =
    root && typeof root === "object"
      ? ((root as Record<string, unknown>).results as
          | Record<string, unknown>
          | undefined)
      : undefined;

  const out: Record<string, LandscapeSource[]> = {};
  for (const c of concepts) {
    const raw = results?.[c.concept];
    out[c.id] = Array.isArray(raw)
      ? (raw as Record<string, unknown>[]).map(toSource).filter(Boolean as unknown as (s: LandscapeSource | null) => s is LandscapeSource)
      : [];
  }
  return out;
}

function toSource(raw: Record<string, unknown>): LandscapeSource | null {
  if (!raw || typeof raw !== "object") return null;
  const title = str(raw.title);
  if (!title) return null;
  return {
    kind: "patent",
    title,
    identifier: str(raw.publication_number) ?? str(raw.patent_number),
    url: str(raw.patent_url) ?? str(raw.url),
    snippet: str(raw.abstract) ?? str(raw.snippet),
    closeness: distanceToCloseness(raw.distance_score),
  };
}

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return undefined;
}

/** distance_score is a distance (lower = closer); invert to closeness 0..1. */
function distanceToCloseness(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  if (Number.isNaN(n)) return undefined;
  return Math.min(1, Math.max(0, 1 - n));
}
