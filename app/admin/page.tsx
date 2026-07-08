"use client";

import { useCallback, useEffect, useState } from "react";

type Breakdown = {
  key: string | null;
  calls: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
};
type Summary = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  durationMs: number;
};
type Row = {
  id: string;
  createdAt: string;
  userEmail: string | null;
  projectId: string | null;
  stage: string | null;
  agentLabel: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  status: string;
  errorMessage: string | null;
};
type UsageData = {
  summary: Summary;
  byModel: Breakdown[];
  byAgent: Breakdown[];
  byUser: Breakdown[];
  byStage: Breakdown[];
  rows: Row[];
  stageDistribution: Record<string, number>;
  users: string[];
};

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "All time" },
];

const STAGES = ["none", "conception", "maturation", "landscape", "differentiation", "showcase"];

function fromForPreset(k: string): string {
  const now = Date.now();
  if (k === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (k === "7d") return new Date(now - 7 * 864e5).toISOString();
  if (k === "30d") return new Date(now - 30 * 864e5).toISOString();
  return new Date(0).toISOString(); // all time
}

const fmt = (n: number | undefined) => Math.round(n ?? 0).toLocaleString();
const fmtDur = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);

export default function AdminUsagePage() {
  const [preset, setPreset] = useState("7d");
  const [userEmail, setUserEmail] = useState("");
  const [agentLabel, setAgentLabel] = useState("");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState("");
  const [applied, setApplied] = useState(0); // bump to re-apply text filters
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    p.set("from", fromForPreset(preset));
    if (userEmail.trim()) p.set("userEmail", userEmail.trim());
    if (agentLabel.trim()) p.set("agentLabel", agentLabel.trim());
    if (model.trim()) p.set("model", model.trim());
    if (status.trim()) p.set("status", status.trim());
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, applied]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/usage?${buildParams().toString()}`);
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
        throw new Error(d?.detail || d?.error || `failed (${res.status})`);
      }
      setData((await res.json()) as UsageData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportUrl = `/api/admin/usage/export?${buildParams().toString()}`;

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6">
        {/* Header */}
        <header className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">Admin</div>
            <h1 className="mt-0.5 font-sans text-xl font-semibold text-ink">AI Usage</h1>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={exportUrl}
              className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted transition-colors hover:text-ink"
            >
              ⭳ Export CSV
            </a>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
            >
              {loading && (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              )}
              Refresh
            </button>
          </div>
        </header>

        {/* Filter bar */}
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                className={`rounded-md px-3 py-1.5 font-sans text-xs transition-colors ${
                  preset === p.key
                    ? "bg-accent/15 font-medium text-accent"
                    : "border border-border text-ink-muted hover:text-ink"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setApplied((n) => n + 1);
            }}
          >
            <input
              value={userEmail}
              onChange={(e) => {
                const v = e.target.value;
                setUserEmail(v);
                // Picking a full email from the suggestions applies immediately.
                if (data?.users?.includes(v)) setApplied((n) => n + 1);
              }}
              list="admin-user-emails"
              autoComplete="off"
              placeholder="user email"
              className="w-56 rounded-md border border-border bg-bg px-2.5 py-1.5 font-sans text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
            />
            <datalist id="admin-user-emails">
              {(data?.users ?? []).map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
            <input
              value={agentLabel}
              onChange={(e) => setAgentLabel(e.target.value)}
              placeholder="agent"
              className="w-40 rounded-md border border-border bg-bg px-2.5 py-1.5 font-sans text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
            />
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="model"
              className="w-36 rounded-md border border-border bg-bg px-2.5 py-1.5 font-sans text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
            />
            <input
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="status (ok/error)"
              className="w-32 rounded-md border border-border bg-bg px-2.5 py-1.5 font-sans text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90"
            >
              Apply
            </button>
          </form>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-300">
            {error}
          </div>
        )}

        {/* Stage distribution */}
        <section>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
            Stage — projects by furthest module reached
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {STAGES.map((s) => (
              <div key={s} className="rounded-md border border-border bg-panel p-3 text-center">
                <div className="font-sans text-lg font-semibold text-ink">
                  {data?.stageDistribution?.[s] ?? 0}
                </div>
                <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
                  {s}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Summary cards */}
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Calls" value={fmt(data?.summary.calls)} />
          <Stat label="Input tokens" value={fmt(data?.summary.inputTokens)} />
          <Stat label="Output tokens" value={fmt(data?.summary.outputTokens)} />
          <Stat label="Cached tokens" value={fmt(data?.summary.cachedTokens)} />
          <Stat label="Total tokens" value={fmt(data?.summary.totalTokens)} accent />
          <Stat label="Total time" value={fmtDur(data?.summary.durationMs ?? 0)} />
        </section>

        {/* Breakdowns */}
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <BreakdownCard title="By model" rows={data?.byModel ?? []} />
          <BreakdownCard title="By stage" rows={data?.byStage ?? []} />
          <BreakdownCard title="By agent" rows={data?.byAgent ?? []} />
          <BreakdownCard title="By user" rows={data?.byUser ?? []} />
        </section>

        {/* Raw call table */}
        <section className="rounded-lg border border-border bg-panel">
          <div className="border-b border-border p-3 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
            Recent calls {data ? `(${data.rows.length})` : ""}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
                  <th className="p-2 font-normal">Time</th>
                  <th className="p-2 font-normal">User</th>
                  <th className="p-2 font-normal">Stage</th>
                  <th className="p-2 font-normal">Agent</th>
                  <th className="p-2 font-normal">Model</th>
                  <th className="p-2 text-right font-normal">In</th>
                  <th className="p-2 text-right font-normal">Out</th>
                  <th className="p-2 text-right font-normal">Total</th>
                  <th className="p-2 text-right font-normal">Time</th>
                  <th className="p-2 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-border/60 font-sans text-[11px] text-ink">
                    <td className="whitespace-nowrap p-2 text-ink-muted">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="p-2">
                      {r.userEmail ?? <span className="italic text-ink-muted">unattributed</span>}
                    </td>
                    <td className="p-2 text-ink-muted">{r.stage ?? "—"}</td>
                    <td className="p-2">{r.agentLabel ?? "—"}</td>
                    <td className="whitespace-nowrap p-2 font-mono text-[10px]">{r.model}</td>
                    <td className="p-2 text-right tabular-nums">{fmt(r.inputTokens)}</td>
                    <td className="p-2 text-right tabular-nums">{fmt(r.outputTokens)}</td>
                    <td className="p-2 text-right font-medium tabular-nums">{fmt(r.totalTokens)}</td>
                    <td className="p-2 text-right tabular-nums text-ink-muted">{fmtDur(r.durationMs)}</td>
                    <td className="p-2">
                      <span
                        className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase ${
                          r.status === "error"
                            ? "bg-red-500/15 text-red-300"
                            : "bg-emerald-500/15 text-emerald-400"
                        }`}
                        title={r.errorMessage ?? undefined}
                      >
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {data && data.rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="p-6 text-center font-mono text-xs text-ink-muted">
                      No AI calls in this window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-panel p-3">
      <div className={`font-sans text-lg font-semibold ${accent ? "text-accent" : "text-ink"}`}>{value}</div>
      <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">{label}</div>
    </div>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: Breakdown[] }) {
  const top = [...rows].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 8);
  const max = top[0]?.totalTokens || 1;
  return (
    <div className="rounded-lg border border-border bg-panel p-3">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">{title}</div>
      {top.length === 0 ? (
        <div className="py-4 text-center font-mono text-[11px] text-ink-muted">No data</div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {top.map((r, i) => (
            <li key={`${r.key}-${i}`} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-sans text-[12px] text-ink">
                  {r.key ?? <span className="italic text-ink-muted">unattributed</span>}
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-muted">
                  {fmt(r.totalTokens)} tok · {fmt(r.calls)}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-bg">
                <div
                  className="h-full bg-accent/60"
                  style={{ width: `${Math.max(3, (r.totalTokens / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
