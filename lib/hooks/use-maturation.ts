"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/lib/store";
import type {
  CardActionInput,
  Module2View,
} from "@/lib/modules/maturation/types";

const EMPTY: Module2View = {
  phase: "maturing",
  cards: [],
  concepts: [],
  conversation: [],
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

  // Serialize ops through a promise chain (not blocked by `busy`): one concept can
  // show a deepen card + Sparks at once, and each op is load→mutate→save server-
  // side, so two concurrent acts would let the 2nd clobber the 1st. The chain keeps
  // them strictly ordered while staying responsive.
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingRef = useRef(0);

  const post = useCallback(
    (payload: Record<string, unknown>): Promise<Module2View | null> => {
      if (!projectId) return Promise.resolve(null);
      pendingRef.current += 1;
      setBusy(true);
      const run = chainRef.current.then(async (): Promise<Module2View | null> => {
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
            "The Helper couldn't expand these just now. Please try again in a moment."
          );
          console.error(e);
          return null;
        } finally {
          pendingRef.current -= 1;
          if (pendingRef.current === 0) setBusy(false);
          setReady(true);
        }
      });
      chainRef.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
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
  const editConcept = useCallback(
    (conceptId: string, text: string) => post({ op: "edit", conceptId, text }),
    [post],
  );
  const setCarry = useCallback(
    (conceptId: string, carry: boolean) => post({ op: "set_carry", conceptId, carry }),
    [post]
  );
  const restart = useCallback(async () => {
    await post({ op: "reset" });
    return post({ op: "start" });
  }, [post]);

  return { view, busy, error, ready, act, tell, setCarry, editConcept, restart };
}
