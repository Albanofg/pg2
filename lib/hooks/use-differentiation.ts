"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspace, type ModuleStage } from "@/lib/store";
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
  // Expected gate (prior stages not finished yet) — NOT a failure. Kept separate
  // from `error` so the panel can show a plain "finish X first" with a way there,
  // instead of a red "the Helper couldn't respond".
  const [blocked, setBlocked] = useState<{ message: string; stage: ModuleStage } | null>(null);
  const [ready, setReady] = useState(false);
  const setProof = useWorkspace((s) => s.setProof);

  const post = useCallback(
    async (payload: Record<string, unknown>): Promise<Module4View | null> => {
      if (!projectId) return null;
      setBusy(true);
      setError(null);
      setBlocked(null);
      try {
        const res = await fetch("/api/differentiation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, projectId }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { error?: string; detail?: string; missing?: string }
            | null;
          // Prior modules not done yet is an EXPECTED gate — surface the reason and
          // where to go, not a scary generic error.
          if (res.status === 409 && data?.error === "prior_modules_incomplete") {
            setBlocked({
              message: data.detail || "Finish the earlier stages before Differentiation.",
              stage: data.missing === "maturation" ? "maturation" : "landscape",
            });
            return null;
          }
          throw new Error(data?.detail || `differentiation request failed (${res.status})`);
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
  /** Fire-and-forget: prepare the NEXT concept's analysis in the background while
   *  the inventor answers the current one. Silent — no busy state, no view swap. */
  const prepareNext = useCallback(() => {
    if (!projectId) return;
    void fetch("/api/differentiation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "prepare_next", projectId }),
    }).catch((e) => console.error("[differentiation] prepare_next failed", e));
  }, [projectId]);
  /** The heavy step after the last anchor: compile the disclosure + certify. */
  const compile = useCallback(() => post({ op: "compile" }), [post]);
  const restart = useCallback(async () => {
    await post({ op: "reset" });
    return post({ op: "start" });
  }, [post]);

  return { view, busy, error, blocked, ready, act, tell, prepareNext, compile, restart };
}
