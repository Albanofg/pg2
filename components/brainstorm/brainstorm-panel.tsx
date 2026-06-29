"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/store";
import { useBrainstorm } from "@/lib/hooks/use-brainstorm";
import { Button } from "@/components/ui/button";
import { VoiceTextarea } from "@/components/ui/voice-textarea";
import { cn } from "@/lib/utils";
import type {
  FrontierItem,
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
  const { result, busy, error, run, step } = useBrainstorm();

  const [phase, setPhase] = useState<Phase>("guide");
  const [guide, setGuide] = useState("");
  const [problem, setProblem] = useState("");
  const [chosen, setChosen] = useState<number | null>(null);
  const [stepData, setStepData] = useState<ReversalStep | null>(null);
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

  const item: FrontierItem | null =
    result && chosen != null ? result.frontier[chosen] ?? null : null;
  const backpack = {
    background: guide.trim() || "(not specified)",
    domainFamiliarity: guide.trim() || "(not specified)",
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
    const data = await run({
      problem: problem.trim(),
      // Real backpack — the fuel for the reversal's analogies (spec §2).
      backpack: {
        background: guide.trim() || "(not specified)",
        domainFamiliarity: guide.trim() || "(not specified)",
      },
    });
    setPhase(data && data.frontier.length ? "frontier" : "intro");
  };

  const answerWalk = async (text: string) => {
    const t = text.trim();
    if (!t || !item || !stepData?.question) return;
    const nextConv: WalkTurn[] = [
      ...conversation,
      { question: stepData.question.prompt, answer: t },
    ];
    setConversation(nextConv);
    const next = await step({ trace: item.trace, backpack, conversation: nextConv });
    if (!next) return; // error surfaced by the hook
    if (next.done) {
      setArrivalPrompt(next.arrivalPrompt ?? "");
      setPhase("capture");
    } else {
      setStepData(next);
    }
  };

  // Arrival is a checkpoint, not a dead-end: the inventor — not the AI's `done` —
  // decides when they're sure. "Keep pushing" re-enters the walk and goes deeper.
  const keepPushing = async () => {
    if (!item) return;
    setPhase("walk");
    const next = await step({
      trace: item.trace,
      backpack,
      conversation,
      pushDeeper: true,
    });
    if (next?.question) setStepData(next);
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
            <button
              onClick={() => setStage("conception")}
              className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-accent"
            >
              I already have a concept →
            </button>
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
              <p className="font-mono text-xs leading-relaxed text-ink-muted">
                A few different ways into your problem. Which one pulls at you? Pick
                the one you want to think through.
              </p>
              {result.frontier.map((f, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setChosen(i);
                    setConversation([]);
                    setStepData(f.opener);
                    setPhase("walk");
                  }}
                  className="block w-full rounded-md border border-border bg-panel p-4 text-left transition-colors hover:border-accent hover:bg-accent/5"
                >
                  <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                    Direction {i + 1}
                  </div>
                  <p className="mt-1 font-sans text-sm leading-relaxed text-ink">
                    {f.opener.question?.prompt ?? "A direction worth exploring."}
                  </p>
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
            (stepData?.question ? (
              <WalkStep
                key={conversation.length}
                stepNumber={conversation.length + 1}
                reaction={stepData.reaction}
                prompt={stepData.question.prompt}
                options={stepData.question.alternatives}
                busy={busy}
                onAnswer={answerWalk}
              />
            ) : busy ? (
              <ThinkingState />
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
                {item && conversation.length > 0 ? (
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
