"use client";

import { useState } from "react";
import { useWorkspace } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Chevron, TOGGLE_CLASS } from "./left-sidebar";
import type { LedgerEntry } from "@/lib/modules/shared";

type Tab = "idea" | "notebook";

/**
 * The right panel — the inventor's "where am I":
 *  - Current Idea: the living idea, assembled from everything approved so far.
 *  - Inventor's Notebook: the chronological record of what the inventor decided.
 * Both are fed live from the active module's view via the store.
 */
export default function RightSidebar({
  collapsed = false,
  onToggle,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const { proofIdea, proofNotebook, title } = useWorkspace();
  const [tab, setTab] = useState<Tab>("idea");

  if (collapsed) {
    return (
      <aside className="flex h-screen flex-col items-center gap-4 overflow-hidden border-l border-border bg-panel py-3">
        <button
          onClick={onToggle}
          aria-label="Expand the Live Draft panel"
          title="Expand Live Draft"
          className={TOGGLE_CLASS}
        >
          <Chevron dir="left" />
        </button>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted [writing-mode:vertical-rl]">
          Live Draft
        </span>
      </aside>
    );
  }

  return (
    <aside className="flex h-screen flex-col overflow-hidden border-l border-border bg-panel">
      <div className="flex items-center border-b border-border">
        <TabButton active={tab === "idea"} onClick={() => setTab("idea")}>
          Current Idea
        </TabButton>
        <TabButton active={tab === "notebook"} onClick={() => setTab("notebook")}>
          Inventor&apos;s Notebook
        </TabButton>
        <button
          onClick={onToggle}
          aria-label="Collapse the Live Draft panel"
          title="Collapse Live Draft"
          className={cn(TOGGLE_CLASS, "mr-2")}
        >
          <Chevron dir="right" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {tab === "idea" ? (
          <CurrentIdea title={title} idea={proofIdea} />
        ) : (
          <Notebook entries={proofNotebook} />
        )}
      </div>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 px-3 py-3 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors",
        active
          ? "border-b-2 border-accent text-ink"
          : "border-b-2 border-transparent text-ink-muted hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

function CurrentIdea({
  title,
  idea,
}: {
  title: string;
  idea: { core: string | null; concepts: { title: string; text: string }[] };
}) {
  const empty = !idea.core && idea.concepts.length === 0;
  if (empty) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="max-w-xs text-center font-mono text-xs leading-relaxed text-ink-muted">
          Your idea will assemble here as you go — the distilled core and each
          concept you own, updating with every step.
        </p>
      </div>
    );
  }
  return (
    <article className="space-y-5">
      <h1 className="font-sans text-base font-bold text-ink">{title}</h1>

      {idea.core && (
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
            Core
          </div>
          <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink">
            {idea.core}
          </p>
        </div>
      )}

      {idea.concepts.length > 0 && (
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
            Concepts ({idea.concepts.length})
          </div>
          <ul className="space-y-2">
            {idea.concepts.map((c, i) => (
              <li key={i} className="rounded-md border border-border bg-bg p-3">
                <div className="font-sans text-xs font-semibold text-ink">
                  {c.title}
                </div>
                <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink-muted">
                  {c.text}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function Notebook({ entries }: { entries: LedgerEntry[] }) {
  // The inventor's own inputs and decisions — not the machine's bookkeeping.
  const notes = entries.filter((e) => e.origin === "human");
  if (notes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="max-w-xs text-center font-mono text-xs leading-relaxed text-ink-muted">
          Every decision you make — what you approve, edit, keep, drop, or supply
          in your own words — is recorded here as proof of your conception.
        </p>
      </div>
    );
  }
  return (
    <ol className="space-y-3">
      {notes.map((e) => (
        <li key={e.id} className="border-l-2 border-border pl-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-accent">
              {noteLabel(e)}
            </span>
            <span className="shrink-0 font-mono text-[9px] text-ink-muted">
              {formatTime(e.timestamp)}
            </span>
          </div>
          {e.verbatim_text && (
            <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] italic leading-relaxed text-ink">
              “{e.verbatim_text}”
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function noteLabel(e: LedgerEntry): string {
  const action = e.tags?.[1];
  switch (e.type) {
    case "inventor_input":
      return "Described the idea";
    case "inventor_edit":
      return "Edited in their words";
    case "inventor_note":
      return "Noted to the Helper";
    case "clarity_answer":
      return "Answered a question";
    case "leap_input":
      return "Supplied an idea";
    case "review_action":
      return `Reviewed${action ? ` · ${action}` : ""}`;
    case "candidate_action":
      return `Concept${action ? ` · ${action}` : ""}`;
    case "code_action":
      return `Code${action ? ` · ${action}` : ""}`;
    case "addition_confirmed":
      return "Confirmed an addition";
    case "addition_rejected":
      return "Rejected an addition";
    case "deepen_action":
      return `Maturing${action ? ` · ${action}` : ""}`;
    case "concept_decision":
      return `Carry-forward${action ? ` · ${action}` : ""}`;
    case "novelty_statement":
      return "Stated what's new";
    case "differentiation_action":
      return `Differentiation${action ? ` · ${action}` : ""}`;
    case "key_concept_action":
      return `Key Concept${action ? ` · ${action}` : ""}`;
    case "certification_answer":
      return "Certified conception";
    case "broaden_choice":
      return `Broaden${action ? ` · ${action}` : ""}`;
    case "variation_action":
      return `Variation${action ? ` · ${action}` : ""}`;
    case "widened_action":
      return `Broadened${action ? ` · ${action}` : ""}`;
    default:
      return e.type.replace(/_/g, " ");
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
