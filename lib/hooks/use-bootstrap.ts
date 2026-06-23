"use client";

import { useEffect } from "react";
import { useWorkspace } from "@/lib/store";
import { phaseLabel, type PhaseKey } from "@/lib/utils";

/**
 * On mount, load (or create) the inventor's active project and hydrate the
 * Shared Consciousness into the client store. Degrades gracefully if the API
 * is not yet reachable so the Triptych still renders.
 */
export function useBootstrap() {
  const activeProjectId = useWorkspace((s) => s.activeProjectId);
  const setProject = useWorkspace((s) => s.setProject);
  const setPhase = useWorkspace((s) => s.setPhase);
  const setCurrentIdea = useWorkspace((s) => s.setCurrentIdea);
  const setDraftNodes = useWorkspace((s) => s.setDraftNodes);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/projects/bootstrap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: activeProjectId }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.project) return;

        setProject(data.project.id, data.project.title ?? "Untitled Draft");
        setPhase((data.project.currentPhase as PhaseKey) ?? "core_novelty");
        if (typeof data.currentIdea === "string") setCurrentIdea(data.currentIdea);

        if (Array.isArray(data.nodes)) {
          setDraftNodes(
            data.nodes.map((n: any) => ({
              nodeKey: n.nodeKey,
              label: phaseLabel(n.nodeKey) || n.nodeKey,
              draftOutput: n.draftOutput ?? null,
              isVerified: !!n.isVerified,
              invalidated: !!n.invalidatedAt,
            }))
          );
        }
      } catch {
        // Offline / not yet provisioned — keep local state.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, setProject, setPhase, setCurrentIdea, setDraftNodes]);
}
