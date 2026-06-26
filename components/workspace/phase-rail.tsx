"use client";

import { useWorkspace, type ModuleStage } from "@/lib/store";
import { cn } from "@/lib/utils";

/** The five modules, in order — the real flow the workspace navigates. */
const STAGES: { key: ModuleStage; label: string }[] = [
  { key: "conception", label: "Conception" },
  { key: "maturation", label: "Maturation" },
  { key: "landscape", label: "Landscape" },
  { key: "differentiation", label: "Differentiation" },
  { key: "showcase", label: "Showcase" },
];

/** Vertical module indicator, bound to the real `stage`. Click to jump modules. */
export default function PhaseRail() {
  const stage = useWorkspace((s) => s.stage);
  const setStage = useWorkspace((s) => s.setStage);
  const activeIndex = STAGES.findIndex((p) => p.key === stage);

  return (
    <ol className="space-y-1">
      {STAGES.map((p, i) => {
        const isActive = p.key === stage;
        const isDone = i < activeIndex;
        return (
          <li key={p.key}>
            <button
              onClick={() => setStage(p.key)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors duration-150 ease-util hover:bg-accent/10",
                isActive && "bg-accent/15"
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-xs",
                  isActive && "bg-accent text-brand",
                  isDone && "bg-accent/30 text-ink",
                  !isActive && !isDone && "border border-border text-ink-muted"
                )}
              >
                {isDone ? "✓" : i + 1}
              </span>
              <span
                className={cn(
                  "font-sans text-sm",
                  isActive ? "font-semibold text-ink" : "text-ink-muted"
                )}
              >
                {p.label}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
