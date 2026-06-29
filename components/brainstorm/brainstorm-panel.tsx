"use client";

import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/lib/store";
import { useBrainstorm } from "@/lib/hooks/use-brainstorm";
import { Button } from "@/components/ui/button";
import { VoiceTextarea } from "@/components/ui/voice-textarea";
import { cn } from "@/lib/utils";
import type {
  DerivationTrace,
  ExcavationFrontier,
  LensCard,
  ReversalStep,
  WalkTurn,
} from "@/lib/modules/brainstorm/types";

type Phase = "guide" | "intro" | "thinking" | "frontier" | "walk" | "capture";

/**
 * The backpack — collected ONCE per browser (spec §2: "store browser-side"), then
 * reused. It is the fuel for the reversal's analogies, so it must be real, not
 * neutral; but it is framed as "setting up your guide," never a form.
 */
const GUIDE_KEY = "geyser_brainstorm_guide";

/**
 * Module 0 — the Socratic brainstorming window. The user with a vague problem
 * walks themselves to a conceived mechanism; their final articulation is captured
 * and handed to Conception as the seed. The backstage engine is never shown — this
 * panel renders only the guide's questions (the curtain law).
 */
export default function BrainstormPanel({ maxW = "max-w-2xl" }: { maxW?: string }) {
  const projectId = useWorkspace((s) => s.projectId);
  const setStage = useWorkspace((s) => s.setStage);
  const { result, busy, error, run, open, step, hydrate } = useBrainstorm();

  const [phase, setPhase] = useState<Phase>("guide");
  const [guide, setGuide] = useState("");
  const [problem, setProblem] = useState("");
  const [chosenTrace, setChosenTrace] = useState<DerivationTrace | null>(null);
  const [stepData, setStepData] = useState<ReversalStep | null>(null);
  const [stepSeq, setStepSeq] = useState(0);
  const [conversation, setConversation] = useState<WalkTurn[]>([]);
  const [arrivalPrompt, setArrivalPrompt] = useState("");
  const [articulation, setArticulation] = useState("");
  const [custom, setCustom] = useState("");
  const [handoffBusy, setHandoffBusy] = useState(false);

  // The backpack is set up once and remembered (spec §2, browser-side). If it's
  // already there, skip straight to the problem.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(GUIDE_KEY);
      if (saved && saved.trim()) {
        setGuide(saved);
        setPhase("intro");
      }
    } catch {
      /* localStorage unavailable — just collect it this session */
    }
  }, []);

  // Module 0 crash recovery — the whole brainstorm session (spark, cards, where
  // you are in the walk) is saved per-project, so a freeze/reload drops you right
  // back in. The 5 main modules persist to the DB; this is their localStorage
  // equivalent for the pre-conception step.
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!projectId || loadedRef.current) return;
    loadedRef.current = true;
    try {
      const raw = window.localStorage.getItem(`geyser_brainstorm_session_${projectId}`);
      if (!raw) return;
      const s = JSON.parse(raw) as {
        phase: Phase;
        problem: string;
        result: ExcavationFrontier | null;
        chosenTrace: DerivationTrace | null;
        stepData: ReversalStep | null;
        stepSeq: number;
        conversation: WalkTurn[];
        arrivalPrompt: string;
        articulation: string;
        custom: string;
      };
      setProblem(s.problem ?? "");
      if (s.result) hydrate(s.result);
      setChosenTrace(s.chosenTrace ?? null);
      setStepData(s.stepData ?? null);
      setStepSeq(s.stepSeq ?? 0);
      setConversation(Array.isArray(s.conversation) ? s.conversation : []);
      setArrivalPrompt(s.arrivalPrompt ?? "");
      setArticulation(s.articulation ?? "");
      setCustom(s.custom ?? "");
      // Never restore into the transient "thinking" state — it would spin forever.
      setPhase(s.phase === "thinking" ? (s.result ? "frontier" : "intro") : s.phase);
    } catch {
      /* corrupt session — start fresh */
    }
  }, [projectId, hydrate]);

  useEffect(() => {
    if (!projectId || !loadedRef.current) return;
    if (!problem.trim() && !result) return; // nothing worth saving yet
    try {
      window.localStorage.setItem(
        `geyser_brainstorm_session_${projectId}`,
        JSON.stringify({
          phase,
          problem,
          result,
          chosenTrace,
          stepData,
          stepSeq,
          conversation,
          arrivalPrompt,
          articulation,
          custom,
        }),
      );
    } catch {
      /* quota / unavailable — best effort */
    }
  }, [
    projectId,
    phase,
    problem,
    result,
    chosenTrace,
    stepData,
    stepSeq,
    conversation,
    arrivalPrompt,
    articulation,
    custom,
  ]);

  const clearSession = () => {
    if (!projectId) return;
    try {
      window.localStorage.removeItem(`geyser_brainstorm_session_${projectId}`);
    } catch {
      /* ignore */
    }
  };

  // Clear the saved session and return to a blank spark (so a restored session
  // never traps you — you can always start a fresh idea).
  const startOver = () => {
    clearSession();
    hydrate(null);
    setProblem("");
    setChosenTrace(null);
    setStepData(null);
    setStepSeq(0);
    setConversation([]);
    setArrivalPrompt("");
    setArticulation("");
    setCustom("");
    setPhase("intro");
  };

  const backpack = {
    background: guide.trim() || "(not specified)",
    domainFamiliarity: guide.trim() || "(not specified)",
  };

  // Show a NEW walk step and bump the sequence so the step UI re-mounts fresh
  // (clears the input box; guarantees the screen advances on every new question).
  const showStep = (s: ReversalStep) => {
    setStepData(s);
    setStepSeq((n) => n + 1);
  };

  const saveGuide = () => {
    if (!guide.trim()) return;
    try {
      window.localStorage.setItem(GUIDE_KEY, guide.trim());
    } catch {
      /* ignore */
    }
    setPhase("intro");
  };

  const startEngine = async () => {
    if (!problem.trim()) return;
    setPhase("thinking");
    const data = await run({ spark: problem.trim() });
    setPhase(data && data.cards.length ? "frontier" : "intro");
  };

  // Optional clarifier chip — re-runs the excavation, sharpened by the answer.
  const sharpen = async (chip: string) => {
    setPhase("thinking");
    await run({ spark: problem.trim(), clarifierAnswer: chip });
    setPhase("frontier");
  };

  // Picked a card — reconstruct its derivation and open the adaptive walk.
  const pickCard = async (card: LensCard) => {
    setPhase("thinking");
    setConversation([]);
    const opened = await open({ spark: problem.trim(), card, backpack });
    if (!opened) {
      setPhase("frontier");
      return;
    }
    setChosenTrace(opened.trace);
    showStep(opened.opener);
    setPhase("walk");
  };

  const answerWalk = async (text: string) => {
    const t = text.trim();
    if (!t || !chosenTrace || !stepData?.question) return;
    const nextConv: WalkTurn[] = [
      ...conversation,
      { question: stepData.question.prompt, answer: t },
    ];
    setConversation(nextConv);
    const next = await step({ trace: chosenTrace, backpack, conversation: nextConv });
    if (!next) return; // error surfaced by the hook
    if (next.done) {
      setArrivalPrompt(next.arrivalPrompt ?? "");
      setPhase("capture");
    } else {
      showStep(next);
    }
  };

  // Arrival is a checkpoint, not a dead-end: the inventor — not the AI's `done` —
  // decides when they're sure. "Keep pushing" re-enters the walk on a NEW edge.
  const keepPushing = async () => {
    if (!chosenTrace) return;
    setPhase("walk");
    const next = await step({
      trace: chosenTrace,
      backpack,
      conversation,
      pushDeeper: true,
    });
    if (next?.question) {
      showStep(next);
    } else {
      // No new edge came back (or the call errored) — return to arrival rather
      // than leave the previous question stranded on screen.
      if (next?.arrivalPrompt) setArrivalPrompt(next.arrivalPrompt);
      setPhase("capture");
    }
  };

  const finishConception = async () => {
    const text = articulation.trim();
    if (!text || !projectId) return;
    setHandoffBusy(true);
    try {
      await fetch("/api/conception", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "ingest", raw: text, projectId }),
      });
      clearSession(); // handed off — the brainstorm session is done.
      setStage("conception");
    } catch (e) {
      console.error(e);
    } finally {
      setHandoffBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className={cn("mx-auto flex w-full flex-col gap-5 p-6", maxW)}>
          <header className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-action">
                Stage 0 · Brainstorm
              </div>
              <h2 className="mt-1 font-sans text-lg font-semibold text-ink">
                Let&apos;s find the invention together
              </h2>
            </div>
            <div className="flex items-center gap-3">
              {phase !== "guide" && phase !== "intro" && (
                <button
                  onClick={startOver}
                  className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-accent"
                >
                  Start over
                </button>
              )}
              <button
                onClick={() => setStage("conception")}
                className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-accent"
              >
                I already have a concept →
              </button>
            </div>
          </header>

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3 font-mono text-xs text-red-300">
              {error}
            </div>
          )}

          {phase === "guide" && (
            <div className="space-y-3">
              <p className="font-mono text-xs leading-relaxed text-ink-muted">
                First, let me set up your guide — a line about you, so I explain
                things the way you&apos;ll actually get them. (I&apos;ll remember it.)
              </p>
              <VoiceTextarea
                value={guide}
                onChange={setGuide}
                rows={3}
                placeholder="What you build, and what you already know in this space…"
                className="w-full resize-y rounded-md border border-border bg-bg p-3 font-mono text-sm leading-relaxed text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
              />
              <div className="flex justify-end">
                <Button variant="primary" onClick={saveGuide} disabled={!guide.trim()}>
                  Set up my guide →
                </Button>
              </div>
            </div>
          )}

          {phase === "intro" && (
            <div className="space-y-3">
              <VoiceTextarea
                value={problem}
                onChange={setProblem}
                rows={4}
                placeholder="What do you want to crack? The thing that's slow, expensive, clunky, or impossible today…"
                className="w-full resize-y rounded-md border border-border bg-bg p-3 font-mono text-sm leading-relaxed text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
              />
              <div className="flex justify-end">
                <Button variant="primary" onClick={startEngine} disabled={!problem.trim()}>
                  Think it through with me →
                </Button>
              </div>
            </div>
          )}

          {phase === "thinking" && <ThinkingState />}

          {phase === "frontier" && result && (
            <div className="space-y-3">
              {/* Your spark, quoted back. */}
              <div className="rounded-md border border-border bg-bg/40 p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                  Your spark
                </div>
                <p className="mt-1 font-mono text-xs italic leading-relaxed text-ink">
                  &ldquo;{result.spark}&rdquo;
                </p>
              </div>

              {/* The single optional clarifier — cards already give a strong default,
                  so this never blocks. Progress by default, refine if you want. */}
              {result.clarifier?.prompt && (
                <div>
                  <p className="font-mono text-xs leading-relaxed text-ink-muted">
                    {result.clarifier.prompt}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {result.clarifier.chips.map((chip, j) => (
                      <button
                        key={j}
                        type="button"
                        onClick={() => void sharpen(chip)}
                        disabled={busy}
                        className="rounded-full border border-border bg-panel px-2.5 py-1 font-mono text-[11px] text-ink-muted hover:border-accent hover:text-ink disabled:opacity-50"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <p className="font-sans text-sm font-semibold text-ink">
                Three sharper ways to frame it — each mapped to the market. Pick one
                to keep going.
              </p>

              {result.cards.map((card, i) => (
                <button
                  key={i}
                  onClick={() => void pickCard(card)}
                  disabled={busy}
                  className={cn(
                    "block w-full rounded-md border bg-panel p-4 text-left transition-colors hover:bg-accent/5 disabled:opacity-60",
                    card.recommended
                      ? "border-accent/50"
                      : "border-border hover:border-accent",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-action">
                      {card.label}
                    </div>
                    {card.recommended && (
                      <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-accent">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 font-sans text-sm leading-relaxed text-ink">
                    {card.restatement}
                  </p>
                  {card.mechanism && (
                    <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-ink-muted">
                      <span className="text-ink-muted/80">The mechanism — </span>
                      {card.mechanism}
                    </p>
                  )}
                  {card.marketRead && (
                    <div className="mt-2 border-t border-border/60 pt-2">
                      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
                        Market read
                        {card.marketRead.confidence === "model" && (
                          <span className="ml-1 text-ink-muted/70">· unverified</span>
                        )}
                      </div>
                      {card.marketRead.incumbents.length > 0 && (
                        <p className="mt-1 font-mono text-[11px] leading-relaxed text-ink-muted">
                          Already here:{" "}
                          {card.marketRead.incumbents.map((c) => c.name).join(", ")}.
                        </p>
                      )}
                      {card.marketRead.whitespace && (
                        <p className="mt-1 font-mono text-[11px] leading-relaxed text-ink-muted">
                          {card.marketRead.whitespace}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="mt-2 text-right font-mono text-[11px] text-accent">
                    Choose this →
                  </div>
                </button>
              ))}
              {/* Human input — never only the AI's three. Bring your own angle. */}
              <div className="rounded-md border border-dashed border-border bg-bg/40 p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                  Or — your own angle
                </div>
                <p className="mt-1 font-mono text-xs leading-relaxed text-ink-muted">
                  See it differently, or already have the idea? Say it your way.
                </p>
                <VoiceTextarea
                  value={custom}
                  onChange={setCustom}
                  rows={3}
                  placeholder="Your own direction or idea, in your own words…"
                  className="mt-2 w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setArticulation(custom.trim());
                      setArrivalPrompt("");
                      setPhase("capture");
                    }}
                    disabled={!custom.trim()}
                  >
                    Use my own →
                  </Button>
                </div>
              </div>
              {result.notes.length > 0 && (
                <p className="font-mono text-[10px] italic leading-relaxed text-ink-muted">
                  {result.notes.join(" ")}
                </p>
              )}
            </div>
          )}

          {phase === "walk" &&
            (busy ? (
              // While a step is in flight, show a clean loading state — never the
              // PREVIOUS question under the NEXT question's number (that's the
              // "Q8 shown as Q9" bug). The new question appears only once it loads.
              <ThinkingState />
            ) : stepData?.question ? (
              <WalkStep
                key={stepSeq}
                stepNumber={stepSeq}
                reaction={stepData.reaction}
                prompt={stepData.question.prompt}
                options={stepData.question.alternatives}
                busy={busy}
                onAnswer={answerWalk}
              />
            ) : null)}

          {phase === "capture" && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-amber-400">
                Now say it in your own words
              </div>
              <p className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-muted">
                {arrivalPrompt ||
                  "Say your invention in your own words — exactly as you see it."}
              </p>
              <VoiceTextarea
                value={articulation}
                onChange={setArticulation}
                rows={5}
                placeholder="The idea you just reasoned your way to — in your own words…"
                className="mt-2 w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
              />
              <p className="mt-2 font-mono text-[11px] italic text-ink-muted">
                This becomes your conception — captured exactly as you write it. No
                rush — if it doesn&apos;t feel finished, keep going.
              </p>
              <div className="mt-2 flex items-center justify-between gap-2">
                {chosenTrace && conversation.length > 0 ? (
                  <Button
                    variant="ghost"
                    onClick={keepPushing}
                    disabled={busy || handoffBusy}
                  >
                    Not there yet — keep going
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  variant="primary"
                  onClick={finishConception}
                  disabled={handoffBusy || !articulation.trim()}
                >
                  This is my idea → Conception
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Lines cycle while the engine works (it can take a while) so it never reads as
 *  frozen. Curtain-safe — describes the experience, never the backstage engine. */
const THINKING_LINES = [
  "Thinking through your problem…",
  "Exploring a few different angles…",
  "Weighing which directions look most promising…",
  "Shaping the questions to walk you through…",
  "Almost there…",
];

function ThinkingState() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setI((n) => Math.min(n + 1, THINKING_LINES.length - 1)),
      3000,
    );
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-3 rounded-md border border-accent/30 bg-accent/5 p-5">
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      <span className="font-mono text-xs leading-relaxed text-ink-muted">
        {THINKING_LINES[i]}
      </span>
    </div>
  );
}

function WalkStep({
  stepNumber,
  reaction,
  prompt,
  options,
  busy,
  onAnswer,
}: {
  stepNumber: number;
  reaction: string;
  prompt: string;
  options: string[];
  busy: boolean;
  onAnswer: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="rounded-md border border-action/30 bg-action/5 p-4">
      {/* The partner reacts to your last answer, then asks the next thing. */}
      {reaction && (
        <p className="mb-3 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-muted">
          {reaction}
        </p>
      )}
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-action">
        Question {stepNumber}
      </div>
      <p className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">
        {prompt}
      </p>
      {/* Sparks to react to — tap one, edit it, or type your own. Not the answer
          flagged as right; just starting points. */}
      {options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {options.map((opt, j) => (
            <button
              key={j}
              type="button"
              onClick={() => onAnswer(opt)}
              disabled={busy}
              className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-[11px] text-ink hover:bg-accent/20 disabled:opacity-50"
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      <VoiceTextarea
        value={text}
        onChange={setText}
        rows={3}
        placeholder="…or answer in your own words"
        className="mt-2 w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex justify-end">
        <Button
          variant="primary"
          onClick={() => onAnswer(text)}
          disabled={busy || !text.trim()}
        >
          {busy ? "Thinking…" : "Continue →"}
        </Button>
      </div>
    </div>
  );
}
