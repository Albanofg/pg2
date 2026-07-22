"use client";

import { useEffect, useState } from "react";
import { useWorkspace, type ModuleStage } from "@/lib/store";
import { phaseLabel, type PhaseKey } from "@/lib/utils";

/** Canonical module order — index = how far a project has progressed. Exported so
 *  the workspace can clamp a URL stage against the furthest reached. */
export const STAGES: ModuleStage[] = [
  "orientation",
  "brainstorm",
  "conception",
  "maturation",
  "landscape",
  "differentiation",
  "genus_species",
  "showcase",
];

/**
 * On mount, load (or create) the inventor's active project and hydrate the
 * Shared Consciousness into the client store. Degrades gracefully if the API
 * is not yet reachable so the Triptych still renders.
 *
 * Returns `booting` so the workspace can hold the center pane until the resumed
 * stage is known — otherwise a finished project flashes the first stage before
 * jumping to where the inventor actually left off.
 */
export function useBootstrap() {
  const activeProjectId = useWorkspace((s) => s.activeProjectId);
  const setProject = useWorkspace((s) => s.setProject);
  const setPhase = useWorkspace((s) => s.setPhase);
  const setCurrentIdea = useWorkspace((s) => s.setCurrentIdea);
  const setDraftNodes = useWorkspace((s) => s.setDraftNodes);
  const [booting, setBooting] = useState(true);
  // The furthest module the server saw this project reach. The workspace owns the
  // actual `setStage` now (URL is authoritative); this is the ceiling to clamp against.
  const [resolvedStage, setResolvedStage] = useState<ModuleStage | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBooting(true);

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
        // Report the furthest stage the server saw; the workspace reconciles it with
        // the URL (honor a reached stage in the URL, else resume at the furthest).
        if (STAGES.includes(data.stage)) setResolvedStage(data.stage as ModuleStage);
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
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, setProject, setPhase, setCurrentIdea, setDraftNodes]);

  return { booting, resolvedStage };
}
