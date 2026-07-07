import "server-only";
import type { DiagramFigure, FigurePlan, PlanFigureResult } from "./types";

/**
 * Diagram generation seam — sends the assembled draft text to the external
 * PatentGeyser diagram service and returns a set of figures (SVG for display +
 * base64 PDF for download). Stateless: one request in, figures out.
 *
 * The service runs on Render's free tier and sleeps after idle, so the first
 * call after a cold start can take ~50–60s — hence the 60s timeout and the
 * best-effort `warmDiagrams()` health ping.
 *
 * Configure in .env.local (SERVER-ONLY — never a NEXT_PUBLIC_* var; the key must
 * never reach the browser):
 *   PATENTGEYSER_API_URL=https://patentgeyser-api.onrender.com
 *   PATENTGEYSER_API_KEY=<the shared secret>
 *
 * Contract (see the diagram service's INTEGRATION.md):
 *   POST {url}/api/v1/generate   header X-API-Key: <key>   body { text }
 *     → 200 { figures: [{ id, title, svgData, pdfBase64 }] }   (1–8 figures)
 *     → 400 text < 20 chars, or nothing drawable  (deterministic — don't retry)
 *     → 401 bad key   422 malformed body   500 server   502/503 asleep/booting
 */

// A full 8-figure render (with the service's multi-pass layout auditing) can run
// well past a minute even on a warm container — the 60s "cold start" budget from
// the integration guide is only for the boot, not the render. Give it real room.
const GENERATE_TIMEOUT_MS = 180_000; // 3 min — render headroom, not just cold start
const WARM_TIMEOUT_MS = 10_000;

/** An upstream (diagram service) failure, carrying the HTTP status for mapping. */
export class DiagramApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DiagramApiError";
    this.status = status;
  }
}

/** Read + normalize the service config, or throw a clear setup error. */
function config(): { url: string; key: string } {
  const url = process.env.PATENTGEYSER_API_URL;
  const key = process.env.PATENTGEYSER_API_KEY;
  if (!url || !key) {
    throw new Error(
      "PATENTGEYSER_API_URL / PATENTGEYSER_API_KEY are not set — add your diagram service URL and API key to .env.local.",
    );
  }
  return { url: url.replace(/\/+$/, ""), key };
}

/**
 * Generate figures from the draft text. `text` must be ≥ 20 chars after trimming
 * (validate before calling). Throws {@link DiagramApiError} on a non-2xx upstream
 * response so the route can map deterministic 400s (undrawable text) apart from
 * transient/asleep failures.
 */
export async function generateFigures(text: string): Promise<DiagramFigure[]> {
  const { url, key } = config();

  let res: Response;
  try {
    res = await fetch(`${url}/api/v1/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });
  } catch {
    // Network error / timeout — treat as "service unreachable" (retryable).
    throw new DiagramApiError(504, "diagram service unreachable or timed out");
  }

  // Cold-start/proxy errors can return non-JSON, so guard the parse.
  const data = (await res.json().catch(() => null)) as
    | { figures?: DiagramFigure[]; detail?: unknown }
    | null;

  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : `diagram service error (${res.status})`;
    throw new DiagramApiError(res.status, detail);
  }
  return Array.isArray(data?.figures) ? (data.figures as DiagramFigure[]) : [];
}

/**
 * Plan mode: hand the diagram service a finished plan (figure set + numeral ledger)
 * and get back the figures it drew, joined by `figNumber`. This is the primary path
 * — app 2 owns the planner, the service only draws (see DIAGRAM_SERVICE_PLAN_MODE.md).
 *
 * Until the service ships `/api/v1/draw`, it responds 404/405/501; we then fall back
 * to text mode so drawings still render. The fallback sends each figure's outline
 * (which carries "LABEL (numeral)" tokens the service treats as binding), so our
 * numerals mostly survive — and become exact once plan mode is deployed.
 */
export async function generateFiguresFromPlan(plan: FigurePlan): Promise<PlanFigureResult[]> {
  const { url, key } = config();

  let res: Response;
  try {
    res = await fetch(`${url}/api/v1/draw`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ plan }),
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });
  } catch {
    throw new DiagramApiError(504, "diagram service unreachable or timed out");
  }

  // Plan mode not deployed yet → interim text-mode fallback.
  if (res.status === 404 || res.status === 405 || res.status === 501) {
    return drawViaTextFallback(plan);
  }

  const data = (await res.json().catch(() => null)) as
    | { figures?: unknown[]; detail?: unknown }
    | null;
  if (!res.ok) {
    const detail =
      typeof data?.detail === "string" ? data.detail : `diagram service error (${res.status})`;
    throw new DiagramApiError(res.status, detail);
  }
  return normalizePlanFigures(Array.isArray(data?.figures) ? data.figures : [], plan);
}

/** Coerce a plan-mode `/draw` response into PlanFigureResult[], tolerant of shape. */
function normalizePlanFigures(raw: unknown[], plan: FigurePlan): PlanFigureResult[] {
  const out: PlanFigureResult[] = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== "object") return;
    const o = item as Record<string, unknown>;
    const figNumber =
      typeof o.figNumber === "number" ? o.figNumber : plan.figures[i]?.figNumber ?? i + 1;
    const svgData = typeof o.svgData === "string" ? o.svgData : "";
    if (!svgData) return;
    const planFig = plan.figures.find((f) => f.figNumber === figNumber);
    const numerals = Array.isArray(o.numerals)
      ? (o.numerals as unknown[]).filter((n): n is string => typeof n === "string")
      : planFig?.numerals ?? [];
    out.push({
      figNumber,
      title:
        typeof o.title === "string" && o.title ? o.title : planFig?.title ?? `Figure ${figNumber}`,
      svgData,
      pdfBase64: typeof o.pdfBase64 === "string" ? o.pdfBase64 : "",
      numerals,
    });
  });
  return out;
}

/** Interim: draw via the existing text endpoint, mapping results to plan figures. */
async function drawViaTextFallback(plan: FigurePlan): Promise<PlanFigureResult[]> {
  const text = plan.figures.map((f) => [f.title, f.outline.trim()].join("\n")).join("\n\n").trim();
  const figs = await generateFigures(text.length >= 20 ? text : `${text}\n\n(figure set)`);
  return figs.map((f, i) => {
    const planFig = plan.figures[i];
    return {
      figNumber: planFig?.figNumber ?? i + 1,
      title: planFig?.title || f.title,
      svgData: f.svgData,
      pdfBase64: f.pdfBase64,
      numerals: planFig?.numerals ?? [],
    };
  });
}

/**
 * Best-effort warm-up: the service sleeps after idle, so a cheap GET /health when
 * the user opens the final stage boots the container ahead of the real request.
 * Never throws — warming is optional and failures are silent.
 */
export async function warmDiagrams(): Promise<void> {
  const url = process.env.PATENTGEYSER_API_URL;
  if (!url) return;
  try {
    await fetch(`${url.replace(/\/+$/, "")}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(WARM_TIMEOUT_MS),
    });
  } catch {
    // ignore — best effort
  }
}
