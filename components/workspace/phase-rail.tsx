"use client";

import { useWorkspace } from "@/lib/store";
import { PHASES } from "@/lib/utils";
import { cn } from "@/lib/utils";

/** Vertical phase indicator: 1. Core Novelty -> 4. Broadening. */
export default function PhaseRail() {
  const phase = useWorkspace((s) => s.phase);
  const activeIndex = PHASES.find((p) => p.key === phase)?.index ?? 1;

  return (
    <ol className="space-y-1">
      {PHASES.map((p) => {
        const isActive = p.key === phase;
        const isDone = p.index < activeIndex;
        return (
          <li
            key={p.key}
            className={cn(
              "flex items-center gap-3 rounded-md px-2 py-2 transition-colors duration-150 ease-util",
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
              {isDone ? "✓" : p.index}
            </span>
            <span
              className={cn(
                "font-sans text-sm",
                isActive ? "font-semibold text-ink" : "text-ink-muted"
              )}
            >
              {p.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
