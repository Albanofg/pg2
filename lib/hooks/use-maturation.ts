"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "@/lib/store";
import type {
  CardActionInput,
  Module2View,
} from "@/lib/modules/maturation/types";

const EMPTY: Module2View = {
  phase: "maturing",
  cards: [],
  concepts: [],
  ledger: [],
  complete: false,
};

/**
 * Drives the Module 2 (Maturation) engine over /api/maturation for one project.
 * On mount it `start`s the engine (idempotent — seeds from the conception
 * concepts the first time, returns the live view after).
 */
export function useMaturation(projectId: string | null) {
  const [view, setView] = useState<Module2View>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** False until the first response arrives — lets the UI show "working" instead
   *  of an empty state during the initial (slow) expand. */
  const [ready, setReady] = useState(false);
  const setProof = useWorkspace((s) => s.setProof);

  const post = useCallback(
    async (payload: Record<string, unknown>): Promise<Module2View | null> => {
      if (!projectId) return null;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/maturation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, projectId }),
        });
        if (!res.ok) throw new Error(`maturation request failed (${res.status})`);
        const data = (await res.json()) as Module2View;
        setView(data);
        // Feed the right panel: each matured concept (deepened) + the notebook.
        setProof(
          {
            core: null,
            concepts: data.concepts
              .filter((c) => c.status.state === "active")
              .map((c) => ({
                title: c.title,
                text: c.deepened_statement || c.formalized_statement,
                ...(c.reasons ? { reasons: c.reasons } : {}),
                ...(c.grade ? { grade: c.grade } : {}),
              })),
          },
          data.ledger,
        );
        return data;
      } catch (e) {
        setError(
          "The Helper couldn't expand these. Check the dev server logs and try again."
        );
        console.error(e);
        return null;
      } finally {
        setBusy(false);
        setReady(true);
      }
    },
    [projectId, setProof]
  );

  useEffect(() => {
    if (projectId) void post({ op: "start" });
  }, [projectId, post]);

  const act = useCallback(
    (cardId: string, input: CardActionInput) => post({ op: "act", cardId, input }),
    [post]
  );
  const tell = useCallback((text: string) => post({ op: "message", text }), [post]);
  const restart = useCallback(async () => {
    await post({ op: "reset" });
    return post({ op: "start" });
  }, [post]);

  return { view, busy, error, ready, act, tell, restart };
}
