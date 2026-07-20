"use client";

import { useEffect, useRef, useState } from "react";
import { useConception } from "@/lib/hooks/use-conception";
import { useWorkspace } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { VoiceTextarea } from "@/components/ui/voice-textarea";
import HelperComposer from "@/components/workspace/helper-composer";
import HelperThread from "@/components/workspace/helper-thread";
import RestartPart from "@/components/workspace/restart-part";
import type {
  BrainstormCard,
  BrainstormDirection,
  CandidateConceptCard,
  ConceptObject,
  ClarityCard,
  LeapCard,
  Module1Card,
  Module1Phase,
  Module1View,
  PatentabilityCard,
  ReviewCard,
} from "@/lib/modules/conception/types";

/**
 * The Conception (Module 1) Helper surface — a card-based journey, not a chat.
 *
 * The inventor drops a raw idea in plain words; the Helper hands back a
 * formalized restatement to Approve / Edit / Discard; on approval it surfaces
 * the distinct concepts to keep, drop, or merge. New inventive content only ever
 * enters through a Leap card, in the inventor's own words.
 */
export default function ConceptionPanel({
  projectId,
  maxW = "max-w-2xl",
}: {
  projectId: string | null;
  /** Tailwind max-width for the content column; widens as sidebars collapse. */
  maxW?: string;
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

  // Scroll into view ONLY when the HELPER posts a new reply — that's the only
  // time there's something new to read at the bottom. We deliberately do NOT
  // scroll on the inventor's own turns (typing/answering/developing a concept) or
  // on Keep/Drop/Merge, so working in the concept list never yanks the view down.
  const endRef = useRef<HTMLDivElement>(null);
  const prevHelperCount = useRef(0);
  useEffect(() => {
    const helperCount = view.conversation.reduce(
      (n, t) => (t.role === "helper" ? n + 1 : n),
      0,
    );
    if (helperCount > prevHelperCount.current) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
    prevHelperCount.current = helperCount;
  }, [view.conversation]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div
          className={cn("mx-auto flex w-full flex-col gap-5 p-6", maxW)}
        >
      <header className="flex items-center justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-action">
            Stage 1 · Conception
          </div>
          <h2 className="mt-1 font-sans text-lg font-semibold text-ink">
            Turn your idea into concepts you own
          </h2>
        </div>
        {hasStatement && <RestartPart stage="conception" onRestartThis={reset} />}
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

      {/* Onboarding — the inventor describes their invention directly. (The AI
          brainstorm entry is parked for now; the module stays on the side.) */}
      {!hasStatement && (
        <div className="flex flex-col gap-4 py-2">
          <h3 className="font-sans text-lg font-semibold text-ink">
            Describe your invention
          </h3>
          <HelperComposer
            placeholder={conceptionPlaceholder(view.phase)}
            busy={busy}
            onSend={tell}
          />
        </div>
      )}

      {/* The approved formalized statement (read-only once signed off). */}
      {view.statement?.approved && (
        <ReadOnlyBlock label="Your idea, as you approved it" tone="accent">
          {view.statement.text}
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
            keptConcepts={keptConcepts}
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
          <Button
            variant="primary"
            size="lg"
            onClick={() => setStage("maturation")}
            className="mt-3"
          >
            Continue to Expansion →
          </Button>
        </div>
      )}

      {/* The Helper's voice — its short replies, tap-to-answer questions, and the
          inventor's messages. */}
      <HelperThread turns={view.conversation} onQuickReply={tell} busy={busy} />
      <div ref={endRef} />
        </div>
      </div>

      {hasStatement && (
        <div className="border-t border-border bg-panel p-4">
          <div className={cn("mx-auto w-full", maxW)}>
            <HelperComposer
              placeholder={conceptionPlaceholder(view.phase)}
              busy={busy}
              onSend={tell}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function conceptionPlaceholder(phase: Module1Phase): string {
  switch (phase) {
    case "reviewing_statement":
      return "Ask “what’s weak?” or request a change…";
    case "confirming_concepts":
      return "Ask a question, or add an idea…";
    case "complete":
      return "Ask anything, or add an idea…";
    default:
      return "Describe your invention, or paste your notes — as much as you have…";
  }
}

/**
 * The Helper's reply area — a running thread of the Helper's teaching responses
 * and the inventor's own messages. This is where the Helper TALKS to the
 * inventor (teaches, asks), instead of silently rewriting the cards.
 */
function strengthOf(
  view: Module1View,
  kept: number,
): { pct: number; label: string } {
  if (!view.statement) return { pct: 0, label: "Just getting started" };
  if (view.complete) return { pct: 100, label: "Solid — ready for Expansion" };
  let pct = view.statement.approved ? 35 : 15;
  let label = view.statement.approved ? "Core locked in" : "Core distilled";
  pct += Math.min(45, kept * 15);
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
  keptConcepts,
  onAct,
}: {
  card: Module1Card;
  busy: boolean;
  candidates: CandidateConceptCard[];
  keptConcepts: ConceptObject[];
  onAct: (cardId: string, input: never) => void;
}) {
  switch (card.type) {
    case "review":
      return <ReviewCardView card={card} busy={busy} onAct={onAct} />;
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
          keptConcepts={keptConcepts}
          onAct={onAct}
        />
      );
    case "brainstorm":
      return <BrainstormCardView card={card} busy={busy} onAct={onAct} />;
    case "patentability":
      return <PatentabilityCardView card={card} busy={busy} onAct={onAct} />;
    default:
      return null;
  }
}

/**
 * The front-door subject-matter read. Shown when the idea as described reads as a
 * business process / abstract idea: it says so plainly (no euphemism — the
 * inventor must understand it would be rejected on its own), then immediately
 * turns constructive and offers the angles where the technical invention inside
 * their idea could live. Answering one is optional; "Continue anyway" never
 * blocks.
 */
function PatentabilityCardView({
  card,
  busy,
  onAct,
}: {
  card: PatentabilityCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const [openAngle, setOpenAngle] = useState<string | null>(null);
  const [text, setText] = useState("");
  const active = card.angles.find((a) => a.angle === openAngle) ?? null;

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-amber-400">
        Before you go further
      </div>
      {card.kind && (
        <div className="mt-1 font-sans text-sm font-semibold text-ink">{card.kind}</div>
      )}
      <p className="mt-2 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink">
        {card.plainRead}
      </p>

      <div className="mt-3 border-t border-amber-500/20 pt-3">
        <div className="font-sans text-[13px] font-semibold text-ink">
          Where the patentable part is probably hiding
        </div>
        <p className="mt-0.5 font-sans text-xs text-ink-muted">
          Pick whichever one fits — then say, in your own words, what your system actually does
          there. That part is yours; nobody can write it for you.
        </p>

        <div className="mt-2 flex flex-col gap-2">
          {card.angles.map((a) => (
            <div
              key={a.angle}
              className={`rounded-md border p-2.5 transition-colors ${
                openAngle === a.angle
                  ? "border-accent/60 bg-accent/[0.06]"
                  : "border-border bg-bg"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setOpenAngle(openAngle === a.angle ? null : a.angle);
                  setText("");
                }}
                disabled={busy}
                className="w-full text-left disabled:opacity-50"
              >
                <div className="font-sans text-[13px] font-medium text-ink">{a.angle}</div>
                {a.why && (
                  <div className="mt-0.5 font-sans text-xs text-ink-muted">{a.why}</div>
                )}
              </button>

              {openAngle === a.angle && (
                <div className="mt-2">
                  {a.ask && (
                    <p className="mb-1.5 font-sans text-[13px] font-medium text-accent">{a.ask}</p>
                  )}
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={4}
                    autoFocus
                    placeholder="In your own words — what does your system actually do here?"
                    className="w-full resize-y rounded-md border border-border bg-panel p-2 font-sans text-[13px] leading-relaxed text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        onAct(card.id, {
                          action: "develop",
                          angle: a.angle,
                          text: text.trim(),
                        } as never)
                      }
                      disabled={busy || !text.trim()}
                      className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
                    >
                      This is mine
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {card.reassurance && !active && (
        <p className="mt-3 font-sans text-xs italic text-ink-muted">{card.reassurance}</p>
      )}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => onAct(card.id, { action: "dismiss" } as never)}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink disabled:opacity-50"
        >
          Continue anyway
        </button>
      </div>
    </div>
  );
}

function BrainstormCardView({
  card,
  busy,
  onAct,
}: {
  card: BrainstormCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [text, setText] = useState("");
  // The "Tell me more" teaching-chat modal, scoped to one direction (null = closed).
  const [teachDir, setTeachDir] = useState<BrainstormDirection | null>(null);
  // The tutor transcript carried over when the inventor uses their answer — sent with the
  // develop action as CONTEXT (the journey), then cleared.
  const [tutorTranscript, setTutorTranscript] = useState<
    { role: "user" | "assistant"; content: string }[] | null
  >(null);
  // Optimistic "Captured" marks: flip the instant the inventor clicks, instead of
  // waiting several seconds for the server to build the concept and return the
  // `developed` flag. The server's flag reconciles (and persists) when it arrives.
  const [taken, setTaken] = useState<Set<string>>(() => new Set());
  const isDone = (dir: string) => (card.developed?.includes(dir) ?? false) || taken.has(dir);
  return (
    <div className="rounded-md border border-accent/40 bg-accent/5 p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-accent">
        Directions worth developing
      </div>
      <p className="font-mono text-xs leading-relaxed text-ink-muted">{card.intro}</p>
      <div className="mt-3 space-y-2">
        {card.directions.map((d, i) => {
          const open = openIdx === i;
          const done = isDone(d.direction);
          return (
            <div
              key={i}
              className={`rounded-md border p-3 ${
                done ? "border-accent/30 bg-accent/5 opacity-60" : "border-border bg-bg"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-sans text-sm font-semibold text-ink">{d.direction}</div>
                {done && (
                  <span className="shrink-0 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.15em] text-accent">
                    ✓ Captured
                  </span>
                )}
              </div>
              <p className="mt-1 font-mono text-[11px] leading-relaxed text-ink-muted">
                {d.why_it_might_be_patentable}
              </p>
              {!done && (
                <p className="mt-2 font-mono text-[11px] italic text-ink-muted">
                  {d.invite_to_develop}
                </p>
              )}
              {done ? null : open ? (
                <>
                  <VoiceTextarea
                    value={text}
                    onChange={setText}
                    rows={4}
                    placeholder="Develop this in your own words — how it actually works…"
                    className="mt-2 w-full resize-y rounded-md border border-border bg-panel p-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <Button variant="secondary" onClick={() => setTeachDir(d)}>
                      <HelpIcon />
                      Tell me more about this
                    </Button>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setOpenIdx(null);
                          setText("");
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => {
                        // Mark done immediately (optimistic) — don't wait for the
                        // concept to build server-side.
                        setTaken((prev) => new Set(prev).add(d.direction));
                        onAct(card.id, {
                          action: "develop",
                          direction: d.direction,
                          text: text.trim(),
                          ...(tutorTranscript ? { tutorTranscript } : {}),
                        } as never);
                        setOpenIdx(null);
                        setText("");
                        setTutorTranscript(null);
                      }}
                      // Not gated on `busy`: submitting queues the request (it runs
                      // in order in the background) so you can develop the next
                      // direction immediately. Re-submitting THIS one is blocked by
                      // its instant "✓ Captured" state, which removes this button.
                      disabled={!text.trim()}
                    >
                      This is mine →
                    </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <Button variant="secondary" onClick={() => setTeachDir(d)}>
                    <HelpIcon />
                    Tell me more about this
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setOpenIdx(i);
                      setText("");
                    }}
                  >
                    In your own words →
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* No "Done — move on" here on purpose: developing a direction carries it
          forward on its own, and the single "Continue to Expansion" (shown once
          you've captured a concept) is the only move-on. A dismiss step here made
          people think their captured concepts had to be "finished" and got lost. */}
      {teachDir && (
        <TellMeMoreModal
          direction={teachDir}
          onClose={() => setTeachDir(null)}
          onUseAnswer={(answer, transcript) => {
            const dir = teachDir.direction;
            const idx = card.directions.findIndex((x) => x.direction === dir);
            if (answer.trim()) {
              // They went through Tell me more and landed: "Use this as mine"
              // COMMITS right here — one button finishes it, no second click on the
              // card. Their verbatim words + the tutor transcript (as context) are
              // captured directly.
              setTaken((prev) => new Set(prev).add(dir));
              onAct(card.id, {
                action: "develop",
                direction: dir,
                text: answer.trim(),
                ...(transcript ? { tutorTranscript: transcript } : {}),
              } as never);
              setOpenIdx(null);
              setText("");
              setTutorTranscript(null);
            } else if (idx >= 0) {
              // "Skip — I'll write it myself": just open the develop box to type in.
              setOpenIdx(idx);
              setText("");
            }
            setTeachDir(null);
          }}
        />
      )}
    </div>
  );
}

/** Circled question-mark icon for the "Tell me more" tutor buttons. */
function HelpIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/** Render the tutor's lightweight markdown so raw asterisks never show through: **bold**
 *  (which may contain *italic*), and *italic*. Non-greedy and within a line, so unbalanced
 *  markers don't swallow across paragraphs. Newlines handled by whitespace-pre-wrap. */
function renderRich(text: string) {
  const nodes = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    }
    if (m[1] !== undefined) {
      nodes.push(
        <strong key={key++} className="font-semibold text-ink">
          {renderRich(m[1])}
        </strong>,
      );
    } else {
      nodes.push(<em key={key++}>{m[2]}</em>);
    }
    last = regex.lastIndex;
  }
  if (last < text.length) {
    nodes.push(<span key={key++}>{text.slice(last)}</span>);
  }
  return nodes;
}

/**
 * "Tell me more about this" — a scoped teaching chat for ONE direction. The AI coaches the
 * inventor toward a STRONGER answer they can develop in their own words; it never authors the
 * inventive mechanism (that stays human). Opens over /api/conception/teach.
 */
function TellMeMoreModal({
  direction,
  onClose,
  onUseAnswer,
}: {
  direction: BrainstormDirection;
  onClose: () => void;
  onUseAnswer: (
    answer: string,
    transcript: { role: "user" | "assistant"; content: string }[],
  ) => void;
}) {
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [scaffold, setScaffold] = useState<{ intro: string; template: string; hint?: string} | null>(null);
  const startedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const projectId = useWorkspace((s) => s.projectId);
  // Persist this teaching chat per project + direction, so a reload continues it.
  const storageKey = `geyser_tutor_${projectId ?? "none"}::${direction.direction}`;
  // Their most recent answer — what "Use this as mine" claims once the teacher affirms.
  const lastUserText =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const send = async (userText: string) => {
    const t = userText.trim();
    const outgoing = t
      ? [...messages, { role: "user" as const, content: t }]
      : messages;
    if (t) {
      setMessages(outgoing);
      setInput("");
      // Answering (via the mad lib or the ask bar) retires the current step's
      // question — the next reply brings the next step's mad lib.
      setScaffold(null);
    }
    setBusy(true);
    try {
      const res = await fetch("/api/conception/teach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          direction: {
            direction: direction.direction,
            why: direction.why_it_might_be_patentable,
            invite: direction.invite_to_develop,
          },
          messages: outgoing,
        }),
      });
      const data = (await res.json()) as {
        reply?: string;
        scaffold?: { intro: string; template: string; hint?: string} | null;
      };
      if (data.reply) {
        setMessages([...outgoing, { role: "assistant", content: data.reply }]);
      }
      // This step's mad-lib question (or null once they've reached the answer and
      // the teacher is affirming).
      setScaffold(data.scaffold && data.scaffold.template?.trim() ? data.scaffold : null);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  // Open the conversation: CONTINUE a stored one if it exists (a reload picks up where you
  // left off), otherwise start with an initial teaching turn.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const stored = JSON.parse(raw) as
          | { role: "user" | "assistant"; content: string }[] // legacy shape
          | {
              messages: { role: "user" | "assistant"; content: string }[];
              scaffold: { intro: string; template: string; hint?: string} | null;
            };
        if (Array.isArray(stored)) {
          if (stored.length) {
            setMessages(stored);
            return;
          }
        } else if (stored?.messages?.length) {
          setMessages(stored.messages);
          if (stored.scaffold?.template) setScaffold(stored.scaffold);
          return;
        }
      }
    } catch {
      /* corrupt / unavailable — start fresh */
    }
    void send("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the conversation + the live scaffold so a reload can continue both.
  useEffect(() => {
    if (!messages.length) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ messages, scaffold }));
    } catch {
      /* quota / unavailable — best effort */
    }
  }, [messages, scaffold, storageKey]);

  // Keep the newest message in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-full max-w-4xl flex-col rounded-lg border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">
              Tell me more
            </div>
            <div className="mt-0.5 font-sans text-sm font-semibold text-ink">
              {direction.direction}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md px-2 py-1 font-mono text-xs text-ink-muted transition-colors hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "flex",
                m.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[88%] whitespace-pre-wrap rounded-md px-4 py-3 font-sans text-[15px] leading-7",
                  m.role === "user"
                    ? "bg-accent/15 text-ink"
                    : "border border-border bg-bg text-ink",
                )}
              >
                {renderRich(m.content)}
              </div>
            </div>
          ))}
          {busy && (
            <div className="font-mono text-xs text-ink-muted">Thinking…</div>
          )}
        </div>

        {scaffold && (
          <ScaffoldFill
            key={scaffold.template}
            scaffold={scaffold}
            busy={busy}
            onAnswer={(assembled) => void send(assembled)}
          />
        )}

        {/* Stopped: the teacher has nothing more to add (no more questions). It
            does NOT judge whether the answer is right — it just hands their own
            words back to use. One click takes them into the develop box. */}
        {!scaffold &&
          !busy &&
          lastUserText &&
          messages[messages.length - 1]?.role === "assistant" && (
            <div className="flex items-center justify-between gap-3 border-t border-accent/40 bg-accent/10 p-3">
              <p className="min-w-0 font-sans text-[13px] text-ink">
                <span className="font-semibold">That&apos;s yours to use.</span>{" "}
                <span className="text-ink-muted">
                  Take what you just said as your answer — you can keep editing it there.
                </span>
              </p>
              <Button
                variant="primary"
                onClick={() => onUseAnswer(lastUserText, messages)}
                className="shrink-0"
              >
                Use this as mine →
              </Button>
            </div>
          )}

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && input.trim() && !busy) void send(input);
              }}
              placeholder="Ask the teacher anything — or tell it what you're thinking…"
              className="min-w-0 flex-1 rounded-md border border-border bg-bg px-3 py-2.5 font-sans text-[15px] text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
            />
            <Button
              variant="primary"
              onClick={() => void send(input)}
              disabled={busy || !input.trim()}
            >
              {busy ? "…" : "Ask"}
            </Button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="font-mono text-[10px] italic leading-relaxed text-ink-muted">
              {scaffold
                ? "Or just talk it through above — the teacher follows either way."
                : "The teacher walks you through it a step at a time; answer in your own words."}
            </p>
            <button
              type="button"
              onClick={() => onUseAnswer("", messages)}
              className="shrink-0 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-accent"
            >
              Skip — I&apos;ll write it myself →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type ScaffoldPart =
  | { text: string; blank?: false }
  | { blank: true; label: string; index: number };

/** Split "Unlike tools that [what they do], this works by [your move]." into fixed
 *  text and the [bracketed] blanks the inventor fills. */
function splitTemplate(template: string): ScaffoldPart[] {
  const parts: ScaffoldPart[] = [];
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) parts.push({ text: template.slice(last, m.index) });
    parts.push({ blank: true, label: m[1].trim(), index: idx++ });
    last = re.lastIndex;
  }
  if (last < template.length) parts.push({ text: template.slice(last) });
  return parts;
}

/**
 * The Mad-Libs scaffold — THIS teaching step's question, shaped as a sentence with
 * fill-in blanks the inventor completes. The fixed words are the tutor's setup; the
 * blanks are the inventor's to fill. "Answer →" sends the filled sentence back so
 * the teacher gives the next step. Committing the answer is deliberately NOT offered
 * here — that only appears once the teacher has stopped (the landed banner).
 */
function ScaffoldFill({
  scaffold,
  busy,
  onAnswer,
}: {
  scaffold: { intro: string; template: string; hint?: string};
  busy: boolean;
  onAnswer: (assembled: string) => void;
}) {
  const parts = splitTemplate(scaffold.template);
  const blankCount = parts.filter((p) => p.blank).length;
  const [values, setValues] = useState<string[]>(() => Array(blankCount).fill(""));
  // The hint is OFF by default and is TEACHING, not options — it hands a stuck
  // inventor a way to work out THEIR own answer, never candidate answers to pick.
  const [showHint, setShowHint] = useState(false);
  const hint = scaffold.hint?.trim() ?? "";
  const assembled = parts
    .map((p) => (p.blank ? (values[p.index] ?? "").trim() : p.text))
    .join("");
  const allFilled = blankCount > 0 && values.slice(0, blankCount).every((v) => v.trim());

  return (
    <div className="border-t border-border bg-accent/5 p-3">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-accent">
        Answer this step
      </div>
      {scaffold.intro && (
        <p className="mb-2 font-sans text-[13px] text-ink-muted">{scaffold.intro}</p>
      )}
      <p className="font-sans text-[15px] leading-10 text-ink">
        {parts.map((p, i) =>
          p.blank ? (
            // A one-line TEXTAREA, not an input: Chromium's ID-card/address/payment
            // autofill only targets <input>, so this kills the "Save ID card?" popup.
            // Each blank carries its own suggestion chips beneath it — starting
            // points to tap and edit, never the sole answer.
            <span key={i} className="inline-flex flex-col align-middle">
              <textarea
                rows={1}
                value={values[p.index] ?? ""}
                onChange={(e) => {
                  const next = [...values];
                  next[p.index] = e.target.value.replace(/\n/g, " ");
                  setValues(next);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
                placeholder={p.label}
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                style={{
                  width: `${Math.max(p.label.length, (values[p.index] ?? "").length || 6) + 2}ch`,
                }}
                className="mx-1 inline-block min-w-[6rem] max-w-full resize-none overflow-hidden whitespace-nowrap rounded border-b-2 border-accent/50 bg-accent/10 px-2 py-0.5 align-middle font-sans text-[15px] leading-normal text-ink placeholder:text-ink-muted/70 focus:border-accent focus:outline-none"
              />
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </p>

      {/* The teaching hint — revealed only when asked for. It teaches how to work
          out the answer; it is never the answer and never a set of options. */}
      {showHint && hint && (
        <div className="mt-2 rounded-md border border-accent/30 bg-accent/[0.06] p-2.5">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.1em] text-accent">
            A way to think about it
          </div>
          <p className="font-sans text-[13px] leading-relaxed text-ink">{hint}</p>
        </div>
      )}
      {/* Only ONE action mid-teaching: submit this step and keep going. Committing
          the whole thing ("Use this as mine") is deliberately withheld until the
          teacher has nothing left to add — offering it here invites the inventor to
          lock in a half-formed answer. */}
      <div className="mt-3 flex items-center justify-between gap-2">
        {hint ? (
          <button
            type="button"
            onClick={() => setShowHint((v) => !v)}
            className="font-mono text-[11px] text-ink-muted transition-colors hover:text-accent"
          >
            {showHint ? "Hide hint" : "💡 Stuck? Get a hint"}
          </button>
        ) : (
          <span />
        )}
        <Button variant="primary" onClick={() => onAnswer(assembled)} disabled={!allFilled || busy}>
          {busy ? "…" : "Answer →"}
        </Button>
      </div>
    </div>
  );
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
          <VoiceTextarea
            value={text}
            onChange={setText}
            rows={4}
            placeholder="Rewrite it in your own words…"
            className="w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
          />
          <div className="mt-2 flex gap-2">
            <Button
              variant="primary"
              onClick={() =>
                onAct(card.id, {
                  action: "request_edit",
                  correction: text.trim(),
                } as never)
              }
              disabled={busy || !text.trim()}
            >
              Send my version
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
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
      <VoiceTextarea
        value={text}
        onChange={setText}
        rows={3}
        placeholder="Answer in your own words…"
        className="w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex justify-end">
        <Button
          variant="primary"
          onClick={() => onAct(card.id, { answer: text.trim() } as never)}
          disabled={busy || !text.trim()}
        >
          Answer →
        </Button>
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
        The Helper can brainstorm angles and explain what tends to make something
        registrable — but this specific idea has to be yours, in your own words.
      </p>
      <VoiceTextarea
        value={text}
        onChange={setText}
        rows={4}
        placeholder="Describe the idea yourself…"
        className="mt-2 w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex justify-end">
        <Button
          variant="primary"
          onClick={() => onAct(card.id, { idea: text.trim() } as never)}
          disabled={busy || !text.trim()}
        >
          This is mine →
        </Button>
      </div>
    </div>
  );
}

function CandidateCardView({
  card,
  busy,
  candidates,
  keptConcepts,
  onAct,
}: {
  card: CandidateConceptCard;
  busy: boolean;
  candidates: CandidateConceptCard[];
  keptConcepts: ConceptObject[];
  onAct: (cardId: string, input: never) => void;
}) {
  const [merging, setMerging] = useState(false);
  // Merge targets: the OTHER undecided concepts + the ones you've already kept (kept
  // concepts lose their card, so without this you couldn't merge into them). Merging
  // regenerates the target concept to fold both ideas together (server-side).
  const others = candidates.filter((c) => c.conceptId !== card.conceptId);
  const targets: { id: string; title: string; kept: boolean }[] = [
    ...others.map((c) => ({ id: c.conceptId, title: c.title, kept: false })),
    ...keptConcepts
      .filter(
        (c) => c.id !== card.conceptId && !others.some((o) => o.conceptId === c.id),
      )
      .map((c) => ({ id: c.id, title: c.title, kept: true })),
  ];
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
            {targets.length === 0 && (
              <span className="font-mono text-[11px] text-ink-muted">
                No other concepts to merge into.
              </span>
            )}
            {targets.map((t) => (
              <Button
                key={t.id}
                variant="secondary"
                size="sm"
                onClick={() =>
                  onAct(card.id, {
                    action: "merge",
                    into: t.id,
                  } as never)
                }
                disabled={busy}
              >
                {t.title}
                {t.kept ? " ✓ kept" : ""}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setMerging(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={() => onAct(card.id, { action: "keep" } as never)}
            disabled={busy}
          >
            ✓ Keep this
          </Button>
          <Button
            variant="secondary"
            onClick={() => setMerging(true)}
            disabled={busy}
          >
            Merge…
          </Button>
          <Button
            variant="danger"
            onClick={() => onAct(card.id, { action: "drop" } as never)}
            disabled={busy}
          >
            Drop
          </Button>
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
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Button variant="primary" onClick={onApprove} disabled={busy}>
        ✓ Approve
      </Button>
      {onEdit && (
        <Button variant="secondary" onClick={onEdit} disabled={busy}>
          Request edit
        </Button>
      )}
      <Button variant="danger" onClick={onDiscard} disabled={busy}>
        Discard
      </Button>
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
