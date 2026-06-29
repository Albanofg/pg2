"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "@/lib/store";
import type {
  CardActionInput,
  Module4View,
} from "@/lib/modules/differentiation/types";

const EMPTY: Module4View = {
  phase: "framing",
  cards: [],
  concepts: [],
  conversation: [],
  ledger: [],
  complete: false,
};

/**
 * Drives the Module 4 (Differentiation) engine over /api/differentiation for one
 * project. On mount it `start`s the engine (idempotent — seeds from the carried
 * concepts + their landscape the first time, returns the live view after).
 */
export function useDifferentiation(projectId: string | null) {
  const [view, setView] = useState<Module4View>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const setProof = useWorkspace((s) => s.setProof);

  const post = useCallback(
    async (payload: Record<string, unknown>): Promise<Module4View | null> => {
      if (!projectId) return null;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/differentiation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, projectId }),
        });
        if (!res.ok) {
          const detail = (await res.json().catch(() => null)) as { detail?: string } | null;
          throw new Error(detail?.detail || `differentiation request failed (${res.status})`);
        }
        const data = (await res.json()) as Module4View;
        setView(data);
        // Right panel: each concept with its differentiation (or base statement).
        setProof(
          {
            core: null,
            concepts: data.concepts
              .filter((c) => c.status.state === "active")
              .map((c) => ({
                title: c.title,
                text: c.differentiation_statement || c.formalized_statement,
              })),
          },
          data.ledger,
        );
        return data;
      } catch (e) {
        setError("The Helper couldn't respond just now. Please try again in a moment.");
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

  const act = useCallback(
    (cardId: string, input: CardActionInput) => post({ op: "act", cardId, input }),
    [post],
  );
  const tell = useCallback((text: string) => post({ op: "message", text }), [post]);
  const restart = useCallback(async () => {
    await post({ op: "reset" });
    return post({ op: "start" });
  }, [post]);

  return { view, busy, error, ready, act, tell, restart };
}
