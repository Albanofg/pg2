"use client";

import { useState } from "react";
import { useMaturation } from "@/lib/hooks/use-maturation";
import { useWorkspace } from "@/lib/store";
import HelperComposer from "@/components/workspace/helper-composer";
import type {
  DeepenReviewCard,
  Module2Card,
  SelectionCard,
  SparkCard,
} from "@/lib/modules/maturation/types";

/**
 * Stage 2 — Maturation. Per concept: deepen into a fuller technical statement
 * (approve / edit / discard), answer the occasional sharp Spark, then choose
 * which matured concepts carry forward.
 */
export default function MaturationPanel({
  projectId,
  maxW = "max-w-2xl",
}: {
  projectId: string | null;
  maxW?: string;
}) {
  const { view, busy, error, ready, act, tell, restart } = useMaturation(projectId);
  const setStage = useWorkspace((s) => s.setStage);
  const working = busy || !ready;
  const carried = view.concepts.filter((c) => c.decision === "carry_forward");

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div
          className={`mx-auto flex w-full flex-col gap-5 p-6 ${maxW}`}
        >
          <header className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-action">
                Stage 2 · Maturation
              </div>
              <h2 className="mt-1 font-sans text-lg font-semibold text-ink">
                {view.phase === "selecting"
                  ? "Choose which concepts move forward"
                  : "Deepen each concept until it's ready to search"}
              </h2>
            </div>
            <button
              onClick={() => setStage("conception")}
              className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-accent"
            >
              ← Conception
            </button>
          </header>

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-300">
              {error}
            </div>
          )}

          {working && view.cards.length === 0 && (
            <div className="flex items-center gap-3 rounded-md border border-accent/30 bg-accent/5 p-4">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <span className="font-mono text-xs text-ink-muted">
                The Helper is deepening your concepts… this can take a moment.
              </span>
            </div>
          )}

          {!working && view.cards.length === 0 && view.concepts.length === 0 && (
            <div className="rounded-md border border-border bg-panel p-5 text-center">
              <p className="font-mono text-xs leading-relaxed text-ink-muted">
                No concepts came through from Conception to mature.
              </p>
              <div className="mt-3 flex justify-center gap-2">
                <button
                  onClick={() => void restart()}
                  className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-medium text-brand hover:bg-accent/90"
                >
                  Restart this stage
                </button>
                <button
                  onClick={() => setStage("conception")}
                  className="rounded-md border border-border px-4 py-2 font-sans text-sm text-ink-muted hover:text-ink"
                >
                  ← Back to Conception
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {view.cards.map((card) => (
              <CardView key={card.id} card={card} busy={busy} onAct={act} />
            ))}
          </div>

          {carried.length > 0 && (
            <div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                Carrying forward ({carried.length})
              </div>
              <ul className="space-y-2">
                {carried.map((c) => (
                  <li key={c.id} className="rounded-md border border-accent/30 bg-accent/5 p-3">
                    <div className="font-sans text-sm font-semibold text-ink">{c.title}</div>
                    <p className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-muted">
                      {c.deepened_statement || c.formalized_statement}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {view.complete && (
            <div className="rounded-md border border-accent/40 bg-accent/10 p-4 text-center">
              <p className="font-sans text-sm font-medium text-ink">
                Maturation complete — {carried.length} concept
                {carried.length === 1 ? "" : "s"} carried forward, ready for
                Landscape.
              </p>
              <button
                onClick={() => setStage("landscape")}
                className="mt-3 rounded-md bg-accent px-5 py-2.5 font-sans text-sm font-medium text-brand transition-colors hover:bg-accent/90"
              >
                Continue to Landscape →
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-panel p-4">
        <div className={`mx-auto w-full ${maxW}`}>
          <HelperComposer
            placeholder="Note anything for the record…"
            busy={busy}
            onSend={tell}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CardView({
  card,
  busy,
  onAct,
}: {
  card: Module2Card;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  switch (card.type) {
    case "deepen_review":
      return <DeepenReviewView card={card} busy={busy} onAct={onAct} />;
    case "spark":
      return <SparkView card={card} busy={busy} onAct={onAct} />;
    case "selection":
      return <SelectionView card={card} busy={busy} onAct={onAct} />;
    default:
      return null;
  }
}

function DeepenReviewView({
  card,
  busy,
  onAct,
}: {
  card: DeepenReviewCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(card.deepened_statement);
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-action">
        Maturing · approve, edit, or discard
      </div>
      <div className="font-sans text-sm font-semibold text-ink">{card.title}</div>
      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="mt-3 w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
        />
      ) : (
        <p className="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink">
          {card.deepened_statement}
        </p>
      )}
      {editing ? (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() =>
              onAct(card.id, { action: "request_edit", correction: text.trim() } as never)
            }
            disabled={busy || !text.trim()}
            className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
          >
            Save my version
          </button>
          <button
            onClick={() => setEditing(false)}
            className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => onAct(card.id, { action: "approve" } as never)}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => setEditing(true)}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink disabled:opacity-50"
          >
            Edit
          </button>
          <button
            onClick={() => onAct(card.id, { action: "discard" } as never)}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-red-300 hover:border-red-500/40 hover:bg-red-500/10 disabled:opacity-50"
          >
            Set aside
          </button>
        </div>
      )}
    </div>
  );
}

function SparkView({
  card,
  busy,
  onAct,
}: {
  card: SparkCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const [text, setText] = useState("");
  const isLeap = card.kind === "leap";
  return (
    <div
      className={`rounded-md border p-4 ${
        isLeap ? "border-amber-500/40 bg-amber-500/5" : "border-accent/30 bg-accent/5"
      }`}
    >
      <div
        className={`mb-1 font-mono text-[10px] uppercase tracking-[0.15em] ${
          isLeap ? "text-amber-400" : "text-accent"
        }`}
      >
        {isLeap ? "Your idea needed here" : "One quick specific"}
      </div>
      <div className="font-sans text-sm font-semibold text-ink">{card.missing}</div>
      <p className="mt-2 font-mono text-xs leading-relaxed text-ink-muted">{card.prompt}</p>
      {isLeap && (
        <p className="mt-2 font-mono text-[11px] italic text-ink-muted">
          This has to be your idea, in your own words — the Helper won&apos;t suggest it.
        </p>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={isLeap ? "Describe it yourself…" : "Answer in your own words…"}
        className="mt-2 w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex justify-end">
        <button
          onClick={() => onAct(card.id, { answer: text.trim() } as never)}
          disabled={busy || !text.trim()}
          className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
        >
          {isLeap ? "This is mine" : "Answer"}
        </button>
      </div>
    </div>
  );
}

function SelectionView({
  card,
  busy,
  onAct,
}: {
  card: SelectionCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-action">
        Carry forward? · you choose
      </div>
      <div className="font-sans text-sm font-semibold text-ink">{card.title}</div>
      <p className="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink">
        {card.statement}
      </p>
      {!card.searchReady && (
        <p className="mt-2 font-mono text-[11px] italic text-amber-400">
          Still thin for searching — carrying it forward anyway may return noise.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onAct(card.id, { choice: "carry_forward" } as never)}
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
        >
          Carry forward
        </button>
        <button
          onClick={() => onAct(card.id, { choice: "set_aside" } as never)}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink disabled:opacity-50"
        >
          Set aside
        </button>
      </div>
    </div>
  );
}
