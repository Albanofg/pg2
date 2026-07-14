"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/lib/store";
import type { CardActionInput, Module5View, ShowcaseDrawing } from "@/lib/modules/showcase/types";

/**
 * Optimistically reflect a per-item decision in the local view so the buttons
 * respond instantly while the write lands in the background. Only the cheap
 * status toggles are patched (species approve/reject, artifact keep/remove);
 * every other action waits for the server's authoritative view.
 */
function patchDecision(
  view: Module5View,
  cardId: string,
  input: CardActionInput,
): Module5View {
  return {
    ...view,
    cards: view.cards.map((c) => {
      if (c.id !== cardId) return c;
      if (c.type === "species_review" && "speciesType" in input) {
        const status =
          input.action === "approve"
            ? ("approved" as const)
            : input.action === "reject"
              ? ("rejected" as const)
              : null;
        if (!status) return c;
        return {
          ...c,
          items: c.items.map((it) =>
            it.speciesType === input.speciesType ? { ...it, status } : it,
          ),
        };
      }
      if (c.type === "expansion_review" && "artifactId" in input) {
        const kept =
          input.action === "keep" ? true : input.action === "remove" ? false : null;
        if (kept === null) return c;
        return {
          ...c,
          artifacts: c.artifacts.map((a) =>
            a.id === input.artifactId ? { ...a, kept } : a,
          ),
        };
      }
      return c;
    }),
  };
}

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
  drawings: [],
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

  // Writes are serialized behind this chain so the engine's per-project row is
  // never hit concurrently and responses always apply in click order — a stale
  // full-view reply can't clobber a newer decision.
  const writeChain = useRef<Promise<unknown>>(Promise.resolve());

  const runCore = useCallback(
    async (
      payload: Record<string, unknown>,
      opts: { block: boolean; reconcile: boolean },
    ): Promise<Module5View | null> => {
      if (!projectId) return null;
      if (opts.block) setBusy(true);
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
        // Decisions skip reconcile: the optimistic view already reflects them, and
        // replacing it with an earlier serialized reply would flicker a later flip.
        if (opts.reconcile) {
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
        }
        return data;
      } catch (e) {
        setError("The Helper couldn't finish that just now. Please try again in a moment.");
        console.error(e);
        return null;
      } finally {
        if (opts.block) setBusy(false);
        setReady(true);
      }
    },
    [projectId, setProof],
  );

  // Queue a write behind any in-flight ones. `block` toggles the global busy
  // spinner (heavy actions block the UI; cheap decisions ride quietly);
  // `reconcile` applies the server's authoritative view on return.
  const enqueue = useCallback(
    (
      payload: Record<string, unknown>,
      opts: { block: boolean; reconcile: boolean },
    ): Promise<Module5View | null> => {
      const run = writeChain.current.then(() => runCore(payload, opts));
      writeChain.current = run.catch(() => {}); // one failure must not stall the queue
      return run;
    },
    [runCore],
  );

  const post = useCallback(
    (payload: Record<string, unknown>) => enqueue(payload, { block: true, reconcile: true }),
    [enqueue],
  );

  useEffect(() => {
    if (projectId) void post({ op: "start" });
  }, [projectId, post]);

  // Warm the (sleep-after-idle) diagram service the moment the last stage opens,
  // so the container is awake by the time the inventor asks for figures.
  // Fire-and-forget: warming never blocks and never surfaces an error.
  useEffect(() => {
    if (!projectId) return;
    void fetch("/api/showcase/diagrams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ warm: true }),
    }).catch(() => {});
  }, [projectId]);

  const act = useCallback(
    (cardId: string, input: CardActionInput) => post({ op: "act", cardId, input }),
    [post],
  );

  // A per-item decision (species approve/reject, artifact keep/remove): update
  // the view optimistically so the button flips instantly, then persist in the
  // background without blocking the other buttons. If the write fails, pull the
  // authoritative view so the optimistic flip can't linger as a lie.
  const decide = useCallback(
    (cardId: string, input: CardActionInput) => {
      setView((v) => patchDecision(v, cardId, input));
      return enqueue({ op: "act", cardId, input }, { block: false, reconcile: false }).then(
        (r) => {
          if (r === null) void enqueue({ op: "start" }, { block: false, reconcile: true });
          return r;
        },
      );
    },
    [enqueue],
  );
  const tell = useCallback((text: string) => post({ op: "message", text }), [post]);
  const editSection = useCallback(
    (key: string, body: string) => post({ op: "edit_section", key, body }),
    [post],
  );
  const expand = useCallback(() => post({ op: "expand" }), [post]);

  /**
   * Draft or revise ONE narrative section (Background / Summary / Abstract) with
   * AI, on demand from the editor. Returns a PROPOSAL — it does NOT change the
   * saved draft; the caller drops it into the editable box for the inventor to
   * review and Save. "revise" preserves their text and only improves it; "draft"
   * rebuilds from the established material. Null on failure.
   */
  const polishSection = useCallback(
    async (
      key: string,
      mode: "draft" | "revise",
    ): Promise<{ proposed: string; changeSummary: string; preserved: string[] } | null> => {
      if (!projectId) return null;
      try {
        const res = await fetch("/api/showcase", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ op: "polish_section", key, mode, projectId }),
        });
        if (!res.ok) {
          const d = (await res.json().catch(() => null)) as { detail?: string } | null;
          throw new Error(d?.detail || `polish request failed (${res.status})`);
        }
        return (await res.json()) as { proposed: string; changeSummary: string; preserved: string[] };
      } catch (e) {
        setError("Couldn't draft that section just now. Please try again in a moment.");
        console.error(e);
        return null;
      }
    },
    [projectId],
  );

  /** Export the finished disclosure + RFC-3161-sealed proof package. */
  const exportDisclosure = useCallback(async (): Promise<{
    disclosure: string;
    disclosureDocx: string;
    proofPackage: string;
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
  /**
   * Generate the ICB's drawings for the finished draft. The server plans the
   * figure set, has the diagram service draw it, fuses each figure with its
   * plan-authored description, and persists the result — so this returns the
   * finished, re-viewable drawings. It's a slow call (planning + render), so it
   * deliberately does NOT flip the shared `busy`/`error` state — the panel owns
   * the diagram modal's own busy/error and catches the thrown message here. On
   * success the persisted drawings also land in `view.drawings` on the next start.
   */
  const generateDiagrams = useCallback(async (): Promise<{ drawings: ShowcaseDrawing[] }> => {
    if (!projectId) throw new Error("No project.");
    const res = await fetch("/api/showcase/diagrams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => null)) as { detail?: string } | null;
      throw new Error(d?.detail || `diagram request failed (${res.status})`);
    }
    const data = (await res.json()) as { drawings?: ShowcaseDrawing[] };
    const drawings = data.drawings ?? [];
    // Reflect the freshly-persisted drawings in the live view immediately.
    setView((v) => ({ ...v, drawings }));
    return { drawings };
  }, [projectId]);

  const restart = useCallback(async () => {
    await post({ op: "reset" });
    return post({ op: "start" });
  }, [post]);

  return {
    view,
    busy,
    error,
    ready,
    act,
    decide,
    tell,
    editSection,
    polishSection,
    expand,
    restart,
    exportDisclosure,
    generateDiagrams,
  };
}
