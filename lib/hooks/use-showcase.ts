"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "@/lib/store";
import type { CardActionInput, Module5View } from "@/lib/modules/showcase/types";

const EMPTY: Module5View = {
  phase: "choosing",
  cards: [],
  keyConcepts: [],
  disclosure: [],
  species: [],
  broadened: false,
  conversation: [],
  ledger: [],
  complete: false,
};

/**
 * Drives the Module 5 (Showcase · broadening) engine over /api/showcase for one
 * project. On mount it `start`s the engine (idempotent — seeds from the certified
 * Key Concepts + disclosure the first time, returns the live view after).
 */
export function useShowcase(projectId: string | null) {
  const [view, setView] = useState<Module5View>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const setProof = useWorkspace((s) => s.setProof);

  const post = useCallback(
    async (payload: Record<string, unknown>): Promise<Module5View | null> => {
      if (!projectId) return null;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/showcase", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, projectId }),
        });
        if (!res.ok) {
          const detail = (await res.json().catch(() => null)) as { detail?: string } | null;
          throw new Error(detail?.detail || `showcase request failed (${res.status})`);
        }
        const data = (await res.json()) as Module5View;
        setView(data);
        setProof(
          {
            core: null,
            concepts: data.keyConcepts.map((k) => ({
              title: k.title,
              text: k.broadened || k.statement,
            })),
          },
          data.ledger,
        );
        return data;
      } catch (e) {
        setError("The Helper couldn't finish that just now. Please try again in a moment.");
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
  const editSection = useCallback(
    (key: string, body: string) => post({ op: "edit_section", key, body }),
    [post],
  );
  const expand = useCallback(() => post({ op: "expand" }), [post]);

  /** Export the finished disclosure + RFC-3161-sealed proof package. */
  const exportDisclosure = useCallback(async (): Promise<{
    disclosure: string;
    proof: { tsaStatus: string; contentHash: string; sealedAt: string } & Record<string, unknown>;
  } | null> => {
    if (!projectId) return null;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/showcase/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(d?.detail || `export failed (${res.status})`);
      }
      return await res.json();
    } catch (e) {
      setError("Couldn't export your draft just now. Please try again in a moment.");
      console.error(e);
      return null;
    } finally {
      setBusy(false);
    }
  }, [projectId]);
  const restart = useCallback(async () => {
    await post({ op: "reset" });
    return post({ op: "start" });
  }, [post]);

  return { view, busy, error, ready, act, tell, editSection, expand, restart, exportDisclosure };
}
