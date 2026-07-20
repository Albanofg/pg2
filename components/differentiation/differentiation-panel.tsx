"use client";

import { useEffect, useRef, useState } from "react";
import { useDifferentiation } from "@/lib/hooks/use-differentiation";
import { useWorkspace } from "@/lib/store";
import HelperComposer from "@/components/workspace/helper-composer";
import HelperThread from "@/components/workspace/helper-thread";
import RestartPart from "@/components/workspace/restart-part";
import type {
  CertificationCard,
  DifferentiationReviewCard,
  GapCard,
  KeyConceptCard,
  Module4Card,
  NoveltyCaptureCard,
  WhitespaceCard,
  WhitespaceTeaching,
} from "@/lib/modules/differentiation/types";

/**
 * Stage 4 — Differentiation. The heavy moment. Per concept: read the factual gap
 * (what the art covers + the open points), state in your OWN words what's
 * genuinely new, approve the formalized differentiation, then anchor which become
 * your Key Concepts.
 */
export default function DifferentiationPanel({
  projectId,
  maxW = "max-w-2xl",
}: {
  projectId: string | null;
  maxW?: string;
}) {
  const { view, busy, error, blocked, ready, act, tell, prepareNext, compile, restart } =
    useDifferentiation(projectId);
  const setStage = useWorkspace((s) => s.setStage);
  const working = busy || !ready;
  const keyConcepts = view.concepts.filter((c) => c.isKeyConcept);
  const activeConcepts = view.concepts.filter((c) => c.status.state === "active");
  const differentiated = activeConcepts.filter((c) => c.differentiation_statement);

  // Pipeline, one at a time: while the inventor answers THIS concept, quietly
  // prepare the NEXT one's analysis + lesson in the background — so "This is
  // mine" advances instantly. Fires once per on-screen concept.
  const currentConceptId =
    view.cards.find((c) => c.type === "novelty_capture")?.conceptId ?? null;
  const preparedForRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!currentConceptId || preparedForRef.current.has(currentConceptId)) return;
    preparedForRef.current.add(currentConceptId);
    prepareNext();
  }, [currentConceptId, prepareNext]);

  // A new concept just loaded (or the phase moved on) — start the reader at the
  // top of its lesson, not wherever the previous concept left the scroll.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [currentConceptId, view.phase]);

  // The last anchor flips the phase to "compiling" and returns instantly; the
  // heavy step (nine sections + certification) runs as its own request, with an
  // honest progress message below. Fire once.
  const compileFiredRef = useRef(false);
  useEffect(() => {
    if (view.phase === "compiling" && !busy && !compileFiredRef.current) {
      compileFiredRef.current = true;
      void compile();
    }
  }, [view.phase, busy, compile]);
  // The lesson's fill-in-the-blanks answer — assembled in the whitespace teaching,
  // dropped into the novelty box below (still editable; "This is mine" submits it).
  // Keyed by concept so one concept's answer NEVER leaks into the next one's box.
  // `blanks` rides along so the checker can mark the specific wrong slot on a fail.
  const [scaffoldAnswer, setScaffoldAnswer] = useState<{
    conceptId: string;
    text: string;
    blanks: { label: string; value: string }[];
  } | null>(null);

  // The checker's flagged slots for the on-screen concept — carries each slot's
  // label AND the concrete reason, so the mad lib can show the help right at the
  // slot instead of just marking it red.
  const noveltyFeedback = view.cards.find(
    (c) => c.type === "novelty_capture" && c.feedback,
  ) as Extract<Module4Card, { type: "novelty_capture" }> | undefined;
  const wrongBlanks = noveltyFeedback?.feedback?.wrongBlanks ?? [];

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div
          className={`mx-auto flex w-full flex-col gap-5 p-6 ${maxW}`}
        >
          <header className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-action">
                Stage 4 · Differentiation
              </div>
              <h2 className="mt-1 font-sans text-lg font-semibold text-ink">
                {view.phase === "anchoring"
                  ? "Choose which become your Key Concepts"
                  : view.phase === "compiling"
                    ? "Compiling your Invention Concept Blueprint"
                    : view.phase === "certifying"
                      ? "Certifying inventorship"
                      : view.phase === "complete"
                        ? "Your Key Concepts are set"
                        : "Say what's genuinely new — against what already exists"}
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <RestartPart stage="differentiation" onRestartThis={restart} />
              <button
                onClick={() => setStage("landscape")}
                className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-accent"
              >
                ← Landscape
              </button>
            </div>
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
                {view.phase === "compiling"
                  ? "Compiling your Invention Concept Blueprint — nine sections drafted one by one, then inventorship certified. This takes a few minutes; it's working, not stuck."
                  : view.phase === "certifying"
                    ? "Certifying inventorship for each Key Concept…"
                    : view.cards.length === 0 && !view.disclosure
                      ? "The Helper is mapping what already exists… this can take a moment."
                      : "Working…"}
              </span>
            </div>
          )}

          {/* Prior stages not finished yet — an EXPECTED gate, shown plainly with a
              way to go finish the missing one (never the red "Helper" error). */}
          {!working && blocked && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-5 text-center">
              <p className="font-sans text-sm font-medium text-ink">{blocked.message}</p>
              <p className="mt-1 font-mono text-xs leading-relaxed text-ink-muted">
                Differentiation builds on the earlier stages — finish{" "}
                {blocked.stage === "maturation" ? "Maturation" : "Landscape"} and it opens up here.
              </p>
              <div className="mt-3 flex justify-center">
                <button
                  onClick={() => setStage(blocked.stage)}
                  className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-medium text-brand hover:bg-accent/90"
                >
                  Go to {blocked.stage === "maturation" ? "Maturation" : "Landscape"} →
                </button>
              </div>
            </div>
          )}

          {!working && !blocked && view.cards.length === 0 && view.concepts.length === 0 && !view.complete && (
            <div className="rounded-md border border-border bg-panel p-5 text-center">
              <p className="font-mono text-xs leading-relaxed text-ink-muted">
                Nothing to differentiate yet — finish Maturation and Landscape first.
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

          {/* Where you are: differentiations are one-at-a-time. Big and explicit —
              the user must SEE that the previous concept landed and a new one is up. */}
          {view.phase === "capturing" && activeConcepts.length > 0 && view.cards.length > 0 && (
            <div className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="font-sans text-lg font-bold text-ink">
                  Concept {Math.min(differentiated.length + 1, activeConcepts.length)}{" "}
                  <span className="font-medium text-ink-muted">of {activeConcepts.length}</span>
                </div>
                <div className="h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{
                      width: `${Math.round((differentiated.length / activeConcepts.length) * 100)}%`,
                    }}
                  />
                </div>
              </div>
              <p className="mt-0.5 font-sans text-sm text-ink-muted">
                {differentiated.length > 0 ? (
                  <>
                    <span className="font-medium text-emerald-400">
                      ✓ Concept {differentiated.length} is set
                    </span>{" "}
                    — let&apos;s tackle concept{" "}
                    {Math.min(differentiated.length + 1, activeConcepts.length)}.
                  </>
                ) : (
                  "One at a time — read the lesson, then say what makes this one yours."
                )}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {view.cards.map((card) => (
              <CardView
                key={card.id}
                card={card}
                busy={busy}
                onAct={act}
                scaffoldAnswer={scaffoldAnswer}
                wrongBlanks={wrongBlanks}
                onUseScaffold={(answer) => {
                  setScaffoldAnswer(answer);
                  // Land the user on their prefilled answer — the novelty card
                  // sits below the lesson, out of view on long lessons.
                  requestAnimationFrame(() => {
                    document
                      .getElementById(`novelty-${answer.conceptId}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  });
                }}
              />
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

          {/* The ICB draft is NOT shown here — it lives in Showcase (the final step),
              where it's tabbed, editable, and polishable. Differentiation only
              compiles it in the background and carries it forward. */}

          {view.complete && (
            <div className="rounded-md border border-accent/40 bg-accent/10 p-4 text-center">
              <p className="font-sans text-sm font-medium text-ink">
                Differentiation complete — {keyConcepts.length} Key Concept
                {keyConcepts.length === 1 ? "" : "s"} anchored, inventorship
                certified, and the Invention Disclosure drafted.
              </p>
              <button
                onClick={() => setStage("genus_species")}
                className="mt-3 rounded-md bg-accent px-5 py-2.5 font-sans text-sm font-medium text-brand transition-colors hover:bg-accent/90"
              >
                Continue to Genus &amp; Species →
              </button>
            </div>
          )}

          <HelperThread turns={view.conversation} onQuickReply={tell} busy={busy} />
        </div>
      </div>

      <div className="border-t border-border bg-panel p-4">
        <div className={`mx-auto w-full ${maxW}`}>
          <HelperComposer
            placeholder="Ask the Helper anything…"
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
  scaffoldAnswer,
  wrongBlanks,
  onUseScaffold,
}: {
  card: Module4Card;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
  scaffoldAnswer: {
    conceptId: string;
    text: string;
    blanks: { label: string; value: string }[];
  } | null;
  wrongBlanks: { slot: number; label: string; why: string }[];
  onUseScaffold: (answer: {
    conceptId: string;
    text: string;
    blanks: { label: string; value: string }[];
  }) => void;
}) {
  switch (card.type) {
    case "whitespace":
      return (
        <WhitespaceView
          card={card}
          wrongBlanks={wrongBlanks}
          onUseScaffold={(text, blanks) =>
            onUseScaffold({ conceptId: card.conceptId, text, blanks })
          }
        />
      );
    case "gap":
      return <GapView card={card} />;
    case "novelty_capture": {
      const mine = scaffoldAnswer?.conceptId === card.conceptId ? scaffoldAnswer : null;
      return (
        <NoveltyCaptureView
          card={card}
          busy={busy}
          onAct={onAct}
          prefill={mine?.text ?? null}
          prefillBlanks={mine?.blanks ?? null}
        />
      );
    }
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

function WhitespaceView({
  card,
  wrongBlanks,
  onUseScaffold,
}: {
  card: WhitespaceCard;
  wrongBlanks: { slot: number; label: string; why: string }[];
  onUseScaffold: (assembled: string, blanks: { label: string; value: string }[]) => void;
}) {
  const a = card.analysis;
  const level = a.overallMatchLevel.level;
  const badge =
    level === "Green Match"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
      : level === "Yellow Match"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
        : "border-red-500/40 bg-red-500/10 text-red-400";
  const t = card.teaching;
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
          {t ? "Let's find your difference" : "Open landscape"} · {a.totalPatentsAnalyzed} reference
          {a.totalPatentsAnalyzed === 1 ? "" : "s"} checked
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] ${badge}`}
        >
          {level}
        </span>
      </div>
      <div className="mt-1 font-sans text-sm font-semibold text-ink">{card.title}</div>

      {/* PRIMARY VIEW: the short lesson (or a concise summary if the lesson is absent). */}
      {t ? (
        <TeachingLesson t={t} wrongBlanks={wrongBlanks} onUseScaffold={onUseScaffold} />
      ) : (
        <WhitespaceFallback a={a} />
      )}

      {/* SECONDARY: the full raw analysis, always tucked behind a disclosure. */}
      <details className="group mt-4">
        <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted hover:text-ink">
          <span className="group-open:hidden">▸ View the full landscape analysis</span>
          <span className="hidden group-open:inline">▾ Hide the full landscape analysis</span>
        </summary>
        <div className="mt-3 border-t border-border pt-3">
          <WhitespaceRawAnalysis a={a} />
        </div>
      </details>
    </div>
  );
}

/** Concise primary view when the teacher didn't produce a lesson — never a wall. */
function WhitespaceFallback({ a }: { a: WhitespaceCard["analysis"] }) {
  return (
    <div className="mt-3 space-y-3 font-sans text-[13px] leading-relaxed text-ink">
      {a.primaryDistinguishingFeatures.length > 0 ? (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/[0.06] p-2.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-emerald-400/90">
            What looks distinct here
          </p>
          <ul className="mt-1 list-disc pl-4 text-ink">
            {a.primaryDistinguishingFeatures.slice(0, 4).map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-ink-muted">
          We checked {a.totalPatentsAnalyzed} nearby reference
          {a.totalPatentsAnalyzed === 1 ? "" : "s"}. The full breakdown is below — but the one
          sentence that matters is yours to write.
        </p>
      )}
      <p className="text-ink-muted">Full landscape breakdown is tucked below if you want it.</p>
    </div>
  );
}

/** The concise, scannable plain-English lesson — the primary whitespace view. */
function TeachingLesson({
  t,
  wrongBlanks,
  onUseScaffold,
}: {
  t: WhitespaceTeaching;
  wrongBlanks: { slot: number; label: string; why: string }[];
  onUseScaffold: (assembled: string, blanks: { label: string; value: string }[]) => void;
}) {
  return (
    <div className="mt-3 space-y-3 font-sans text-[13px] leading-relaxed text-ink">
      {t.intro && <p>{t.intro}</p>}

      {t.buckets.length > 0 && (
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
            What&apos;s already out there
          </p>
          {t.buckets.map((b, i) => (
            <div key={i} className="rounded border border-border bg-bg p-2.5">
              {b.label && <div className="font-semibold text-ink">{b.label}</div>}
              {b.plain && <p className="mt-0.5 text-ink-muted">{b.plain}</p>}
              {b.not_you && <p className="mt-1 text-[12px] italic text-amber-400/90">{b.not_you}</p>}
            </div>
          ))}
        </div>
      )}

      {t.distinction && (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/[0.06] p-2.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-emerald-400/90">
            The opening
          </p>
          <p className="mt-1 text-ink">{t.distinction}</p>
        </div>
      )}

      {t.key_terms.length > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
            Words to reuse
          </p>
          <dl className="mt-1 space-y-1">
            {t.key_terms.map((k, i) => (
              <div key={i} className="text-[12px]">
                <dt className="inline font-semibold text-ink">{k.term}</dt>
                <dd className="inline text-ink-muted"> — {k.meaning}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {t.analogy && (
        <p className="border-l-2 border-border pl-3 text-[12px] italic text-ink-muted">
          {t.analogy}
        </p>
      )}

      {t.scaffold && (
        <DiffScaffoldFill
          template={t.scaffold}
          wrongBlanks={wrongBlanks}
          keyTerms={t.key_terms.map((k) => k.term).filter(Boolean)}
          onUse={onUseScaffold}
        />
      )}

      {t.prompt && <p className="font-semibold text-ink">{t.prompt}</p>}
    </div>
  );
}

type DiffScaffoldPart =
  | { text: string; blank?: false }
  | { blank: true; label: string; index: number };

/** Split the lesson's scaffold into fixed text and its [bracketed] blanks. */
function splitDiffTemplate(template: string): DiffScaffoldPart[] {
  const parts: DiffScaffoldPart[] = [];
  const re = /\[([^\]]*)\]/g;
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
 * The lesson's Mad Lib — the "way to say it" as inline fill-in slots instead of
 * dead text, so the inventor doesn't retype the whole differentiation. The fixed
 * words are the teacher's setup; the slots are the inventor's. This is a HELP, not
 * a test: the inventor's own key terms sit below as tappable chips (tap to drop a
 * word into the slot you're in), and when the checker flags a slot the concrete
 * reason shows right under it — never just a red mark.
 */
function DiffScaffoldFill({
  template,
  wrongBlanks,
  keyTerms,
  onUse,
}: {
  template: string;
  wrongBlanks: { slot: number; label: string; why: string }[];
  keyTerms: string[];
  onUse: (assembled: string, blanks: { label: string; value: string }[]) => void;
}) {
  const parts = splitDiffTemplate(template);
  const blanks = parts.filter((p): p is Extract<DiffScaffoldPart, { blank: true }> => !!p.blank);
  const blankCount = blanks.length;
  const [values, setValues] = useState<string[]>(() => Array(blankCount).fill(""));
  // The slot a chip-tap drops into: the one the inventor last touched (defaults to
  // the first empty slot).
  const [focused, setFocused] = useState(0);
  // Flips to a "✓ done" state once sent to the answer box; editing a blank re-arms it.
  const [used, setUsed] = useState(false);
  const assembled = parts
    .map((p) => (p.blank ? (values[p.index] ?? "").trim() : p.text))
    .join("");
  const allFilled = blankCount > 0 && values.slice(0, blankCount).every((v) => v.trim());
  const filledBlanks = () =>
    blanks.map((b) => ({ label: b.label, value: (values[b.index] ?? "").trim() }));
  // Match a flagged slot to a box by POSITION (slot number → blank index) — robust
  // even when the checker paraphrases the label. Falls back to a normalized-label
  // match only if no slot number was given.
  const norm = (s: string) =>
    s.toLowerCase().replace(/[[\]?.,;:!]/g, "").replace(/\s+/g, " ").trim();
  const whyForIndex = (index: number, label: string): string | null => {
    const bySlot = wrongBlanks.find((w) => w.slot > 0 && w.slot - 1 === index);
    if (bySlot) return bySlot.why || "This part overlaps with the existing art — reword it.";
    const byLabel = wrongBlanks.find((w) => w.slot <= 0 && norm(w.label) === norm(label));
    return byLabel ? byLabel.why || "This part overlaps with the existing art — reword it." : null;
  };
  // Did any flag actually resolve to a slot on screen? Only then do we mark the
  // other slots green ("that part's good") — never paint everything green when we
  // couldn't locate the wrong one.
  const anyResolved = blanks.some((b) => whyForIndex(b.index, b.label) !== null);
  const insertTerm = (term: string) => {
    setValues((prev) => {
      const next = [...prev];
      const cur = (next[focused] ?? "").trim();
      next[focused] = cur ? `${cur} ${term}` : term;
      return next;
    });
    setUsed(false);
  };

  return (
    <div className="rounded border border-dashed border-accent/40 bg-accent/[0.04] p-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-accent">
        A way to say it — put it in your own words
      </p>
      <p className="mt-1 text-[13px] leading-9 text-ink">
        {parts.map((p, i) =>
          p.blank ? (
            // A one-line TEXTAREA, not an input: Chromium's ID-card/address/payment
            // autofill only targets <input>, so this kills the "Save ID card?" popup.
            // A slot the checker flagged turns red AND shows why right beneath it;
            // an un-flagged slot after a check turns green (that part's good).
            <span key={i} className="inline-flex flex-col align-middle">
              <textarea
                rows={1}
                value={values[p.index] ?? ""}
                onFocus={() => setFocused(p.index)}
                onChange={(e) => {
                  const next = [...values];
                  next[p.index] = e.target.value.replace(/\n/g, " ");
                  setValues(next);
                  setUsed(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
                placeholder={p.label || "your words"}
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                style={{
                  width: `${Math.max((p.label || "your words").length, (values[p.index] ?? "").length || 6) + 2}ch`,
                }}
                className={`mx-1 inline-block min-w-[6rem] max-w-full resize-none overflow-hidden whitespace-nowrap rounded border-b-2 px-2 py-0.5 align-middle font-sans text-[13px] leading-normal text-ink placeholder:text-ink-muted/70 focus:outline-none ${
                  whyForIndex(p.index, p.label)
                    ? // flagged by the checker — this is the one to sharpen
                      "border-red-500/80 bg-red-500/10 focus:border-red-400"
                    : anyResolved
                      ? // a check ran and located the wrong slot; this isn't it — it's good
                        "border-emerald-500/70 bg-emerald-500/10 focus:border-emerald-400"
                      : "border-accent/50 bg-accent/10 focus:border-accent"
                }`}
              />
              {whyForIndex(p.index, p.label) && (
                <span className="mx-1 mt-0.5 max-w-[22rem] whitespace-normal font-sans text-[11px] leading-snug text-red-300/90">
                  {whyForIndex(p.index, p.label)}
                </span>
              )}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </p>

      {/* The inventor's OWN words from the lesson, as tappable chips — tap one to
          drop it into the slot you're in. Real help, never the answer. */}
      {keyTerms.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
            Your words:
          </span>
          {keyTerms.map((term, i) => (
            <button
              key={i}
              type="button"
              onClick={() => insertTerm(term)}
              className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 font-sans text-[11px] text-ink transition-colors hover:border-accent hover:bg-accent/20"
            >
              {term}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] italic text-ink-muted">
          {used
            ? "It's in your answer box below — finish it there with “This is mine”."
            : "Say it your way — tap a word above to drop it in, then use it as your answer."}
        </span>
        <button
          type="button"
          onClick={() => {
            onUse(assembled, filledBlanks());
            setUsed(true);
          }}
          disabled={!allFilled || used}
          className={
            used
              ? "rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-sans text-xs font-medium text-emerald-400"
              : "rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
          }
        >
          {used ? "✓ In your answer box" : "Use as my answer ↓"}
        </button>
      </div>
    </div>
  );
}

/** The full V1 landscape dump — now secondary, behind a disclosure. */
function WhitespaceRawAnalysis({ a }: { a: WhitespaceCard["analysis"] }) {
  return (
    <div>
      <p className="font-mono text-[10px] text-ink-muted">
        {a.overallMatchLevel.directMatches} direct · {a.overallMatchLevel.adjacentMatches} adjacent ·{" "}
        {a.overallMatchLevel.unrelatedReferences} unrelated
      </p>

      {/* Per-reference extracted mechanisms */}
      {a.patentAnalyses.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
            What each reference describes
          </p>
          {a.patentAnalyses.map((p, i) => (
            <div key={`${p.patentNumber}-${i}`} className="rounded border border-border bg-bg p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-ink">
                  {p.patentNumber || "(no number)"}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
                  {p.patentStatus}
                </span>
              </div>
              {p.patentTitle && (
                <div className="font-sans text-[11px] text-ink-muted">{p.patentTitle}</div>
              )}
              {p.extractedMechanisms.length > 0 && (
                <ul className="mt-1 list-disc pl-4 font-mono text-[11px] leading-relaxed text-ink-muted">
                  {p.extractedMechanisms.map((m, j) => (
                    <li key={j}>{m}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Primary distinguishing features */}
      {a.primaryDistinguishingFeatures.length > 0 && (
        <>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
            Primary distinguishing features
          </p>
          <ul className="mt-1 list-disc pl-4 font-mono text-xs leading-relaxed text-ink">
            {a.primaryDistinguishingFeatures.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </>
      )}

      {/* Consolidated open-landscape analysis */}
      {a.consolidatedOpenLandscapeAnalysis && (
        <>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
            Where your concept sits
          </p>
          <p className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-muted">
            {a.consolidatedOpenLandscapeAnalysis}
          </p>
        </>
      )}

      {/* Development guidance */}
      {a.keyConceptDevelopmentGuidance && (
        <>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
            What to document in depth
          </p>
          <p className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-muted">
            {a.keyConceptDevelopmentGuidance}
          </p>
        </>
      )}
    </div>
  );
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
  prefill,
  prefillBlanks,
}: {
  card: NoveltyCaptureCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
  prefill: string | null;
  prefillBlanks: { label: string; value: string }[] | null;
}) {
  const [text, setText] = useState("");
  // Submitted: show a thinking state right here until the next concept arrives
  // (this card unmounts when the view updates). If the request finished and this
  // card is STILL mounted, the submit failed — re-arm so the inventor can retry.
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (submitted && !busy) setSubmitted(false);
  }, [submitted, busy]);
  // The lesson's filled-in scaffold lands here — still the inventor's words
  // (they filled the slots), still editable before "This is mine".
  useEffect(() => {
    if (prefill?.trim()) setText(prefill);
  }, [prefill]);
  return (
    <div
      id={`novelty-${card.conceptId}`}
      className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4"
    >
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-amber-400">
        Your call on novelty
      </div>
      <div className="font-sans text-sm font-semibold text-ink">{card.title}</div>
      <p className="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-muted">
        {card.context}
      </p>
      <p className="mt-2 font-mono text-[11px] italic text-ink-muted">
        Talk it through with the Helper if you want — it can brainstorm angles and explain what
        tends to make something registrable. The one sentence that has to be yours, in your own
        words, is this one: what your concept does that the art does not.
      </p>

      {/* The checker's help — one thing to sharpen. Supportive, not a scold: the
          concrete reason is the point, and it shows right at the flagged slot in
          the lesson above too. */}
      {card.feedback && !submitted && (
        <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/[0.08] p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-amber-300">
            {card.feedback.wrongBlanks.length > 0
              ? "Almost — one part to sharpen"
              : "One thing to sharpen"}
          </div>
          <p className="mt-1 font-sans text-[13px] leading-relaxed text-ink">
            {card.feedback.note}
          </p>
          <p className="mt-1.5 font-mono text-[10px] italic text-ink-muted">
            {card.feedback.wrongBlanks.length > 0
              ? "The highlighted slot above shows exactly what to adjust — tweak just that, then use it again. The green parts are already good."
              : "Adjust that in your own words and send it again — you're close."}
          </p>
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        disabled={submitted}
        placeholder="What does this concept do that the existing art does not?"
        className="mt-2 w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none disabled:opacity-60"
      />
      <div className="mt-2 flex justify-end">
        {submitted ? (
          <div className="flex items-center gap-2 px-3 py-1.5">
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <span className="font-mono text-xs text-ink-muted">Checking your call…</span>
          </div>
        ) : (
          <button
            onClick={() => {
              setSubmitted(true);
              // Send the filled slots along only when the text is still the
              // assembled sentence — edited free text has no slot mapping.
              const blanks =
                prefill && text.trim() === prefill.trim() && prefillBlanks?.length
                  ? prefillBlanks
                  : undefined;
              onAct(card.id, {
                statement: text.trim(),
                ...(blanks ? { blanks } : {}),
              } as never);
            }}
            disabled={busy || !text.trim()}
            className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
          >
            This is mine
          </button>
        )}
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
