"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/lib/store";
import type {
  CardActionInput,
  Module1View,
} from "@/lib/modules/conception/types";

const EMPTY: Module1View = {
  phase: "ingesting",
  cards: [],
  conversation: [],
  concepts: [],
  ledger: [],
  complete: false,
};

/**
 * Drives the Module 1 (Conception) engine over /api/conception for one project.
 * Holds the current view; exposes ingest / act / reset. The Helper-side surface
 * (cards) renders from `view`; this hook never decides anything itself.
 */
export function useConception(projectId: string | null) {
  const [view, setView] = useState<Module1View>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setProof = useWorkspace((s) => s.setProof);

  // Ops are serialized through a promise chain rather than blocked by `busy`.
  // The controller op is load-snapshot → mutate → save; running two at once would
  // let the second clobber the first's concept (lost update). The chain lets the
  // inventor fire several develops back-to-back (each marks done instantly) while
  // the requests still run strictly in order — fast for the user, race-free data.
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingRef = useRef(0);

  const post = useCallback(
    (payload: Record<string, unknown>): Promise<Module1View | null> => {
      if (!projectId) return Promise.resolve(null);
      pendingRef.current += 1;
      setBusy(true);
      const run = chainRef.current.then(async (): Promise<Module1View | null> => {
        setError(null);
        try {
          const res = await fetch("/api/conception", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...payload, projectId }),
          });
          if (!res.ok) throw new Error(`conception request failed (${res.status})`);
          const data = (await res.json()) as Module1View;
          setView(data);
          // Feed the right panel: the living idea + the notebook of decisions.
          setProof(
            {
              core: data.statement?.text ?? null,
              concepts: data.concepts
                .filter((c) => c.status.state === "active")
                .map((c) => ({ title: c.title, text: c.formalized_statement })),
            },
            data.ledger,
          );
          return data;
        } catch (e) {
          setError(
            "The Helper couldn't respond just now. Please try again in a moment."
          );
          console.error(e);
          return null;
        } finally {
          pendingRef.current -= 1;
          if (pendingRef.current === 0) setBusy(false);
        }
      });
      // Keep the chain alive even if this op rejects, so later ops still run.
      chainRef.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    [projectId, setProof]
  );

  useEffect(() => {
    if (projectId) void post({ op: "view" });
  }, [projectId, post]);

  const ingest = useCallback((raw: string) => post({ op: "ingest", raw }), [post]);
  const act = useCallback(
    (cardId: string, input: CardActionInput) => post({ op: "act", cardId, input }),
    [post]
  );
  const tell = useCallback((text: string) => post({ op: "message", text }), [post]);
  const reset = useCallback(() => post({ op: "reset" }), [post]);

  return { view, busy, error, ingest, act, tell, reset };
}
