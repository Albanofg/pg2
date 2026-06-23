"use client";

import { useState } from "react";
import { useDifferentiation } from "@/lib/hooks/use-differentiation";
import { useWorkspace } from "@/lib/store";
import HelperComposer from "@/components/workspace/helper-composer";
import type {
  CertificationCard,
  DifferentiationReviewCard,
  GapCard,
  KeyConceptCard,
  Module4Card,
  NoveltyCaptureCard,
} from "@/lib/modules/differentiation/types";

/**
 * Stage 4 — Differentiation. The heavy moment. Per concept: read the factual gap
 * (what the art covers + the open points), state in your OWN words what's
 * genuinely new, approve the formalized differentiation, then anchor which become
 * your Key Concepts.
 */
export default function DifferentiationPanel({
  projectId,
}: {
  projectId: string | null;
}) {
  const { view, busy, error, ready, act, tell, restart } = useDifferentiation(projectId);
  const setStage = useWorkspace((s) => s.setStage);
  const working = busy || !ready;
  const keyConcepts = view.concepts.filter((c) => c.isKeyConcept);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-6">
          <header className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-action">
                Stage 4 · Differentiation
              </div>
              <h2 className="mt-1 font-sans text-lg font-semibold text-ink">
                {view.phase === "anchoring"
                  ? "Choose which become your Key Concepts"
                  : view.phase === "complete"
                    ? "Your Key Concepts are set"
                    : "Say what's genuinely new — against what already exists"}
              </h2>
            </div>
            <button
              onClick={() => setStage("landscape")}
              className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-accent"
            >
              ← Landscape
            </button>
          </header>

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-300">
              {error}
            </div>
          )}

          {working && view.cards.length === 0 && !view.disclosure && (
            <div className="flex items-center gap-3 rounded-md border border-accent/30 bg-accent/5 p-4">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <span className="font-mono text-xs text-ink-muted">
                The Helper is laying out the prior-art gap… this can take a moment.
              </span>
            </div>
          )}

          {!working && view.cards.length === 0 && view.concepts.length === 0 && !view.complete && (
            <div className="rounded-md border border-border bg-panel p-5 text-center">
              <p className="font-mono text-xs leading-relaxed text-ink-muted">
                Nothing to differentiate yet — complete Maturation and Landscape first.
              </p>
              <div className="mt-3 flex justify-center gap-2">
                <button
                  onClick={() => setStage("landscape")}
                  className="rounded-md border border-border px-4 py-2 font-sans text-sm text-ink-muted hover:text-ink"
                >
                  ← Back to Landscape
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

          <div className="flex flex-col gap-4">
            {view.cards.map((card) => (
              <CardView key={card.id} card={card} busy={busy} onAct={act} />
            ))}
          </div>

          {keyConcepts.length > 0 && (
            <div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                Key Concepts ({keyConcepts.length})
              </div>
              <ul className="space-y-2">
                {keyConcepts.map((c) => (
                  <li key={c.id} className="rounded-md border border-accent/30 bg-accent/5 p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="font-sans text-sm font-semibold text-ink">{c.title}</div>
                      {c.certification?.status === "certified" && (
                        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-accent">
                          ✓ Inventorship certified
                        </span>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-muted">
                      {c.differentiation_statement || c.formalized_statement}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {view.disclosure && view.disclosure.sections.length > 0 && (
            <div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-action">
                Invention Disclosure · draft
              </div>
              <div className="space-y-3 rounded-md border border-border bg-panel p-4">
                {view.disclosure.sections.map((s) => (
                  <div key={s.key}>
                    <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
                      {s.label}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink">
                      {s.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view.complete && (
            <div className="rounded-md border border-accent/40 bg-accent/10 p-4 text-center">
              <p className="font-sans text-sm font-medium text-ink">
                Differentiation complete — {keyConcepts.length} Key Concept
                {keyConcepts.length === 1 ? "" : "s"} anchored, inventorship
                certified, and the Invention Disclosure drafted.
              </p>
              <button
                onClick={() => setStage("showcase")}
                className="mt-3 rounded-md bg-accent px-5 py-2.5 font-sans text-sm font-medium text-brand transition-colors hover:bg-accent/90"
              >
                Continue to Showcase →
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-panel p-4">
        <div className="mx-auto w-full max-w-2xl">
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
  card: Module4Card;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  switch (card.type) {
    case "gap":
      return <GapView card={card} />;
    case "novelty_capture":
      return <NoveltyCaptureView card={card} busy={busy} onAct={onAct} />;
    case "differentiation_review":
      return <DifferentiationReviewView card={card} busy={busy} onAct={onAct} />;
    case "key_concept":
      return <KeyConceptView card={card} busy={busy} onAct={onAct} />;
    case "certification":
      return <CertificationView card={card} busy={busy} onAct={onAct} />;
    default:
      return null;
  }
}

function GapView({ card }: { card: GapCard }) {
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
        The landscape · facts only
      </div>
      <div className="font-sans text-sm font-semibold text-ink">{card.title}</div>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
        What the closest art already covers
      </p>
      <p className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-muted">
        {card.artSummary}
      </p>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
        Your concept&apos;s mechanism
      </p>
      <p className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink">
        {card.mechanism}
      </p>
    </div>
  );
}

function NoveltyCaptureView({
  card,
  busy,
  onAct,
}: {
  card: NoveltyCaptureCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-amber-400">
        Your call on novelty
      </div>
      <div className="font-sans text-sm font-semibold text-ink">{card.title}</div>
      <p className="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-muted">
        {card.context}
      </p>
      <p className="mt-2 font-mono text-[11px] italic text-ink-muted">
        This has to be your idea, in your own words — the Helper won&apos;t suggest it.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="What does this concept do that the existing art does not?"
        className="mt-2 w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex justify-end">
        <button
          onClick={() => onAct(card.id, { statement: text.trim() } as never)}
          disabled={busy || !text.trim()}
          className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
        >
          This is mine
        </button>
      </div>
    </div>
  );
}

function DifferentiationReviewView({
  card,
  busy,
  onAct,
}: {
  card: DifferentiationReviewCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(card.body);
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-action">
        Your differentiation · approve, edit, or discard
      </div>
      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          className="mt-2 w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
        />
      ) : (
        <p className="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink">
          {card.body}
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
            Discard
          </button>
        </div>
      )}
    </div>
  );
}

function CertificationView({
  card,
  busy,
  onAct,
}: {
  card: CertificationCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-amber-400">
        Proof of human conception · {card.factor.replace(/_/g, " ")}
      </div>
      <div className="font-sans text-sm font-semibold text-ink">{card.title}</div>
      <p className="mt-2 font-mono text-xs leading-relaxed text-ink-muted">{card.question}</p>
      <p className="mt-2 font-mono text-[11px] italic text-ink-muted">
        In your own words — this is part of proving the invention is yours.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Answer in your own words…"
        className="mt-2 w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex justify-end">
        <button
          onClick={() => onAct(card.id, { answer: text.trim() } as never)}
          disabled={busy || !text.trim()}
          className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
        >
          This is mine
        </button>
      </div>
    </div>
  );
}

function KeyConceptView({
  card,
  busy,
  onAct,
}: {
  card: KeyConceptCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-action">
        Anchor as a Key Concept? · you choose
      </div>
      <p className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink">
        {card.statement}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onAct(card.id, { action: "anchor" } as never)}
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
        >
          Anchor as Key Concept
        </button>
        <button
          onClick={() => onAct(card.id, { action: "drop" } as never)}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink disabled:opacity-50"
        >
          Not an anchor
        </button>
      </div>
    </div>
  );
}
