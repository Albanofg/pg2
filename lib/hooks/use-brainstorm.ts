"use client";

import { useCallback, useState } from "react";
import type {
  Backpack,
  DerivationTrace,
  ExcavationFrontier,
  LensCard,
  ReversalStep,
  WalkTurn,
} from "@/lib/modules/brainstorm/types";

/**
 * Drives Module 0 Step 1 over /api/brainstorm. The engine is invisible (curtain
 * law) — this hook hands it the spark and gets back three lens cards; on a pick it
 * opens the adaptive walk; per answer it advances one step. The panel renders only
 * the cards and the walk.
 */
export function useBrainstorm() {
  const [result, setResult] = useState<ExcavationFrontier | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = useCallback(
    async <T,>(body: Record<string, unknown>, onSession = true): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/brainstorm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 401) {
          if (onSession) setError("Your session timed out. Please log in again and retry.");
          return null;
        }
        if (!res.ok) throw new Error(`brainstorm failed (${res.status})`);
        return (await res.json()) as T;
      } catch (e) {
        setError("I couldn't work through that just now. Give it another go in a moment.");
        console.error(e);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  /** The Step-1 frontier: three lens cards from a raw spark (+ optional clarifier answer). */
  const run = useCallback(
    async (input: { spark: string; clarifierAnswer?: string }): Promise<ExcavationFrontier | null> => {
      const data = await post<ExcavationFrontier>({
        problem: input.spark,
        ...(input.clarifierAnswer ? { clarifierAnswer: input.clarifierAnswer } : {}),
      });
      if (data) setResult(data);
      return data;
    },
    [post],
  );

  /** Picked a card — reconstruct + open its walk. */
  const open = useCallback(
    (input: { spark: string; card: LensCard; backpack: Backpack }) =>
      post<{ trace: DerivationTrace; opener: ReversalStep }>({
        op: "open",
        problem: input.spark,
        card: input.card,
        backpack: input.backpack,
      }),
    [post],
  );

  /** One adaptive walk step — reacts to the conversation so far. */
  const step = useCallback(
    (input: {
      trace: DerivationTrace;
      backpack: Backpack;
      conversation: WalkTurn[];
      pushDeeper?: boolean;
    }) => post<ReversalStep>({ op: "step", ...input }),
    [post],
  );

  /** Restore a previously-saved frontier (crash recovery) without a network call. */
  const hydrate = useCallback((f: ExcavationFrontier | null) => setResult(f), []);

  return { result, busy, error, run, open, step, hydrate, reset: () => setResult(null) };
}
