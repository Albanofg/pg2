"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Module0View } from "@/lib/modules/orientation/types";

const EMPTY_SESSION = {
  originalInput: "",
  route: null,
  phase: "empty" as const,
  discoveryPhase: "objective" as const,
  maturity: {
    machineLimitation: 0,
    machineMechanism: 0,
    informationFlowChange: 0,
    stateBehavior: 0,
    machineOnlyBehavior: 0,
    technicalCausation: 0,
    measurableEffect: 0,
  },
  commercialObjective: null,
  informationProcess: [],
  ordinaryImplementation: null,
  failureCases: [],
  machineLimitations: [],
  requirements: [],
  requirementConflicts: [],
  mechanismDirections: [],
  approvedMechanism: [],
  machineStates: [],
  stateTransitions: [],
  components: [],
  informationFlows: [],
  orderedInteractions: [],
  technicalEffects: [],
  humanPerformanceFindings: [],
  unresolvedGaps: [],
};

const EMPTY: Module0View = {
  phase: "empty",
  route: null,
  discoveryPhase: "objective",
  conversation: [],
  session: EMPTY_SESSION,
  mechanism: "",
  canWriteBrief: false,
  brief: "",
  ledger: [],
};

/**
 * Drives the Module 0 (Orientation) engine over /api/orientation for one project.
 * Holds the current view; exposes ingest / tell / buildBrief / editBrief / finish
 * / reset. Ops are serialized so load→mutate→save never races.
 */
export function useOrientation(projectId: string | null) {
  const [view, setView] = useState<Module0View>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingRef = useRef(0);

  const post = useCallback(
    (payload: Record<string, unknown>): Promise<Module0View | null> => {
      if (!projectId) return Promise.resolve(null);
      pendingRef.current += 1;
      setBusy(true);
      const run = chainRef.current.then(async (): Promise<Module0View | null> => {
        setError(null);
        try {
          const res = await fetch("/api/orientation", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...payload, projectId }),
          });
          if (!res.ok) throw new Error(`orientation request failed (${res.status})`);
          const data = (await res.json()) as Module0View;
          setView(data);
          return data;
        } catch (e) {
          setError("The Helper couldn't respond just now. Please try again in a moment.");
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
    [projectId],
  );

  useEffect(() => {
    if (projectId) void post({ op: "view" });
  }, [projectId, post]);

  const ingest = useCallback((raw: string) => post({ op: "ingest", raw }), [post]);
  const tell = useCallback((text: string) => post({ op: "message", text }), [post]);
  const buildBrief = useCallback(() => post({ op: "build_brief" }), [post]);
  const editBrief = useCallback((text: string) => post({ op: "edit_brief", text }), [post]);
  const finish = useCallback(() => post({ op: "finish" }), [post]);
  const reset = useCallback(() => post({ op: "reset" }), [post]);

  return { view, busy, ready, error, ingest, tell, buildBrief, editBrief, finish, reset };
}
