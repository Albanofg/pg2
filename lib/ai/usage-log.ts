import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aiUsageLog, projects, users } from "@/db/schema";
import { getUsageContext, type UsageContext } from "./usage-context";

/**
 * The single AI-usage funnel. `recordUsage` is fire-and-forget and wrapped in
 * try/catch so a broken usage table can NEVER break an actual AI request — it only
 * `console.warn`s on failure. Attribution (user/project/stage/agent) comes from the
 * AsyncLocalStorage usage context; token counts + model come from the caller.
 */

export type RecordUsageInput = {
  model: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  status?: "ok" | "error";
  errorMessage?: string;
  metadata?: Record<string, unknown>;
};

/** Stable agent-code → friendly label. Unknown codes fall back to a title-cased form. */
const AGENT_LABELS: Record<string, string> = {
  "mesh/drafter": "Drafter (Conception)",
  "mesh/verifier": "Verifier (Conception)",
  "mesh/helper": "AI Helper",
  "mesh/socratic-fallback": "AI Helper (Socratic)",
  "mesh/distiller": "Idea Distiller",
  "conception/teach": "Tutor — Tell me more",
  "brainstorm/market": "Market Search",
};

/** Derive the module/stage from an agent code prefix ("showcase/…" → "showcase";
 *  the Module-1 chat mesh "mesh/…" → "conception"). */
function stageFromAgent(code: string | undefined): string | null {
  if (!code) return null;
  const p = code.split("/", 1)[0];
  if (!p) return null;
  return p === "mesh" ? "conception" : p;
}

export function labelFor(code: string | undefined): string {
  if (!code) return "Unknown";
  const known = AGENT_LABELS[code];
  if (known) return known;
  const [mod, agent] = code.includes("/") ? (code.split("/", 2) as [string, string]) : ["", code];
  const title = (agent || code).replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return mod ? `${title} (${mod.charAt(0).toUpperCase()}${mod.slice(1)})` : title;
}

/** Log one AI call. Non-blocking; snapshots the context now, inserts in the background. */
export function recordUsage(input: RecordUsageInput, ctxOverride?: UsageContext): void {
  const ctx = ctxOverride ?? getUsageContext();
  void insertUsage(input, ctx).catch((e) =>
    console.warn("[usage-log] failed to record usage:", e instanceof Error ? e.message : e),
  );
}

async function insertUsage(input: RecordUsageInput, ctx: UsageContext | undefined): Promise<void> {
  let userId = ctx?.userId ?? null;
  let userEmail = ctx?.email ?? null;

  // Attribution fallback: the heavy module routes are unauthenticated, so resolve
  // the owner from the projectId when the route didn't set the user directly.
  if (!userId && ctx?.projectId) {
    try {
      const rows = await db
        .select({ userId: projects.userId })
        .from(projects)
        .where(eq(projects.id, ctx.projectId))
        .limit(1);
      userId = rows[0]?.userId ?? null;
      if (userId) {
        const u = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
        userEmail = u[0]?.email ?? null;
      }
    } catch {
      // best-effort — leave unattributed
    }
  }

  const inTok = input.inputTokens ?? 0;
  const outTok = input.outputTokens ?? 0;
  await db.insert(aiUsageLog).values({
    userId,
    userEmail,
    projectId: ctx?.projectId ?? null,
    stage: ctx?.stage ?? stageFromAgent(ctx?.agentCode),
    agentCode: ctx?.agentCode ?? null,
    agentLabel: ctx?.agentCode ? labelFor(ctx.agentCode) : null,
    model: input.model,
    provider: input.provider ?? null,
    inputTokens: inTok,
    outputTokens: outTok,
    cachedTokens: input.cachedTokens ?? 0,
    totalTokens: input.totalTokens ?? inTok + outTok,
    durationMs: input.durationMs ?? 0,
    status: input.status ?? "ok",
    errorMessage: input.errorMessage ?? null,
    metadata: input.metadata ?? null,
  });
}
