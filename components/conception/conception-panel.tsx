"use client";

import { useState } from "react";
import { useConception } from "@/lib/hooks/use-conception";
import { useWorkspace } from "@/lib/store";
import HelperComposer from "@/components/workspace/helper-composer";
import type {
  CandidateConceptCard,
  ClarityCard,
  CodeReviewCard,
  LeapCard,
  Module1Card,
  Module1Phase,
  Module1View,
  ReviewCard,
} from "@/lib/modules/conception/types";

/**
 * The Conception (Module 1) Helper surface — a card-based journey, not a chat.
 *
 * The inventor drops a raw idea in plain words; the Helper hands back a
 * formalized restatement to Approve / Edit / Discard; on approval it shows
 * representative code and the distinct concepts to keep, drop, or merge. New
 * inventive content only ever enters through a Leap card, in the inventor's
 * own words.
 */
export default function ConceptionPanel({
  projectId,
}: {
  projectId: string | null;
}) {
  const { view, busy, error, act, tell, reset } = useConception(projectId);
  const setStage = useWorkspace((s) => s.setStage);

  const hasStatement = !!view.statement;
  const candidateCards = view.cards.filter(
    (c): c is CandidateConceptCard => c.type === "candidate_concept"
  );
  const openConceptIds = new Set(candidateCards.map((c) => c.conceptId));
  const keptConcepts = view.concepts.filter(
    (c) => c.status.state === "active" && !openConceptIds.has(c.id)
  );

  const strength = strengthOf(view, keptConcepts.length);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-6">
      <header className="flex items-center justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-action">
            Stage 1 · Conception
          </div>
          <h2 className="mt-1 font-sans text-lg font-semibold text-ink">
            Turn your idea into concepts you own
          </h2>
        </div>
        {hasStatement && (
          <button
            onClick={() => {
              if (window.confirm("Start this idea over? The current session is cleared."))
                void reset();
            }}
            disabled={busy}
            className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-accent disabled:opacity-50"
          >
            Start over
          </button>
        )}
      </header>

      {hasStatement && <StrengthMeter pct={strength.pct} label={strength.label} />}

      {busy && (
        <div className="flex items-center gap-3 rounded-md border border-accent/30 bg-accent/5 p-4">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <span className="font-mono text-xs text-ink-muted">
            The Helper is working…
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Onboarding — the inventor types their idea into the composer below. */}
      {!hasStatement && (
        <div className="rounded-md border border-border bg-panel p-5">
          <p className="font-mono text-xs leading-relaxed text-ink-muted">
            Describe your software idea in your own words in the box below — even
            a single sentence. The Helper will read it, capture your exact words,
            and hand back a clean version for you to approve.
          </p>
        </div>
      )}

      {/* The approved formalized statement (read-only once signed off). */}
      {view.statement?.approved && (
        <ReadOnlyBlock label="Your idea, as you approved it" tone="accent">
          {view.statement.text}
        </ReadOnlyBlock>
      )}

      {/* Approved representative code (read-only once signed off). */}
      {view.representativeCode?.approved && view.representativeCode.code && (
        <ReadOnlyBlock
          label={`Representative code · ${view.representativeCode.language}`}
          mono
        >
          {view.representativeCode.code}
        </ReadOnlyBlock>
      )}

      {/* Active cards. */}
      <div className="flex flex-col gap-4">
        {view.cards.map((card) => (
          <CardView
            key={card.id}
            card={card}
            busy={busy}
            candidates={candidateCards}
            onAct={act}
          />
        ))}
      </div>

      {/* Kept concepts so far. */}
      {keptConcepts.length > 0 && (
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
            Concepts you own ({keptConcepts.length})
          </div>
          <ul className="space-y-2">
            {keptConcepts.map((c) => (
              <li
                key={c.id}
                className="rounded-md border border-accent/30 bg-accent/5 p-3"
              >
                <div className="font-sans text-sm font-semibold text-ink">
                  {c.title}
                </div>
                <p className="mt-1 font-mono text-xs leading-relaxed text-ink-muted">
                  {c.formalized_statement}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {view.complete && (
        <div className="rounded-md border border-accent/40 bg-accent/10 p-4 text-center">
          <p className="font-sans text-sm font-medium text-ink">
            Conception complete — {keptConcepts.length} concept
            {keptConcepts.length === 1 ? "" : "s"} you own.
          </p>
          <button
            onClick={() => setStage("maturation")}
            className="mt-3 rounded-md bg-accent px-5 py-2.5 font-sans text-sm font-medium text-brand transition-colors hover:bg-accent/90"
          >
            Continue to Maturation →
          </button>
        </div>
      )}
        </div>
      </div>

      <div className="border-t border-border bg-panel p-4">
        <div className="mx-auto w-full max-w-2xl">
          <HelperComposer
            placeholder={conceptionPlaceholder(view.phase)}
            busy={busy}
            onSend={tell}
          />
        </div>
      </div>
    </div>
  );
}

function conceptionPlaceholder(phase: Module1Phase): string {
  switch (phase) {
    case "reviewing_statement":
      return "Tell the Helper to change the reading — e.g. “make it broader”, “focus on the timing”, or add a detail in your words…";
    case "confirming_concepts":
      return "Tell the Helper another idea, in your own words…";
    case "complete":
      return "Add another idea, or note anything for the record…";
    default:
      return "Describe your software idea in your own words…";
  }
}

function strengthOf(
  view: Module1View,
  kept: number,
): { pct: number; label: string } {
  if (!view.statement) return { pct: 0, label: "Just getting started" };
  if (view.complete) return { pct: 100, label: "Solid — ready for Maturation" };
  let pct = view.statement.approved ? 35 : 15;
  let label = view.statement.approved ? "Core locked in" : "Core distilled";
  pct += Math.min(45, kept * 15);
  if (view.representativeCode?.approved) pct += 10;
  if (kept >= 1) label = "Taking shape";
  if (pct >= 70) label = "Getting strong";
  return { pct: Math.min(99, pct), label };
}

function StrengthMeter({ pct, label }: { pct: number; label: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
          Idea strength
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-accent">
          {label}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-bg">
        <div
          className="h-full rounded-full bg-accent transition-all duration-700 ease-util"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CardView({
  card,
  busy,
  candidates,
  onAct,
}: {
  card: Module1Card;
  busy: boolean;
  candidates: CandidateConceptCard[];
  onAct: (cardId: string, input: never) => void;
}) {
  switch (card.type) {
    case "review":
      return <ReviewCardView card={card} busy={busy} onAct={onAct} />;
    case "code_review":
      return <CodeCardView card={card} busy={busy} onAct={onAct} />;
    case "clarity":
      return <ClarityCardView card={card} busy={busy} onAct={onAct} />;
    case "leap":
      return <LeapCardView card={card} busy={busy} onAct={onAct} />;
    case "candidate_concept":
      return (
        <CandidateCardView
          card={card}
          busy={busy}
          candidates={candidates}
          onAct={onAct}
        />
      );
    default:
      return null;
  }
}

function CardShell({
  badge,
  title,
  children,
}: {
  badge: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-action">
        {badge}
      </div>
      <div className="font-sans text-sm font-semibold text-ink">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function ReviewCardView({
  card,
  busy,
  onAct,
}: {
  card: ReviewCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const canEdit = card.actions.includes("request_edit");
  return (
    <CardShell
      badge={canEdit ? "Review · approve, edit, or discard" : "Review · approve, or change it below"}
      title={card.title}
    >
      <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink">
        {card.body}
      </p>
      {card.notes?.map((n, i) => (
        <p key={i} className="mt-2 font-mono text-[11px] italic text-ink-muted">
          {n}
        </p>
      ))}
      {canEdit && editing ? (
        <div className="mt-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="Rewrite it in your own words…"
            className="w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={() =>
                onAct(card.id, {
                  action: "request_edit",
                  correction: text.trim(),
                } as never)
              }
              disabled={busy || !text.trim()}
              className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
            >
              Send my version
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <ActionRow
            busy={busy}
            onApprove={() => onAct(card.id, { action: "approve" } as never)}
            onEdit={canEdit ? () => setEditing(true) : undefined}
            onDiscard={() => onAct(card.id, { action: "discard" } as never)}
          />
          {!canEdit && (
            <p className="mt-2 font-mono text-[11px] italic text-ink-muted">
              Want changes? Tell the Helper in the box below — it&apos;ll revise
              this for you.
            </p>
          )}
        </>
      )}
    </CardShell>
  );
}

function CodeCardView({
  card,
  busy,
  onAct,
}: {
  card: CodeReviewCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(card.code);
  return (
    <CardShell badge={`Representative code · ${card.language}`} title={card.title}>
      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          className="w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-[11px] text-ink focus:border-accent focus:outline-none"
        />
      ) : (
        <pre className="max-h-72 overflow-auto rounded-md border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed text-ink">
          {card.code}
        </pre>
      )}
      {editing ? (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() =>
              onAct(card.id, {
                action: "request_edit",
                correction: text,
              } as never)
            }
            disabled={busy}
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
        <ActionRow
          busy={busy}
          onApprove={() => onAct(card.id, { action: "approve" } as never)}
          onEdit={() => setEditing(true)}
          onDiscard={() => onAct(card.id, { action: "discard" } as never)}
        />
      )}
    </CardShell>
  );
}

function ClarityCardView({
  card,
  busy,
  onAct,
}: {
  card: ClarityCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const [text, setText] = useState("");
  return (
    <CardShell badge="One quick question" title={card.question}>
      {card.whyItMatters && (
        <p className="mb-2 font-mono text-[11px] italic text-ink-muted">
          {card.whyItMatters}
        </p>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Answer in your own words…"
        className="w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex justify-end">
        <button
          onClick={() => onAct(card.id, { answer: text.trim() } as never)}
          disabled={busy || !text.trim()}
          className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
        >
          Answer
        </button>
      </div>
    </CardShell>
  );
}

function LeapCardView({
  card,
  busy,
  onAct,
}: {
  card: LeapCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-amber-400">
        Your idea needed here
      </div>
      <div className="font-sans text-sm font-semibold text-ink">
        {card.inventiveElement}
      </div>
      <p className="mt-2 font-mono text-xs leading-relaxed text-ink-muted">
        {card.context}
      </p>
      <p className="mt-2 font-mono text-[11px] italic text-ink-muted">
        This has to be your idea, in your own words — the Helper won&apos;t
        suggest it.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="Describe the idea yourself…"
        className="mt-2 w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex justify-end">
        <button
          onClick={() => onAct(card.id, { idea: text.trim() } as never)}
          disabled={busy || !text.trim()}
          className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
        >
          This is mine
        </button>
      </div>
    </div>
  );
}

function CandidateCardView({
  card,
  busy,
  candidates,
  onAct,
}: {
  card: CandidateConceptCard;
  busy: boolean;
  candidates: CandidateConceptCard[];
  onAct: (cardId: string, input: never) => void;
}) {
  const [merging, setMerging] = useState(false);
  const others = candidates.filter((c) => c.conceptId !== card.conceptId);
  return (
    <CardShell badge="Concept · keep, drop, or merge" title={card.title}>
      <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink">
        {card.statement}
      </p>
      {merging ? (
        <div className="mt-3">
          <div className="mb-1 font-mono text-[11px] text-ink-muted">
            Merge into:
          </div>
          <div className="flex flex-wrap gap-2">
            {others.length === 0 && (
              <span className="font-mono text-[11px] text-ink-muted">
                No other concepts to merge into.
              </span>
            )}
            {others.map((o) => (
              <button
                key={o.conceptId}
                onClick={() =>
                  onAct(card.id, {
                    action: "merge",
                    into: o.conceptId,
                  } as never)
                }
                disabled={busy}
                className="rounded-md border border-border px-2.5 py-1 font-sans text-xs text-ink hover:border-accent/50 disabled:opacity-50"
              >
                {o.title}
              </button>
            ))}
            <button
              onClick={() => setMerging(false)}
              className="rounded-md px-2.5 py-1 font-sans text-xs text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => onAct(card.id, { action: "keep" } as never)}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
          >
            Keep
          </button>
          <button
            onClick={() => setMerging(true)}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink disabled:opacity-50"
          >
            Merge…
          </button>
          <button
            onClick={() => onAct(card.id, { action: "drop" } as never)}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-red-300 hover:border-red-500/40 hover:bg-red-500/10 disabled:opacity-50"
          >
            Drop
          </button>
        </div>
      )}
    </CardShell>
  );
}

function ActionRow({
  busy,
  onApprove,
  onEdit,
  onDiscard,
}: {
  busy: boolean;
  onApprove: () => void;
  onEdit?: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        onClick={onApprove}
        disabled={busy}
        className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
      >
        Approve
      </button>
      {onEdit && (
        <button
          onClick={onEdit}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink disabled:opacity-50"
        >
          Request edit
        </button>
      )}
      <button
        onClick={onDiscard}
        disabled={busy}
        className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-red-300 hover:border-red-500/40 hover:bg-red-500/10 disabled:opacity-50"
      >
        Discard
      </button>
    </div>
  );
}

function ReadOnlyBlock({
  label,
  children,
  tone,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  tone?: "accent";
  mono?: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-4 ${
        tone === "accent" ? "border-accent/30 bg-accent/5" : "border-border bg-panel"
      }`}
    >
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
        {label}
      </div>
      {mono ? (
        <pre className="max-h-72 overflow-auto font-mono text-[11px] leading-relaxed text-ink">
          {children}
        </pre>
      ) : (
        <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink">
          {children}
        </p>
      )}
    </div>
  );
}
