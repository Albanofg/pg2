"use client";

import { useLandscape } from "@/lib/hooks/use-landscape";
import { useWorkspace } from "@/lib/store";
import HelperComposer from "@/components/workspace/helper-composer";
import type {
  LandscapeIdea,
  LandscapeSource,
  Territory,
} from "@/lib/modules/landscape/types";

/**
 * Stage 3 — Landscape. Mostly the tool working: each carried-forward idea is
 * searched against existing patents and papers, and the results come back
 * grouped by idea with a closeness score. The inventor reads the landscape.
 */
export default function LandscapePanel({
  projectId,
}: {
  projectId: string | null;
}) {
  const { view, busy, error, ready, research, tell, restart } =
    useLandscape(projectId);
  const setStage = useWorkspace((s) => s.setStage);
  const working = busy || !ready;
  const anyIdeas = view.ideas.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-6">
          <header className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-action">
                Stage 3 · Landscape
              </div>
              <h2 className="mt-1 font-sans text-lg font-semibold text-ink">
                What already exists, idea by idea
              </h2>
            </div>
            <button
              onClick={() => setStage("maturation")}
              className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-accent"
            >
              ← Maturation
            </button>
          </header>

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-300">
              {error}
            </div>
          )}

          {working && !anyIdeas && (
            <div className="flex items-center gap-3 rounded-md border border-accent/30 bg-accent/5 p-4">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <span className="font-mono text-xs text-ink-muted">
                Searching patents and publications for each idea… this can take a
                moment.
              </span>
            </div>
          )}

          {!working && !anyIdeas && (
            <div className="rounded-md border border-border bg-panel p-5 text-center">
              <p className="font-mono text-xs leading-relaxed text-ink-muted">
                No ideas came through from Maturation to search yet.
              </p>
              <div className="mt-3 flex justify-center gap-2">
                <button
                  onClick={() => void restart()}
                  className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-medium text-brand transition-colors hover:bg-accent/90"
                >
                  Run the search
                </button>
                <button
                  onClick={() => setStage("maturation")}
                  className="rounded-md border border-border px-4 py-2 font-sans text-sm text-ink-muted transition-colors hover:text-ink"
                >
                  ← Back to Maturation
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {view.ideas.map((idea) => (
              <IdeaLandscape
                key={idea.conceptId}
                idea={idea}
                busy={busy}
                onResearch={() => void research(idea.conceptId)}
              />
            ))}
          </div>

          {view.complete && (
            <div className="rounded-md border border-accent/40 bg-accent/10 p-4 text-center">
              <p className="font-sans text-sm font-medium text-ink">
                Landscape gathered — each idea is paired with the closest existing
                art, ready for Differentiation.
              </p>
              <button
                onClick={() => setStage("differentiation")}
                className="mt-3 rounded-md bg-accent px-5 py-2.5 font-sans text-sm font-medium text-brand transition-colors hover:bg-accent/90"
              >
                Continue to Differentiation →
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-panel p-4">
        <div className="mx-auto w-full max-w-2xl">
          <HelperComposer
            placeholder="Note anything you notice in the landscape…"
            busy={busy}
            onSend={tell}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function IdeaLandscape({
  idea,
  busy,
  onResearch,
}: {
  idea: LandscapeIdea;
  busy: boolean;
  onResearch: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-action">
            Idea
          </div>
          <div className="font-sans text-sm font-semibold text-ink">
            {idea.title}
          </div>
          <p className="mt-1 font-mono text-[11px] leading-relaxed text-ink-muted">
            {idea.statement}
          </p>
        </div>
        {idea.status === "searching" ? (
          <span className="mt-1 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        ) : (
          idea.status === "done" && <TerritoryBadge territory={idea.territory} />
        )}
      </div>

      {idea.status === "error" && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-2">
          <span className="font-mono text-[11px] text-red-300">{idea.error}</span>
          <button
            onClick={onResearch}
            disabled={busy}
            className="shrink-0 rounded border border-border px-2 py-1 font-sans text-[11px] text-ink-muted hover:text-ink disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      {idea.status === "done" && idea.sources.length === 0 && (
        <p className="mt-3 rounded-md border border-accent/30 bg-accent/5 p-2 font-mono text-[11px] text-ink-muted">
          No close prior art found — this looks like open space.
        </p>
      )}

      {idea.sources.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
            Closest existing art ({idea.sources.length})
          </div>
          {idea.sources.map((s, i) => (
            <SourceRow key={i} source={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceRow({ source }: { source: LandscapeSource }) {
  return (
    <div className="rounded-md border border-border bg-bg p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="mr-1.5 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-accent">
            {source.kind}
          </span>
          {source.url ? (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-sans text-xs font-medium text-ink underline-offset-2 hover:text-accent hover:underline"
            >
              {source.title}
            </a>
          ) : (
            <span className="font-sans text-xs font-medium text-ink">
              {source.title}
            </span>
          )}
          {source.identifier && (
            <span className="ml-1 font-mono text-[10px] text-ink-muted">
              {source.identifier}
            </span>
          )}
        </div>
        {typeof source.closeness === "number" && (
          <Closeness value={source.closeness} />
        )}
      </div>
      {source.snippet && (
        <p className="mt-1 font-mono text-[11px] leading-relaxed text-ink-muted">
          {source.snippet}
        </p>
      )}
    </div>
  );
}

function TerritoryBadge({ territory }: { territory: Territory }) {
  const label =
    territory === "crowded"
      ? "Crowded"
      : territory === "moderate"
      ? "Some prior art"
      : "Open space";
  const tone =
    territory === "crowded"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
      : territory === "moderate"
      ? "border-border bg-bg text-ink-muted"
      : "border-accent/40 bg-accent/10 text-accent";
  return (
    <span
      className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${tone}`}
    >
      {label}
    </span>
  );
}

function Closeness({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="shrink-0 text-right">
      <div className="font-mono text-[10px] text-accent">{pct}%</div>
      <div className="mt-0.5 h-1 w-12 overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
