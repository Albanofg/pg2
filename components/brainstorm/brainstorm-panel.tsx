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
  MarketRead,
  ReversalStep,
  WalkInteractionKind,
  WalkTurn,
} from "@/lib/modules/brainstorm/types";

type Phase =
  | "guide"
  | "intro"
  | "thinking"
  | "frontier"
  | "formed"
  | "walk"
  | "capture"
  | "failed";

/**
 * Route a frontier result to its phase: the three idea cards, or a failed research run
 * (retry — never a bare text box). Every input gets the three ideas.
 */
function phaseFor(data: ExcavationFrontier | null): Phase {
  if (!data) return "failed";
  return data.cards.length ? "frontier" : "failed";
}

// The walk is HARD-CAPPED so it can never become an interrogation: after this many
// steps it moves the inventor forward to say the core (or skip), never more questions.
const MAX_WALK_STEPS = 6;

/**
 * The backpack — collected ONCE per browser (spec §2: "store browser-side"), then
 * reused. It is the fuel for the reversal's analogies, so it must be real, not
 * neutral; but it is framed as "setting up your guide," never a form.
 */
const GUIDE_KEY = "geyser_brainstorm_guide";

/**
 * Hold a loading state visible for at least `ms` so a fast/cached response never
 * flashes past — the inventor always sees "Reading the market…" register before the
 * cards appear (fixes "cards showed up, nothing told me they were loading").
 */
async function withMinSpinner<T>(p: Promise<T>, ms = 700): Promise<T> {
  const [res] = await Promise.all([p, new Promise((r) => setTimeout(r, ms))]);
  return res as T;
}

/**
 * Module 0 — the Socratic brainstorming window. The user with a vague problem
 * walks themselves to a conceived mechanism; their final articulation is captured
 * and handed to Conception as the seed. The backstage engine is never shown — this
 * panel renders only the guide's questions (the curtain law).
 */
export default function BrainstormPanel({ maxW = "max-w-2xl" }: { maxW?: string }) {
  const projectId = useWorkspace((s) => s.projectId);
  const setStage = useWorkspace((s) => s.setStage);
  const brainstormSeed = useWorkspace((s) => s.brainstormSeed);
  const setBrainstormSeed = useWorkspace((s) => s.setBrainstormSeed);
  const { result, busy, error, run, deepen, open, step, hydrate } = useBrainstorm();

  // We never land on a text box here. Start on a neutral spinner and let the mount
  // effect route: run a fresh spark, restore real in-progress work, or bounce to the
  // entry. The inventor types their idea once at the entry, never on this screen.
  const [phase, setPhase] = useState<Phase>("thinking");
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
  // The no-Tier-4 stall tier (deep spec §6.5), threaded through the walk so the gate
  // advances the floor across steps; routes to a human after tier 3.
  const [stallTier, setStallTier] = useState(0);
  // Which direction card's detail is shown in the right panel (the deep dive). The
  // cards stay slim; clicking one opens its market read + the real claim on the right.
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  // "Give me more options" → reveal the orientation chips → regenerate.
  const [showMore, setShowMore] = useState(false);
  // The inventor's own orientation for "more options" (free text, not just the chips).
  const [moreInput, setMoreInput] = useState("");
  // The drill stack: each entry is the frontier we drilled DOWN from, so "← Up a level"
  // can climb back out. Picking a card drills into three sharper directions of that pick;
  // the three-ideas pattern repeats at increasing depth (no walk, no interrogation).
  const [drillStack, setDrillStack] = useState<ExcavationFrontier[]>([]);
  // Deeper-level free text: combine the options, or steer the next narrowing in your words.
  const [steerInput, setSteerInput] = useState("");
  // The market read of the top-level direction the inventor chose to drill into — carried
  // to Conception as CONTEXT (the journey), so it's not lost on hand-off.
  const [journeyMarket, setJourneyMarket] = useState<string | null>(null);

  // Load the saved guide (used for the walk's analogies). It no longer drives the
  // phase — routing is handled by the mount effect below, which never shows a text box.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(GUIDE_KEY);
      if (saved && saved.trim()) setGuide(saved);
    } catch {
      /* localStorage unavailable — collect it this session if needed */
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

    // A fresh spark handed in from the entry ALWAYS starts a new brainstorm — it wins
    // over any stale saved session, and it NEVER lands on a text box: it just runs
    // (research → cards), or shows a retry if the research can't complete.
    if (brainstormSeed && brainstormSeed.trim()) {
      const sparkText = brainstormSeed.trim();
      setBrainstormSeed(null);
      try {
        window.localStorage.removeItem(`geyser_brainstorm_session_${projectId}`);
      } catch {
        /* ignore */
      }
      setProblem(sparkText);
      setPhase("thinking");
      void (async () => {
        const data = await withMinSpinner(run({ spark: sparkText }));
        setPhase(phaseFor(data));
      })();
      return;
    }

    // No fresh spark — restore only a REAL in-progress brainstorm (cards, or mid
    // walk/capture). Anything else is a stranded/empty session: discard it and bounce
    // to the entry, so we never drop the inventor onto a bare text box.
    try {
      const raw = window.localStorage.getItem(`geyser_brainstorm_session_${projectId}`);
      if (raw) {
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
          stallTier?: number;
          drillStack?: ExcavationFrontier[];
        };
        const meaningful =
          !!s.result ||
          s.phase === "walk" ||
          s.phase === "capture" ||
          s.phase === "frontier";
        if (meaningful) {
          setProblem(s.problem ?? "");
          if (s.result) hydrate(s.result);
          setChosenTrace(s.chosenTrace ?? null);
          setStepData(s.stepData ?? null);
          setStepSeq(s.stepSeq ?? 0);
          setConversation(Array.isArray(s.conversation) ? s.conversation : []);
          setArrivalPrompt(s.arrivalPrompt ?? "");
          setArticulation(s.articulation ?? "");
          setCustom(s.custom ?? "");
          setStallTier(typeof s.stallTier === "number" ? s.stallTier : 0);
          // Restore the drill depth so a deeper level renders as a deeper level (light list
          // + "← Up a level"), not mislabeled as the top "Your spark" screen.
          setDrillStack(Array.isArray(s.drillStack) ? s.drillStack : []);
          // A session that died before producing cards retries the research, never a box.
          // Old sessions saved mid-walk/capture (now removed) land back on the directions.
          setPhase(
            s.phase === "thinking" ||
              s.phase === "walk" ||
              s.phase === "capture"
              ? s.result
                ? "frontier"
                : "failed"
              : s.phase,
          );
          return;
        }
        window.localStorage.removeItem(`geyser_brainstorm_session_${projectId}`);
      }
    } catch {
      /* corrupt — fall through to the entry */
    }

    // Nothing to brainstorm here (no spark, no in-progress work). Send the inventor
    // back to the entry, where the one-line "Brainstorm with AI" flow lives.
    setStage("conception");
  }, [projectId, hydrate, brainstormSeed, setBrainstormSeed, run, setStage]);

  // When the cards arrive (or regenerate), open the first one's detail by default so
  // the right panel is never empty, and collapse the "more options" widget. (No
  // "recommended" — the three directions are equals; the inventor chooses.)
  useEffect(() => {
    if (phase !== "frontier" || !result?.cards.length) return;
    setSelectedIdx(0);
    setShowMore(false);
    setMoreInput("");
  }, [phase, result]);

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
          stallTier,
          drillStack,
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
    stallTier,
    drillStack,
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
    setStallTier(0);
    setSelectedIdx(null);
    setShowMore(false);
    setDrillStack([]);
    // Start a fresh idea from the entry — never drop onto a bare text box here.
    setStage("conception");
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
    const data = await withMinSpinner(run({ spark: problem.trim() }));
    setPhase(data ? phaseFor(data) : "intro");
  };

  // Re-run the market research on the spark we already have — used when the auto-run
  // couldn't produce cards. The brainstorm step never falls back to a text box.
  const retryExcavation = async () => {
    if (!problem.trim()) return;
    setPhase("thinking");
    const data = await withMinSpinner(run({ spark: problem.trim() }));
    setPhase(phaseFor(data));
  };

  // Optional clarifier chip — re-runs the excavation, sharpened by the answer. (Refining
  // is always the vague path; the classifier only runs on the first, un-clarified spark.)
  const sharpen = async (chip: string) => {
    setPhase("thinking");
    const data = await withMinSpinner(
      run({ spark: problem.trim(), clarifierAnswer: chip }),
    );
    setPhase(phaseFor(data));
  };

  // Drill into a chosen direction — three SHARPER directions of that pick (the same
  // three-ideas pattern, one level deeper). Never re-routes through the formed fast-path.
  // Narrow one level deeper. `direction` is what we sharpen FROM (a tapped option, the
  // inventor's own text, or — for combine / "you decide" — the current parent), with the
  // sibling `options` + optional `steer` so the AI can combine them or take the wheel.
  const goDeeper = async (opts: {
    // The CURRENT key concept to EVOLVE (result.spark once drilling; the picked card on the
    // first drill). `addition` = the sharper option just tapped, folded into the concept.
    direction: string;
    addition?: string;
    options?: string[];
    steer?: string;
  }) => {
    const d = opts.direction.trim();
    if (!d) return;
    // The deepener's "ORIGINAL PROBLEM" context must stay the inventor's REAL spark, not the
    // level we're drilling from — drillStack[0] is the top frontier (its spark is the
    // original); at level 0 it's the current frontier's spark.
    const originalProblem = drillStack[0]?.spark ?? result?.spark ?? d;
    const parentSpark = result?.spark ?? null;
    if (result) setDrillStack((s) => [...s, result]);
    setProblem(d);
    setSelectedIdx(null);
    setSteerInput("");
    setPhase("thinking");
    const data = await withMinSpinner(
      deepen({
        problem: originalProblem,
        direction: d,
        ...(opts.addition ? { addition: opts.addition } : {}),
        ...(opts.options ? { options: opts.options } : {}),
        ...(opts.steer ? { steer: opts.steer } : {}),
      }),
    );
    if (!data || !data.cards.length) {
      // Couldn't sharpen (empty result) — UNDO the descent: pop the level we just pushed and
      // restore the parent's spark. The hook leaves `result` untouched on an empty deepen, so
      // the three cards we were on stay intact — the inventor is never stranded on a blank.
      setDrillStack((s) => s.slice(0, -1));
      if (parentSpark) setProblem(parentSpark);
    }
    setPhase("frontier");
  };

  // Climb back out one drill level (the parent's cards are still in memory — no re-call).
  const upLevel = () => {
    setDrillStack((s) => {
      const parent = s[s.length - 1];
      if (parent) {
        hydrate(parent);
        setProblem(parent.spark);
      }
      return s.slice(0, -1);
    });
    setSelectedIdx(null);
    setPhase("frontier");
  };

  // LOCK IN the current direction as the KEY CONCEPT — the brainstorm's output and its EXIT.
  // Without this the drill never ends; this is how the inventor lands once it's sharp enough.
  // Their own words for this direction are the seed. (Downstream is the Conception module.)
  const lockIn = async (text: string) => {
    const seed = text.trim();
    if (!seed || !projectId) return;
    setHandoffBusy(true);
    try {
      // The narrowing journey (each level's concept) + the chosen direction's market read =
      // CONTEXT carried to Conception, so the record shows the path, not just the final line.
      const path = [...drillStack.map((f) => f.spark), seed].filter(
        (s, i, a) => !!s && s !== a[i - 1],
      );
      await fetch("/api/conception", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "ingest",
          raw: seed,
          projectId,
          brainstormContext: {
            ...(path.length ? { path } : {}),
            ...(journeyMarket ? { marketRead: journeyMarket } : {}),
          },
        }),
      });
      clearSession();
      setStage("conception");
    } catch (e) {
      console.error(e);
    } finally {
      setHandoffBusy(false);
    }
  };

  // A teaching click (this_or_that / pick) passes teaching:true so the engine skips the
  // conditionality gate — only the typed collision answer (say_it) is a conception attempt.
  const answerWalk = async (text: string, opts?: { teaching?: boolean }) => {
    const t = text.trim();
    if (!t || !chosenTrace || !stepData?.question) return;
    const nextConv: WalkTurn[] = [
      ...conversation,
      { question: stepData.question.prompt, answer: t },
    ];
    setConversation(nextConv);
    const next = await step({
      trace: chosenTrace,
      backpack,
      conversation: nextConv,
      stallTier,
      ...(opts?.teaching ? { teaching: true } : {}),
    });
    if (!next) return; // error surfaced by the hook
    if (typeof next.stallTier === "number") setStallTier(next.stallTier);
    // No Tier 4 (deep spec §6.5): the ladder is exhausted — calm hand-off, not a block.
    // The inventor can still say it in their own words; the machine never states it.
    if (next.routeToHuman) {
      setArrivalPrompt(next.arrivalPrompt ?? "");
      setPhase("capture");
    } else if (next.done) {
      // Arrival is governed by the strict conditionality gate, not the generator.
      setArrivalPrompt(next.arrivalPrompt ?? "");
      setPhase("capture");
    } else if (nextConv.length >= MAX_WALK_STEPS) {
      // Hard cap — never interrogate past this. Move the inventor forward to say the core
      // in their own words (or skip), instead of facing yet more questions.
      setArrivalPrompt(
        next.arrivalPrompt ||
          "You've done the thinking. Say the core idea in your own words — or skip, and we'll flag this part for an expert.",
      );
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
      stallTier,
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
        <div
          className={cn(
            "mx-auto flex w-full flex-col gap-5 p-6",
            // The frontier is a two-column layout (cards + right-hand detail), so it
            // needs more room than the single-column phases.
            phase === "frontier" ? "max-w-5xl" : maxW,
          )}
        >
          <header className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-action">
                Stage 0 · Brainstorm
              </div>
              <h2 className="mt-1 font-sans text-lg font-semibold text-ink">
                Let&apos;s find the invention together
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {/* Back to the three directions mid-walk — no delete, no restart (cards
                  are still in memory). Only shown once you've left the directions. */}
              {phase === "frontier" && drillStack.length > 0 && (
                <button
                  onClick={upLevel}
                  className="rounded-md border border-border bg-panel px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:border-accent hover:text-ink"
                >
                  ← Up a level
                </button>
              )}
              {/* Reset to a fresh idea (clears this brainstorm). Red on hover = it discards. */}
              {phase !== "guide" && phase !== "intro" && (
                <button
                  onClick={startOver}
                  className="rounded-md border border-border bg-panel px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:border-red-500/50 hover:text-red-300"
                >
                  Start over
                </button>
              )}
            </div>
          </header>

          {/* "You are here" — the meeting's progress-meter rule: never let the
              inventor feel they're on a never-ending journey. Honest stages of the
              whole brainstorm, current one lit. (No fake per-question count — the
              walk is adaptive, so we mark the journey, not the steps.) */}
          {phase !== "guide" && (
            <JourneyRibbon
              active={
                phase === "formed"
                  ? 2
                  : phase === "frontier" || phase === "failed"
                    ? 1
                    : phase === "thinking" && result
                      ? 1
                      : 0
              }
            />
          )}

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

          {/* Research couldn't complete — retry on the spark we already have. Never a
              text box: the inventor already gave their idea; they don't re-type it. */}
          {phase === "failed" && (
            <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
              <p className="font-sans text-sm font-medium text-ink">
                I couldn&apos;t read the market just now.
              </p>
              {problem.trim() && (
                <div className="rounded-md border border-border bg-bg/40 p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                    Your spark
                  </div>
                  <p className="mt-1 font-mono text-xs italic leading-relaxed text-ink">
                    &ldquo;{problem.trim()}&rdquo;
                  </p>
                </div>
              )}
              <p className="font-mono text-[11px] leading-relaxed text-ink-muted">
                Your idea is saved — let me try the research again.
              </p>
              <div className="flex justify-end">
                <Button variant="primary" onClick={retryExcavation} disabled={busy}>
                  Try again →
                </Button>
              </div>
            </div>
          )}

          {/* Deeper levels — a LIGHT, quick narrowing decision (no market wall of text).
              The rich three-card screen happens ONCE, at the top; here you just tap to
              sharpen, so you're never reading a wall of text at every level. */}
          {phase === "frontier" && result && drillStack.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-sans text-sm font-semibold text-ink">
                  {drillStack.length >= 3 && (result.converged || drillStack.length >= 6)
                    ? "You've got a well-defined concept."
                    : "Narrowing in — pick one, add a twist, or lock it in."}
                </p>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted/70">
                  Step {drillStack.length}
                </span>
              </div>

              {/* THE EXIT — lock in what you've narrowed to as your key concept, at ANY step.
                  Drilling has no other end; this is how the inventor lands (fixes the endless
                  "how long does this take / I'm on the 10th question" trap). */}
              <div
                className={cn(
                  "rounded-md border p-3",
                  drillStack.length >= 3 && (result.converged || drillStack.length >= 6)
                    ? "border-accent/60 bg-accent/10"
                    : "border-accent/30 bg-accent/5",
                )}
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">
                  Where you&apos;ve landed
                </div>
                <p className="mt-1 font-sans text-sm leading-relaxed text-ink">
                  {result.spark}
                </p>
                {(drillStack.length >= 3 && (result.converged || drillStack.length >= 6)) && (
                  <p className="mt-2 font-mono text-[11px] leading-relaxed text-ink-muted">
                    This concept is now well defined — most further refinements become
                    implementation details.
                  </p>
                )}
                <div className="mt-3 flex items-center justify-end gap-2">
                  {(drillStack.length >= 3 && (result.converged || drillStack.length >= 6)) && (
                    <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-accent">
                      Recommended
                    </span>
                  )}
                  <Button
                    variant="primary"
                    onClick={() => void lockIn(result.spark)}
                    disabled={handoffBusy}
                  >
                    {handoffBusy
                      ? "Continuing…"
                      : drillStack.length >= 3 && (result.converged || drillStack.length >= 6)
                        ? "Continue to Development →"
                        : "That's my key concept — lock it in →"}
                  </Button>
                </div>
              </div>

              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                {drillStack.length >= 3 && (result.converged || drillStack.length >= 6)
                  ? "Keep refining"
                  : "Or sharpen further"}
              </div>
              <div className="space-y-2">
                {result.cards.map((card, i) => (
                  <button
                    key={i}
                    onClick={() =>
                      // Deeper tap: keep the accumulated concept (result.spark) and FOLD IN
                      // this pick as the addition — the concept grows, it doesn't reset.
                      void goDeeper({
                        direction: result.spark,
                        addition: card.restatement,
                        options: result.cards.map((c) => c.restatement),
                      })
                    }
                    disabled={busy}
                    className="block w-full rounded-md border border-border bg-panel p-3 text-left transition-colors hover:border-accent hover:bg-accent/5 disabled:opacity-50"
                  >
                    <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-action">
                      {card.label}
                    </span>
                    <p className="mt-1 font-sans text-sm leading-relaxed text-ink">
                      {card.restatement}
                    </p>
                  </button>
                ))}
              </div>

              {/* Human input — big + noticeable: combine the options / add your own twist, or
                  hand the AI the wheel. BOTH fold into the running key concept (via `steer`). */}
              <div className="space-y-3 rounded-md border border-accent/30 bg-panel p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                  Add your own twist
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={steerInput}
                    onChange={(e) => setSteerInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && steerInput.trim() && !busy) {
                        void goDeeper({
                          direction: result.spark,
                          options: result.cards.map((c) => c.restatement),
                          steer: steerInput.trim(),
                        });
                      }
                    }}
                    placeholder="Combine them (“first two together”), or add your own focus…"
                    className="min-w-0 flex-1 rounded-md border border-border bg-bg px-3 py-3 font-sans text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
                  />
                  <Button
                    variant="primary"
                    onClick={() => {
                      if (steerInput.trim() && !busy) {
                        void goDeeper({
                          direction: result.spark,
                          options: result.cards.map((c) => c.restatement),
                          steer: steerInput.trim(),
                        });
                      }
                    }}
                    disabled={busy || !steerInput.trim()}
                  >
                    Add it →
                  </Button>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void goDeeper({
                      direction: result.spark,
                      options: result.cards.map((c) => c.restatement),
                      steer: "(you decide)",
                    })
                  }
                  disabled={busy}
                  className="w-full rounded-md border border-border bg-bg px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted transition-colors hover:border-accent hover:text-ink disabled:opacity-50"
                >
                  Or — let the AI decide this one →
                </button>
              </div>
            </div>
          )}

          {phase === "frontier" && result && drillStack.length === 0 && (
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

              <p className="font-sans text-sm font-semibold text-ink">
                Three sharper ways to frame it — each mapped to the market. Click one to open
                it, then go deeper.
              </p>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                {/* LEFT — slim cards (the main idea only) + the one "more" control + escape. */}
                <div className="space-y-3">
                  {result.cards.map((card, i) => {
                    const selected = selectedIdx === i;
                    return (
                      <button
                        key={i}
                        onClick={() => setSelectedIdx(i)}
                        className={cn(
                          "block w-full rounded-md border p-4 text-left transition-colors",
                          selected
                            ? "border-accent bg-accent/10"
                            : "border-border bg-panel hover:border-accent hover:bg-accent/5",
                        )}
                      >
                        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-action">
                          {card.label}
                        </div>
                        <p className="mt-1.5 font-sans text-sm leading-relaxed text-ink">
                          {card.restatement}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          {card.marketRead && <SignalChip read={card.marketRead} />}
                          <span className="font-mono text-[10px] text-accent">
                            {selected ? "Showing detail →" : "See detail →"}
                          </span>
                        </div>
                      </button>
                    );
                  })}

                  {/* ONE control — "give me more options" → pick an orientation → regenerate.
                      Sits right above the user's own-angle box (the meeting's single-button rule). */}
                  {result.clarifier?.chips?.length ? (
                    <div className="rounded-md border border-dashed border-border bg-bg/30 p-3">
                      {!showMore ? (
                        <button
                          type="button"
                          onClick={() => setShowMore(true)}
                          disabled={busy}
                          className="w-full text-left font-mono text-xs text-ink-muted transition-colors hover:text-accent disabled:opacity-50"
                        >
                          + Give me more options
                        </button>
                      ) : (
                        <div className="space-y-2">
                          <p className="font-mono text-[11px] leading-relaxed text-ink-muted">
                            {result.clarifier.prompt ||
                              "Where should I aim the next set?"}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
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
                          {/* Human input — steer the next set in your own words. */}
                          <div className="flex items-center gap-1.5">
                            <input
                              value={moreInput}
                              onChange={(e) => setMoreInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && moreInput.trim() && !busy) {
                                  void sharpen(moreInput.trim());
                                  setMoreInput("");
                                }
                              }}
                              placeholder="…or type your own focus"
                              className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 py-1 font-mono text-[11px] text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (moreInput.trim() && !busy) {
                                  void sharpen(moreInput.trim());
                                  setMoreInput("");
                                }
                              }}
                              disabled={busy || !moreInput.trim()}
                              className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-[11px] text-accent hover:bg-accent/20 disabled:opacity-50"
                            >
                              Go →
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowMore(false)}
                            className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted hover:text-accent"
                          >
                            ← Never mind
                          </button>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {/* Optional escape — your own angle (the doc keeps "say it your way"). */}
                  <div className="rounded-md border border-dashed border-border bg-bg/40 p-4">
                    <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                      Or — your own angle
                    </div>
                    <VoiceTextarea
                      value={custom}
                      onChange={setCustom}
                      rows={2}
                      placeholder="See it differently? Say it your way…"
                      className="mt-2 w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
                    />
                    <div className="mt-2 flex justify-end">
                      <Button
                        variant="ghost"
                        onClick={() => void goDeeper({ direction: custom })}
                        disabled={!custom.trim() || busy}
                      >
                        Use my own →
                      </Button>
                    </div>
                  </div>
                </div>

                {/* RIGHT — the deep dive for the selected card (mechanism + market read). */}
                <div className="lg:sticky lg:top-2 lg:self-start">
                  {selectedIdx !== null && result.cards[selectedIdx] ? (
                    <CardDetail
                      card={result.cards[selectedIdx]}
                      busy={busy}
                      onDeeper={() => {
                        // First drill: this card BECOMES the starting key concept (no prior
                        // to fold into), so it's the direction, not an addition. Remember its
                        // market read as the journey's context for the Conception hand-off.
                        const c = result.cards[selectedIdx]!;
                        setJourneyMarket(
                          c.marketRead?.whyItMatters ??
                            c.marketRead?.steer ??
                            null,
                        );
                        void goDeeper({ direction: c.restatement });
                      }}
                    />
                  ) : (
                    <div className="rounded-md border border-dashed border-border bg-bg/30 p-4 font-mono text-xs leading-relaxed text-ink-muted">
                      Click a direction to see its market read and the specific opening
                      to aim at.
                    </div>
                  )}
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
                reaction={stepData.reaction}
                prompt={stepData.question.prompt}
                why={stepData.question.why}
                kind={stepData.question.kind}
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

/**
 * "You are here." The meeting's progress-meter rule — the inventor must always see
 * how far along the journey they are, or it reads as never-ending. These are the
 * honest stages of the whole brainstorm (not a fake per-question count, since the
 * walk is adaptive): Spark → Directions → Reasoning → Your idea.
 */
const JOURNEY_STAGES = ["Spark", "Directions", "Develop"];

function JourneyRibbon({ active }: { active: number }) {
  return (
    <div className="flex items-center">
      {JOURNEY_STAGES.map((label, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border font-mono text-[8px]",
                  current
                    ? "border-accent bg-accent/15 text-accent"
                    : done
                      ? "border-accent/40 bg-accent/10 text-accent/80"
                      : "border-border bg-bg text-ink-muted/60",
                )}
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.1em]",
                  current ? "text-ink" : done ? "text-ink-muted" : "text-ink-muted/50",
                )}
              >
                {label}
              </span>
            </div>
            {i < JOURNEY_STAGES.length - 1 && (
              <div
                className={cn("mx-2 h-px flex-1", done ? "bg-accent/40" : "bg-border")}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Market signal — a language OPINION, not a gauge. No bar, no number, no fake precision.
 * It scores the SPECIFIC ANGLE, not the broad category:
 *   • Distinct angle    — the specific combination looks open.
 *   • Competitive space — the category is busy, but this framing is still distinct.
 *   • Very common framing — real players already do this specific thing.
 */
function SignalChip({ read }: { read: MarketRead }) {
  const level =
    read.verdict === "crowded"
      ? "common"
      : read.categoryCrowded
        ? "competitive"
        : "distinct";
  const cfg =
    level === "common"
      ? { label: "Very common framing", dot: "bg-red-400", tone: "text-red-300" }
      : level === "competitive"
        ? { label: "Competitive space", dot: "bg-amber-400", tone: "text-amber-300" }
        : { label: "Distinct angle", dot: "bg-emerald-400", tone: "text-emerald-300" };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em]",
        cfg.tone,
      )}
    >
      <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

/**
 * The right-hand deep dive for the selected direction (the meeting's "click a card →
 * detail on the right" rule). The cards stay slim with just the main idea; the
 * mechanism + full market read + the real claim live here, and "Choose this" starts
 * the walk.
 */
function CardDetail({
  card,
  busy,
  onDeeper,
}: {
  card: LensCard;
  busy: boolean;
  onDeeper: () => void;
}) {
  return (
    <div className="rounded-md border border-accent/40 bg-panel p-4">
      {/* The detail panel shows only what the slim card does NOT — the mechanism + market
          read. It never repeats the card's restatement (that's already on the left). */}
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-action">
        {card.label}
      </div>
      {card.mechanism && (
        <p className="mt-1.5 font-sans text-sm leading-relaxed text-ink">
          <span className="text-ink-muted">The mechanism — </span>
          {card.mechanism}
        </p>
      )}
      {card.marketRead && (
        <div className="mt-3 border-t border-border/60 pt-3">
          {/* Language OPINION, opportunity-first — no gauge, no fake precision. Lead with WHY
              this could matter; the signal is a word, not a bar. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
              Market read
            </span>
            <SignalChip read={card.marketRead} />
            {card.marketRead.confidence === "model" && (
              <span className="font-mono text-[9px] text-ink-muted/70">· unverified</span>
            )}
          </div>
          {(card.marketRead.whyItMatters ||
            card.marketRead.categoryNote ||
            card.marketRead.whitespace) && (
            <p className="mt-2 font-sans text-sm leading-relaxed text-ink">
              {card.marketRead.whyItMatters ||
                card.marketRead.categoryNote ||
                card.marketRead.whitespace}
            </p>
          )}
          {card.marketRead.incumbents.length > 0 && (
            <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-ink-muted">
              Similar: {card.marketRead.incumbents.map((c) => c.name).join(", ")}.
            </p>
          )}
          {card.marketRead.steer && (
            <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-accent">
              <span className="text-ink-muted/80">The opening — </span>
              {card.marketRead.steer}
            </p>
          )}
        </div>
      )}
      {/* No fabricated fallback: when live search didn't return real competitors, we show
          this — never a market read guessed from the model's memory dressed as a finding. */}
      {!card.marketRead && (
        <p className="mt-3 border-t border-border/60 pt-3 font-mono text-[11px] italic leading-relaxed text-ink-muted">
          Market not checked live for this direction — no verified competitors to show.
        </p>
      )}
      <div className="mt-3 flex justify-end">
        {/* The only move: narrow further — three sharper directions of this pick. */}
        <Button variant="primary" onClick={onDeeper} disabled={busy}>
          Go deeper →
        </Button>
      </div>
    </div>
  );
}

/** Lines cycle while the engine works (it can take a while) so it never reads as
 *  frozen. Curtain-safe — describes the experience, never the backstage engine. */
const THINKING_LINES = [
  "Reading the market for your idea…",
  "Checking who's already there…",
  "Finding the sharper, defensible angles…",
  "Shaping three directions for you…",
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

/**
 * One step of the walk, rendered as a small connect-the-dots GAME (§7), not an
 * interrogation. Teaching moves are pure CLICKS — `this_or_that` (two big tappable
 * options) or `pick` (a few options); tapping IS the answer and never advances the
 * stall floor. Only the collision question (`say_it`) gives a text box, because the
 * conditional core that becomes the claim must be the inventor's OWN words.
 */
function WalkStep({
  reaction,
  prompt,
  why,
  kind,
  options,
  busy,
  onAnswer,
}: {
  reaction: string;
  prompt: string;
  why?: string;
  kind?: WalkInteractionKind;
  options: string[];
  busy: boolean;
  onAnswer: (text: string, opts?: { teaching?: boolean }) => void;
}) {
  const [text, setText] = useState("");
  const k = kind ?? "say_it";

  // "You decide" on a teaching step: the inventor defers a detail that isn't theirs to
  // settle — the AI picks and moves on (teaching:true skips the gate, no stall, no flood).
  const youDecide = (
    <button
      type="button"
      onClick={() => onAnswer("I'm not sure — you decide.", { teaching: true })}
      disabled={busy}
      className="mt-3 block font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-accent disabled:opacity-50"
    >
      Not sure? — you decide →
    </button>
  );

  const head = (
    <>
      {reaction && (
        <p className="mb-3 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-muted">
          {reaction}
        </p>
      )}
      <p className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">
        {prompt}
      </p>
      {why && (
        <p className="mt-1 font-mono text-[11px] italic leading-relaxed text-ink-muted">
          {why}
        </p>
      )}
    </>
  );

  // this_or_that — two big tappable options; clicking IS the answer (no typing).
  if (k === "this_or_that" && options.length >= 2) {
    return (
      <div className="rounded-md border border-action/30 bg-action/5 p-4">
        {head}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {options.slice(0, 2).map((opt, j) => (
            <button
              key={j}
              type="button"
              onClick={() => onAnswer(opt, { teaching: true })}
              disabled={busy}
              className="rounded-md border border-accent/40 bg-panel p-3 text-left font-sans text-sm leading-relaxed text-ink transition-colors hover:border-accent hover:bg-accent/10 disabled:opacity-50"
            >
              {opt}
            </button>
          ))}
        </div>
        {youDecide}
      </div>
    );
  }

  // pick — a few tappable options stacked; clicking IS the answer.
  if (k === "pick" && options.length > 0) {
    return (
      <div className="rounded-md border border-action/30 bg-action/5 p-4">
        {head}
        <div className="mt-3 flex flex-col gap-2">
          {options.map((opt, j) => (
            <button
              key={j}
              type="button"
              onClick={() => onAnswer(opt, { teaching: true })}
              disabled={busy}
              className="rounded-md border border-accent/40 bg-panel px-3 py-2 text-left font-sans text-sm leading-relaxed text-ink transition-colors hover:border-accent hover:bg-accent/10 disabled:opacity-50"
            >
              {opt}
            </button>
          ))}
        </div>
        {youDecide}
      </div>
    );
  }

  // say_it — the collision/conception moment. Optional sparks are only starting points
  // to edit; the inventor types the conditional core in their OWN words (the claim).
  return (
    <div className="rounded-md border border-action/30 bg-action/5 p-4">
      {head}
      {options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {options.map((opt, j) => (
            <button
              key={j}
              type="button"
              onClick={() => setText(opt)}
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
        placeholder="…say it in your own words"
        className="mt-2 w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        {/* Defer the core gracefully: ask to be SHOWN the ways it could resolve (the
            stall ladder), instead of being left stuck. Never floods — it's hard-capped. */}
        <button
          type="button"
          onClick={() =>
            onAnswer("I'm not sure — what are the ways this could go?")
          }
          disabled={busy}
          className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-accent disabled:opacity-50"
        >
          Not sure — show me the ways
        </button>
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
