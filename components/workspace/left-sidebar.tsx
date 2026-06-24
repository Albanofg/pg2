"use client";

import { useRef } from "react";
import Link from "next/link";
import { useWorkspace } from "@/lib/store";
import PhaseRail from "./phase-rail";
import { uploadContextFile } from "@/lib/hooks/use-upload";

/** The Brain — phase, distilled idea state, and uploaded context. */
export default function LeftSidebar({
  collapsed = false,
  onToggle,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const {
    title,
    currentIdea,
    files,
    projectId,
    addFile,
    updateFile,
    removeFile,
  } = useWorkspace();
  const inputRef = useRef<HTMLInputElement>(null);

  if (collapsed) {
    return (
      <aside className="flex h-screen flex-col items-center gap-4 overflow-hidden bg-panel py-3">
        <button
          onClick={onToggle}
          aria-label="Expand The Brain panel"
          title="Expand The Brain"
          className={TOGGLE_CLASS}
        >
          <Chevron dir="right" />
        </button>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted [writing-mode:vertical-rl]">
          The Brain
        </span>
      </aside>
    );
  }

  const onPick = () => inputRef.current?.click();

  const onFiles = async (list: FileList | null) => {
    if (!list || !projectId) return;
    for (const file of Array.from(list)) {
      await uploadContextFile(file, projectId, { addFile, updateFile });
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <aside className="flex h-screen flex-col overflow-hidden bg-panel p-panel">
      <header className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs uppercase tracking-[0.15em] text-action">
            Geyser
          </span>
          <span className="font-mono text-xs text-ink-muted">2.0</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/projects"
            className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors duration-150 ease-util hover:text-accent"
          >
            ← Projects
          </Link>
          <button
            onClick={onToggle}
            aria-label="Collapse The Brain panel"
            title="Collapse The Brain"
            className={TOGGLE_CLASS}
          >
            <Chevron dir="left" />
          </button>
        </div>
      </header>

      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
        Project
      </div>
      <div className="mb-6 truncate font-sans text-sm font-semibold text-ink">
        {title}
      </div>

      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
        Phase
      </div>
      <div className="mb-6">
        <PhaseRail />
      </div>

      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
        Current Idea
      </div>
      <div className="mb-6 max-h-48 overflow-y-auto rounded-md border border-border bg-bg/40 p-3">
        {currentIdea ? (
          <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink">
            {currentIdea}
          </p>
        ) : (
          <p className="font-mono text-xs leading-relaxed text-ink-muted">
            The Helper will distill your core novelty here as you answer.
          </p>
        )}
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
          Context
        </span>
        <button
          onClick={onPick}
          className="font-mono text-[10px] uppercase tracking-[0.1em] text-accent transition-colors duration-150 ease-util hover:text-ink"
        >
          + Upload
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept=".md,.txt,.ts,.tsx,.js,.jsx,.py,.json,.zip,.go,.rs,.java"
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto">
        {files.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-center">
            <p className="font-mono text-xs leading-relaxed text-ink-muted">
              Upload a codebase or README so the Helper can ground its questions
              in your actual system.
            </p>
          </div>
        ) : (
          files.map((f) => (
            <div
              key={f.id}
              className="group flex items-center justify-between rounded-md border border-border bg-bg/40 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate font-mono text-xs text-ink">{f.name}</div>
                <div className="font-mono text-[10px] text-ink-muted">
                  {f.status === "uploading"
                    ? "uploading…"
                    : f.status === "error"
                    ? "failed"
                    : `${(f.size / 1024).toFixed(1)} KB`}
                </div>
              </div>
              <button
                onClick={() => removeFile(f.id)}
                className="ml-2 shrink-0 font-mono text-xs text-ink-muted opacity-0 transition-opacity duration-150 ease-util hover:text-action group-hover:opacity-100"
                aria-label={`Remove ${f.name}`}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

/** Shared style for the collapse/expand toggle — a clearly visible icon button. */
export const TOGGLE_CLASS =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg/60 text-ink transition-colors duration-150 ease-util hover:border-accent hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

/** A crisp chevron used by the panel collapse/expand toggles. */
export function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {dir === "left" ? (
        <polyline points="15 18 9 12 15 6" />
      ) : (
        <polyline points="9 18 15 12 9 6" />
      )}
    </svg>
  );
}
