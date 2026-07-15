"use client";

import { useEffect, useState } from "react";
import { useWorkspace, type ModuleStage } from "@/lib/store";
import { phaseLabel, type PhaseKey } from "@/lib/utils";

const STAGES: ModuleStage[] = [
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
  const setStage = useWorkspace((s) => s.setStage);
  const setPhase = useWorkspace((s) => s.setPhase);
  const setCurrentIdea = useWorkspace((s) => s.setCurrentIdea);
  const setDraftNodes = useWorkspace((s) => s.setDraftNodes);
  const [booting, setBooting] = useState(true);

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
        // Resume the inventor at the furthest stage the server saw them reach.
        if (STAGES.includes(data.stage)) setStage(data.stage as ModuleStage);
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
  }, [activeProjectId, setProject, setStage, setPhase, setCurrentIdea, setDraftNodes]);

  return { booting };
}
