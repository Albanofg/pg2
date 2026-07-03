"use client";

import { useState } from "react";
import { useWorkspace, type ModuleStage } from "@/lib/store";

/** The pipeline order — a stage depends on everything before it. */
const ORDER: { key: ModuleStage; label: string }[] = [
  { key: "conception", label: "Conception" },
  { key: "maturation", label: "Maturation" },
  { key: "landscape", label: "Landscape" },
  { key: "differentiation", label: "Differentiation" },
  { key: "showcase", label: "Showcase" },
];

/**
 * "Start this part over" — go back and change your thinking on one part of the
 * process. Because every later part was derived from this one, restarting cascades:
 * it clears the saved state of every stage AFTER this one (they re-do from the
 * fresh upstream), and re-initializes this stage. A confirm names exactly what
 * gets cleared, so nothing is nuked silently.
 */
export default function RestartPart({
  stage,
  onRestartThis,
  label = "Start this part over",
}: {
  stage: ModuleStage;
  /** Reset + re-initialize THIS stage (its hook's restart). */
  onRestartThis: () => Promise<unknown> | void;
  label?: string;
}) {
  const projectId = useWorkspace((s) => s.projectId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const idx = ORDER.findIndex((s) => s.key === stage);
  const thisLabel = ORDER[idx]?.label ?? stage;
  const downstream = ORDER.slice(idx + 1);

  const run = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      // Clear every later part built on this one.
      await fetch("/api/flow/restart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, fromStage: stage }),
      });
      // Restart this part fresh (reset + re-init).
      await onRestartThis();
      setOpen(false);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-red-300"
      >
        ↺ {label}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-panel p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-red-300">
              Start this part over
            </div>
            <h3 className="mt-1 font-sans text-base font-semibold text-ink">
              Redo {thisLabel} from scratch?
            </h3>
            <p className="mt-2 font-sans text-sm leading-relaxed text-ink-muted">
              You&apos;ll redo {thisLabel} with your new thinking.
              {downstream.length > 0 ? (
                <>
                  {" "}
                  Because they were built on it, this also clears{" "}
                  <span className="text-ink">{downstream.map((d) => d.label).join(", ")}</span> —
                  you&apos;ll go through those parts again.
                </>
              ) : (
                <> This is the last part, so nothing after it is affected.</>
              )}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void run()}
                disabled={busy || !projectId}
                className="rounded-md bg-red-500/80 px-3 py-1.5 font-sans text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {busy
                  ? "Restarting…"
                  : downstream.length > 0
                    ? `Restart & clear ${downstream.length} later part${downstream.length === 1 ? "" : "s"}`
                    : "Restart"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
