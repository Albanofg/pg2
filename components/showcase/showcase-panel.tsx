"use client";

import { useState } from "react";
import { useShowcase } from "@/lib/hooks/use-showcase";
import { useWorkspace } from "@/lib/store";
import HelperComposer from "@/components/workspace/helper-composer";
import type {
  ChoiceCard,
  Module5Card,
  VariationCard,
  WidenedReviewCard,
} from "@/lib/modules/showcase/types";

/**
 * Stage 5 — Showcase (broadening). Optionally widen the disclosure across
 * alternative implementations: keep which variations (Gate 1), then approve each
 * broadened Key Concept (Gate 2). Figures + export come later.
 */
function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ShowcasePanel({
  projectId,
  maxW = "max-w-2xl",
}: {
  projectId: string | null;
  maxW?: string;
}) {
  const { view, busy, error, ready, act, tell, restart, exportDisclosure } =
    useShowcase(projectId);
  const setStage = useWorkspace((s) => s.setStage);
  const working = busy || !ready;
  const broadenedKCs = view.keyConcepts.filter((k) => k.broadened);
  const [exported, setExported] = useState<string | null>(null);

  const onExport = async () => {
    const result = await exportDisclosure();
    if (!result) return;
    download("invention-disclosure.md", result.disclosure, "text/markdown");
    download("proof-package.json", JSON.stringify(result.proof, null, 2), "application/json");
    setExported(
      result.proof.tsaStatus === "ok"
        ? "Exported — disclosure + RFC-3161-sealed proof package downloaded."
        : "Exported — disclosure + proof downloaded (TSA was unreachable; the hash still seals it, re-timestampable later).",
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div
          className={`mx-auto flex w-full flex-col gap-5 p-6 ${maxW}`}
        >
          <header className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-action">
                Stage 5 · Showcase
              </div>
              <h2 className="mt-1 font-sans text-lg font-semibold text-ink">
                {view.phase === "selecting_variations"
                  ? "Keep the variations worth covering"
                  : view.phase === "approving_widened"
                    ? "Approve each broadened Key Concept"
                    : view.phase === "ready"
                      ? "Showcase complete"
                      : "Broaden the disclosure — or finish as is"}
              </h2>
            </div>
            <button
              onClick={() => setStage("differentiation")}
              className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-accent"
            >
              ← Differentiation
            </button>
          </header>

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-300">
              {error}
            </div>
          )}

          {working && (
            <div className="flex items-center gap-3 rounded-md border border-accent/30 bg-accent/5 p-4">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <span className="font-mono text-xs text-ink-muted">
                {view.cards.length === 0
                  ? "The Helper is working through the broadening… this can take a moment."
                  : "Working…"}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {view.cards.map((card) => (
              <CardView key={card.id} card={card} busy={busy} onAct={act} />
            ))}
          </div>

          {broadenedKCs.length > 0 && (
            <div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                Broadened Key Concepts ({broadenedKCs.length})
              </div>
              <ul className="space-y-2">
                {broadenedKCs.map((k) => (
                  <li key={k.id} className="rounded-md border border-accent/30 bg-accent/5 p-3">
                    <div className="font-sans text-sm font-semibold text-ink">{k.title}</div>
                    <p className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-muted">
                      {k.broadened}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {view.complete && (
            <div className="rounded-md border border-accent/40 bg-accent/10 p-4 text-center">
              <p className="font-sans text-sm font-medium text-ink">
                {view.broadened
                  ? `Broadening applied — ${broadenedKCs.length} Key Concept${broadenedKCs.length === 1 ? "" : "s"} widened.`
                  : "Finished without broadening."}{" "}
                Export the Invention Disclosure with its proof package.
              </p>
              <button
                onClick={() => void onExport()}
                disabled={busy}
                className="mt-3 rounded-md bg-accent px-5 py-2.5 font-sans text-sm font-medium text-brand transition-colors hover:bg-accent/90 disabled:opacity-50"
              >
                {busy ? "Sealing…" : "Export disclosure + proof"}
              </button>
              {exported && (
                <p className="mt-2 font-mono text-[11px] text-ink-muted">{exported}</p>
              )}
              <p className="mt-1 font-mono text-[11px] text-ink-muted">
                (Figures aren&apos;t built yet.)
              </p>
            </div>
          )}

          {!working && view.cards.length === 0 && view.keyConcepts.length === 0 && !view.complete && (
            <div className="rounded-md border border-border bg-panel p-5 text-center">
              <p className="font-mono text-xs leading-relaxed text-ink-muted">
                Nothing to showcase yet — complete Differentiation first.
              </p>
              <div className="mt-3 flex justify-center gap-2">
                <button
                  onClick={() => setStage("differentiation")}
                  className="rounded-md border border-border px-4 py-2 font-sans text-sm text-ink-muted hover:text-ink"
                >
                  ← Back to Differentiation
                </button>
                <button
                  onClick={() => void restart()}
                  className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-medium text-brand hover:bg-accent/90"
                >
                  Restart this stage
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-panel p-4">
        <div className={`mx-auto w-full ${maxW}`}>
          <HelperComposer placeholder="Note anything for the record…" busy={busy} onSend={tell} />
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
  card: Module5Card;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  switch (card.type) {
    case "choice":
      return <ChoiceView card={card} busy={busy} onAct={onAct} />;
    case "variation":
      return <VariationView card={card} busy={busy} onAct={onAct} />;
    case "widened_review":
      return <WidenedReviewView card={card} busy={busy} onAct={onAct} />;
    default:
      return null;
  }
}

function ChoiceView({
  card,
  busy,
  onAct,
}: {
  card: ChoiceCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-action">
        Broaden? · optional
      </div>
      <p className="mt-1 font-mono text-xs leading-relaxed text-ink-muted">{card.question}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onAct(card.id, { choice: "broaden" } as never)}
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
        >
          Broaden it
        </button>
        <button
          onClick={() => onAct(card.id, { choice: "skip" } as never)}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink disabled:opacity-50"
        >
          Finish as is
        </button>
      </div>
    </div>
  );
}

function VariationView({
  card,
  busy,
  onAct,
}: {
  card: VariationCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-action">
        Variation · keep or drop
      </div>
      <div className="font-sans text-sm font-semibold text-ink">
        {card.name}
        <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
          {card.speciesType.replace(/_/g, " ")}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-muted">
        {card.description}
      </p>
      {card.improvements.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4">
          {card.improvements.map((imp, i) => (
            <li key={i} className="font-mono text-[11px] leading-relaxed text-ink-muted">
              {imp}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onAct(card.id, { action: "keep" } as never)}
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
        >
          Keep
        </button>
        <button
          onClick={() => onAct(card.id, { action: "drop" } as never)}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink disabled:opacity-50"
        >
          Drop
        </button>
      </div>
    </div>
  );
}

function WidenedReviewView({
  card,
  busy,
  onAct,
}: {
  card: WidenedReviewCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(card.broadened);
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-action">
        Broadened · approve, edit, or discard
      </div>
      <div className="font-sans text-sm font-semibold text-ink">{card.title}</div>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">Original</p>
      <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink-muted">
        {card.original}
      </p>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">Broadened</p>
      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className="mt-1 w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
        />
      ) : (
        <p className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink">
          {card.broadened}
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
            Keep original
          </button>
        </div>
      )}
    </div>
  );
}
