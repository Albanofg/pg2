import "server-only";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { aiUsageLog, projects } from "@/db/schema";

/**
 * Read-side aggregation for the admin AI-usage dashboard. Everything is computed
 * SQL-side over the same filtered window (not just the visible page).
 */

export type UsageFilters = {
  from?: Date;
  to?: Date;
  userEmail?: string;
  agentLabel?: string;
  model?: string;
  status?: string;
};

/** Build filters from query params; defaults to the last 7 days when no range given. */
export function parseUsageFilters(params: URLSearchParams): UsageFilters {
  const f: UsageFilters = {};
  const from = params.get("from");
  const to = params.get("to");
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) f.from = d;
  }
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) f.to = d;
  }
  if (!f.from && !f.to) f.from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const email = params.get("userEmail");
  if (email) f.userEmail = email.trim().toLowerCase();
  const agent = params.get("agentLabel");
  if (agent) f.agentLabel = agent;
  const model = params.get("model");
  if (model) f.model = model;
  const status = params.get("status");
  if (status) f.status = status;
  return f;
}

function whereFrom(f: UsageFilters): SQL | undefined {
  const c: SQL[] = [];
  if (f.from) c.push(gte(aiUsageLog.createdAt, f.from));
  if (f.to) c.push(lte(aiUsageLog.createdAt, f.to));
  if (f.userEmail) c.push(eq(aiUsageLog.userEmail, f.userEmail));
  if (f.agentLabel) c.push(eq(aiUsageLog.agentLabel, f.agentLabel));
  if (f.model) c.push(eq(aiUsageLog.model, f.model));
  if (f.status) c.push(eq(aiUsageLog.status, f.status));
  return c.length ? and(...c) : undefined;
}

// float8 casts keep large sums as JS numbers (neon returns int8/numeric as strings).
const CALLS = sql<number>`count(*)::int`;
const IN = sql<number>`coalesce(sum(${aiUsageLog.inputTokens}),0)::float8`;
const OUT = sql<number>`coalesce(sum(${aiUsageLog.outputTokens}),0)::float8`;
const CACHED = sql<number>`coalesce(sum(${aiUsageLog.cachedTokens}),0)::float8`;
const TOTAL = sql<number>`coalesce(sum(${aiUsageLog.totalTokens}),0)::float8`;
const DUR = sql<number>`coalesce(sum(${aiUsageLog.durationMs}),0)::float8`;

export type UsageSummary = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  durationMs: number;
};

export async function getSummary(f: UsageFilters): Promise<UsageSummary> {
  const [row] = await db
    .select({
      calls: CALLS,
      inputTokens: IN,
      outputTokens: OUT,
      cachedTokens: CACHED,
      totalTokens: TOTAL,
      durationMs: DUR,
    })
    .from(aiUsageLog)
    .where(whereFrom(f));
  return row ?? { calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, durationMs: 0 };
}

export type Breakdown = { key: string | null; calls: number; totalTokens: number; inputTokens: number; outputTokens: number; cachedTokens: number };

async function groupBy(col: any, f: UsageFilters): Promise<Breakdown[]> {
  return db
    .select({ key: col, calls: CALLS, totalTokens: TOTAL, inputTokens: IN, outputTokens: OUT, cachedTokens: CACHED })
    .from(aiUsageLog)
    .where(whereFrom(f))
    .groupBy(col)
    .orderBy(desc(TOTAL)) as unknown as Promise<Breakdown[]>;
}

export const getByModel = (f: UsageFilters) => groupBy(aiUsageLog.model, f);
export const getByAgent = (f: UsageFilters) => groupBy(aiUsageLog.agentLabel, f);
export const getByUser = (f: UsageFilters) => groupBy(aiUsageLog.userEmail, f);
export const getByStage = (f: UsageFilters) => groupBy(aiUsageLog.stage, f);

/** One page of raw calls (most recent first), for the dashboard table. */
export async function getRows(f: UsageFilters, limit = 100, offset = 0) {
  return db
    .select()
    .from(aiUsageLog)
    .where(whereFrom(f))
    .orderBy(desc(aiUsageLog.createdAt))
    .limit(Math.min(limit, 1000))
    .offset(offset);
}

/** Distinct user emails that have any usage — for the dashboard's email typeahead. */
export async function getDistinctUsers(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ email: aiUsageLog.userEmail })
    .from(aiUsageLog)
    .where(sql`${aiUsageLog.userEmail} is not null`)
    .orderBy(aiUsageLog.userEmail)
    .limit(1000);
  return rows.map((r) => r.email).filter((e): e is string => !!e);
}

/** All matching rows for CSV export (hard-capped). */
export async function getExportRows(f: UsageFilters) {
  return db
    .select()
    .from(aiUsageLog)
    .where(whereFrom(f))
    .orderBy(desc(aiUsageLog.createdAt))
    .limit(50000);
}

const STAGE_ORDER = ["conception", "maturation", "landscape", "differentiation", "showcase"] as const;

/**
 * How many projects are in each stage — derived from which `module_state` keys are
 * populated (the furthest module a project reached). Answers "what stage are users in".
 */
export async function getStageDistribution(): Promise<Record<string, number>> {
  const rows = await db.select({ moduleState: projects.moduleState }).from(projects);
  const counts: Record<string, number> = {
    none: 0,
    conception: 0,
    maturation: 0,
    landscape: 0,
    differentiation: 0,
    showcase: 0,
  };
  for (const r of rows) {
    const ms = (r.moduleState ?? {}) as Record<string, unknown>;
    let furthest = "none";
    for (const k of STAGE_ORDER) if (ms[k]) furthest = k;
    counts[furthest] = (counts[furthest] ?? 0) + 1;
  }
  return counts;
}
