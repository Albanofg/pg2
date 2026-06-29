"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "@/lib/store";
import type { Module3View } from "@/lib/modules/landscape/types";

const EMPTY: Module3View = {
  phase: "idle",
  ideas: [],
  conversation: [],
  ledger: [],
  complete: false,
};

/**
 * Drives the Module 3 (Landscape) engine over /api/landscape for one project.
 * On mount it `start`s the search (idempotent — seeds from the maturation and
 * runs the searches the first time, returns the saved landscape after).
 */
export function useLandscape(projectId: string | null) {
  const [view, setView] = useState<Module3View>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const setProof = useWorkspace((s) => s.setProof);

  const post = useCallback(
    async (payload: Record<string, unknown>): Promise<Module3View | null> => {
      if (!projectId) return null;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/landscape", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, projectId }),
        });
        if (!res.ok) throw new Error(`landscape request failed (${res.status})`);
        const data = (await res.json()) as Module3View;
        setView(data);
        // Feed the right panel's notebook (the idea/proof trail continues).
        setProof(
          {
            core: null,
            concepts: data.ideas.map((i) => ({ title: i.title, text: i.statement })),
          },
          data.ledger,
        );
        return data;
      } catch (e) {
        setError(
          "The prior-art search couldn't run just now. Please try again in a moment.",
        );
        console.error(e);
        return null;
      } finally {
        setBusy(false);
        setReady(true);
      }
    },
    [projectId, setProof],
  );

  useEffect(() => {
    if (projectId) void post({ op: "start" });
  }, [projectId, post]);

  const research = useCallback(
    (conceptId: string) => post({ op: "research", conceptId }),
    [post],
  );
  const tell = useCallback((text: string) => post({ op: "message", text }), [post]);
  const restart = useCallback(async () => {
    await post({ op: "reset" });
    return post({ op: "start" });
  }, [post]);

  return { view, busy, error, ready, research, tell, restart };
}
