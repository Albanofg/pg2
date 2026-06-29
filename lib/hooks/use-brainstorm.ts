"use client";

import { useCallback, useState } from "react";
import type { Backpack, BrainstormResult } from "@/lib/modules/brainstorm/types";

/**
 * Drives the Module 0 backstage engine over /api/brainstorm. The engine is
 * invisible (curtain law) — this hook just hands it the problem + backpack and
 * gets back a frontier of directions, each with a Socratic walk. The panel
 * renders only the walk.
 */
export function useBrainstorm() {
  const [result, setResult] = useState<BrainstormResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (input: { problem: string; backpack: Backpack }): Promise<BrainstormResult | null> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/brainstorm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        if (res.status === 401) {
          setError("Your session timed out. Please log in again and retry.");
          return null;
        }
        if (!res.ok) throw new Error(`brainstorm failed (${res.status})`);
        const data = (await res.json()) as BrainstormResult;
        setResult(data);
        return data;
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

  return { result, busy, error, run, reset: () => setResult(null) };
}
