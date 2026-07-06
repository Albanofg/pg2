"use client";

import { useState } from "react";
import { useShowcase } from "@/lib/hooks/use-showcase";
import { useWorkspace } from "@/lib/store";
import HelperComposer from "@/components/workspace/helper-composer";
import HelperThread from "@/components/workspace/helper-thread";
import RestartPart from "@/components/workspace/restart-part";
import type {
  ChoiceCard,
  ExpansionReviewCard,
  Module5Card,
  SpeciesReviewCard,
  VariationCard,
  WidenedReviewCard,
} from "@/lib/modules/showcase/types";

/**
 * Stage 5 — Showcase / the last part. The finished Invention Concept Blueprint as
 * an editable, tabbed draft: pick a section, edit it, polish with the Helper.
 * Top actions: Genus & Species Expansion, Re-Generate Diagrams (coming soon),
 * Download the ICB, Download Proof of Human Conception.
 */
function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Decode base64 binary (e.g. a .docx or .zip) into a Blob and download it. */
function downloadBase64(name: string, b64: string, type: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  saveBlob(name, new Blob([bytes], { type }));
}

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Slugify the invention title into a safe filename base, or fall back. */
function slugFilename(title: string | undefined | null, fallback: string): string {
  const slug = (title ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return slug || fallback;
}

const KC_TAB = "__key_concepts";

export default function ShowcasePanel({
  projectId,
  maxW = "max-w-5xl",
}: {
  projectId: string | null;
  maxW?: string;
}) {
  const { view, busy, error, ready, act, decide, tell, editSection, expand, restart, exportDisclosure } =
    useShowcase(projectId);
  const setStage = useWorkspace((s) => s.setStage);
  const working = busy || !ready;

  const [activeKey, setActiveKey] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [query, setQuery] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const sections = view.disclosure;
  const tabs = [
    ...sections.map((s) => ({ key: s.key, label: s.label })),
    ...(view.keyConcepts.length ? [{ key: KC_TAB, label: "Key Concepts" }] : []),
  ];
  // Resolve the selected tab (default to the first section).
  const currentKey = tabs.some((t) => t.key === activeKey) ? activeKey : (tabs[0]?.key ?? "");
  const activeSection = sections.find((s) => s.key === currentKey);

  const broadeningCards = view.cards.filter((c) => c.type !== "choice");

  const select = (key: string) => {
    setActiveKey(key);
    setEditing(false);
  };

  const onSearch = (q: string) => {
    setQuery(q);
    const needle = q.trim().toLowerCase();
    if (!needle) return;
    const hit = sections.find(
      (s) => s.label.toLowerCase().includes(needle) || s.body.toLowerCase().includes(needle),
    );
    if (hit) select(hit.key);
  };

  const startEdit = () => {
    if (!activeSection) return;
    setDraftText(activeSection.body);
    setEditing(true);
  };
  const saveEdit = async () => {
    if (!activeSection) return;
    await editSection(activeSection.key, draftText);
    setEditing(false);
  };

  const doExport = async (which: "icb" | "proof") => {
    const r = await exportDisclosure();
    if (!r) return;
    if (which === "icb") {
      // Name the file after the invention (its Title section), e.g. "my-invention.docx".
      const inventionTitle = sections.find((s) => s.key === "title")?.body;
      const filename = `${slugFilename(inventionTitle, "invention-concept-blueprint")}.docx`;
      downloadBase64(filename, r.disclosureDocx, DOCX_MIME);
      setNote("Downloaded your Invention Concept Blueprint.");
    } else {
      downloadBase64("proof-of-human-conception.zip", r.proofPackage, "application/zip");
      setNote(
        r.proof.tsaStatus === "ok"
          ? "Downloaded your Proof of Human Conception package (time-sealed)."
          : "Downloaded your Proof of Human Conception package (server-timed; TSA was unreachable, re-sealable later).",
      );
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className={`mx-auto flex w-full flex-col gap-5 p-6 ${maxW}`}>
          {/* Header */}
          <header className="flex flex-col items-center text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-accent/40 bg-accent/10 text-accent">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h2 className="mt-3 font-sans text-xl font-semibold text-ink">
              Invention Concept Blueprint — Final Steps
            </h2>
            <p className="mt-1 font-sans text-sm text-ink-muted">
              Complete the last part of the process and download your Invention Concept Blueprint.
            </p>
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={() => setStage("differentiation")}
                className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-accent"
              >
                ← Differentiation
              </button>
              <RestartPart stage="showcase" onRestartThis={restart} />
            </div>
          </header>

          {/* Four top actions */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ActionButton
              onClick={() => void expand()}
              disabled={busy}
              primary
              label="Genus & Species Expansion"
              icon="✦"
            />
            <ActionButton
              disabled
              label="Re-Generate Diagrams"
              icon="▤"
              hint="Coming soon"
            />
            <ActionButton
              onClick={() => void doExport("icb")}
              disabled={busy || sections.length === 0}
              primary
              label="Download the Invention Concept Blueprint"
              icon="⭳"
            />
            <ActionButton
              onClick={() => void doExport("proof")}
              disabled={busy}
              label="Download Proof of Human Conception"
              icon="⭳"
            />
          </div>
          {note && <p className="text-center font-mono text-[11px] text-ink-muted">{note}</p>}

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-300">
              {error}
            </div>
          )}

          {working && (
            <div className="flex items-center gap-3 rounded-md border border-accent/30 bg-accent/5 p-4">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <span className="font-mono text-xs text-ink-muted">
                {sections.length === 0
                  ? "Loading your draft…"
                  : view.phase === "reviewing_species"
                    ? "Drafting the full expansion for your review — broadened concepts, new concepts, and section extensions… this takes a few minutes."
                    : view.phase === "reviewing_artifacts"
                      ? "Working…"
                      : view.phase === "selecting_variations" || view.phase === "approving_widened"
                        ? "Working through the expansion…"
                        : "Working — extracting the underlying mechanism and drafting the alternative implementations… this takes a minute or two."}
              </span>
            </div>
          )}

          {view.broadened && (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2">
              <span className="text-emerald-400">✓</span>
              <span className="font-sans text-[13px] text-ink">Expansion applied to your draft.</span>
              <span className="ml-1 rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
                Applied
              </span>
            </div>
          )}

          {/* Broadening decisions, when the expansion surfaced any */}
          {broadeningCards.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                Genus &amp; Species Expansion · your decisions
              </div>
              {broadeningCards.map((card) => (
                <CardView key={card.id} card={card} busy={busy} onAct={act} onDecide={decide} />
              ))}
            </div>
          )}

          {/* The ICB Draft — tabbed + editable */}
          {sections.length > 0 && (
            <div className="rounded-lg border border-border bg-panel">
              <div className="flex items-center justify-between gap-2 border-b border-border p-4">
                <div>
                  <div className="flex items-center gap-2 font-sans text-sm font-semibold text-ink">
                    <span className="text-accent">▤</span> Invention Concept Blueprint · Draft
                  </div>
                  <p className="mt-0.5 font-sans text-xs text-ink-muted">
                    Review your ICB summary and key concept ideas — edit any section, or ask the Helper to polish it.
                  </p>
                </div>
              </div>

              {/* Search the draft */}
              <div className="border-b border-border p-3">
                <input
                  value={query}
                  onChange={(e) => onSearch(e.target.value)}
                  placeholder="Search the draft — paste a phrase the Helper flagged…"
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 font-sans text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
                />
              </div>

              <div className="flex flex-col md:flex-row">
                {/* Left tab nav */}
                <nav className="shrink-0 border-b border-border p-2 md:w-56 md:border-b-0 md:border-r">
                  <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
                    {tabs.map((t, i) => (
                      <li key={t.key}>
                        <button
                          onClick={() => select(t.key)}
                          className={`w-full whitespace-nowrap rounded-md px-3 py-2 text-left font-sans text-[13px] transition-colors ${
                            t.key === currentKey
                              ? "bg-accent/15 font-medium text-accent"
                              : "text-ink-muted hover:bg-bg hover:text-ink"
                          }`}
                        >
                          <span className="font-mono text-[10px] text-ink-muted">{i + 1}.</span>{" "}
                          {t.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </nav>

                {/* Right pane */}
                <div className="min-w-0 flex-1 p-4">
                  {currentKey === KC_TAB ? (
                    <div>
                      <div className="mb-2 font-sans text-sm font-semibold text-ink">Key Concepts</div>
                      <ul className="space-y-3">
                        {view.keyConcepts.map((k) => (
                          <li key={k.id} className="rounded-md border border-border bg-bg p-3">
                            <div className="font-sans text-[13px] font-semibold text-ink">{k.title}</div>
                            <p className="mt-1 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-muted">
                              {k.broadened || k.statement}
                            </p>
                            {k.broadened && (
                              <span className="mt-1 inline-block rounded-full border border-accent/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-accent">
                                broadened
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : activeSection ? (
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="font-sans text-sm font-semibold text-ink">
                          {activeSection.label}
                        </div>
                        {!editing && (
                          <button
                            onClick={startEdit}
                            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 font-sans text-xs text-ink-muted transition-colors hover:text-ink"
                          >
                            ✎ Edit
                          </button>
                        )}
                      </div>
                      {editing ? (
                        <>
                          <textarea
                            value={draftText}
                            onChange={(e) => setDraftText(e.target.value)}
                            rows={16}
                            className="w-full resize-y rounded-md border border-border bg-bg p-3 font-sans text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none"
                          />
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => void saveEdit()}
                              disabled={busy || !draftText.trim()}
                              className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditing(false)}
                              className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink">
                          {activeSection.body}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="font-sans text-sm text-ink-muted">Select a section.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {!working && sections.length === 0 && view.keyConcepts.length === 0 && (
            <div className="rounded-md border border-border bg-panel p-5 text-center">
              <p className="font-mono text-xs leading-relaxed text-ink-muted">
                Nothing to show yet — complete Differentiation first.
              </p>
              <div className="mt-3 flex justify-center gap-2">
                <button
                  onClick={() => setStage("differentiation")}
                  className="rounded-md border border-border px-4 py-2 font-sans text-sm text-ink-muted hover:text-ink"
                >
                  ← Back to Differentiation
                </button>
                <button
                  onClick={() => void restart()}
                  className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-medium text-brand hover:bg-accent/90"
                >
                  Restart this stage
                </button>
              </div>
            </div>
          )}

          <HelperThread turns={view.conversation} onQuickReply={tell} busy={busy} />
        </div>
      </div>

      <div className="border-t border-border bg-panel p-4">
        <div className={`mx-auto w-full ${maxW}`}>
          <HelperComposer placeholder="Ask the Helper to polish a section…" busy={busy} onSend={tell} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
  primary,
  hint,
}: {
  label: string;
  icon: string;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  hint?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={`flex items-center justify-center gap-2 rounded-md border px-4 py-3 font-sans text-sm font-medium transition-colors disabled:opacity-50 ${
        primary
          ? "border-accent/40 bg-accent/15 text-accent hover:bg-accent/25"
          : "border-border bg-panel text-ink-muted hover:text-ink"
      }`}
    >
      <span aria-hidden>{icon}</span>
      {label}
      {hint && <span className="ml-1 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">({hint})</span>}
    </button>
  );
}

function CardView({
  card,
  busy,
  onAct,
  onDecide,
}: {
  card: Module5Card;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
  onDecide: (cardId: string, input: never) => void;
}) {
  switch (card.type) {
    case "choice":
      return <ChoiceView card={card} busy={busy} onAct={onAct} />;
    case "variation":
      return <VariationView card={card} busy={busy} onAct={onAct} />;
    case "widened_review":
      return <WidenedReviewView card={card} busy={busy} onAct={onAct} />;
    case "species_review":
      return <SpeciesReviewView card={card} busy={busy} onAct={onAct} onDecide={onDecide} />;
    case "expansion_review":
      return <ExpansionReviewView card={card} busy={busy} onAct={onAct} onDecide={onDecide} />;
    default:
      return null;
  }
}

/** GATE 1 (V1): all species on one screen — Approve / Edit / Reject each, then
 *  Confirm & Continue. Only approved implementations continue. */
function SpeciesReviewView({
  card,
  busy,
  onAct,
  onDecide,
}: {
  card: SpeciesReviewCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
  onDecide: (cardId: string, input: never) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const allDecided = card.items.every((i) => i.status !== "pending");
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="font-sans text-base font-semibold text-ink">Review AI implementations</div>
      <p className="mt-0.5 font-sans text-xs text-ink-muted">
        Approve, edit, or reject each — only approved ones get woven into your draft.
      </p>
      <div className="mt-3 space-y-3">
        {card.items.map((it) => (
          <div
            key={it.speciesType}
            className={`rounded-md border p-3 ${
              it.status === "approved"
                ? "border-emerald-500/40 bg-emerald-500/[0.05]"
                : it.status === "rejected"
                  ? "border-border bg-bg/40 opacity-60"
                  : "border-border bg-bg"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-sans text-sm font-semibold text-ink">
                {it.label}
                {it.status !== "pending" && (
                  <span
                    className={`ml-2 font-mono text-[9px] uppercase tracking-[0.1em] ${
                      it.status === "approved" ? "text-emerald-400" : "text-red-300"
                    }`}
                  >
                    {it.status}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  onClick={() => onDecide(card.id, { action: "approve", speciesType: it.speciesType } as never)}
                  disabled={busy}
                  className={`rounded-md px-2.5 py-1 font-sans text-xs font-medium disabled:opacity-50 ${
                    it.status === "approved"
                      ? "bg-accent text-brand"
                      : "border border-border text-ink-muted hover:text-ink"
                  }`}
                >
                  Approve
                </button>
                <button
                  onClick={() => {
                    setEditing(it.speciesType);
                    setText(it.description);
                  }}
                  disabled={busy}
                  className="rounded-md border border-border px-2.5 py-1 font-sans text-xs text-ink-muted hover:text-ink disabled:opacity-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDecide(card.id, { action: "reject", speciesType: it.speciesType } as never)}
                  disabled={busy}
                  className={`rounded-md px-2.5 py-1 font-sans text-xs disabled:opacity-50 ${
                    it.status === "rejected"
                      ? "border border-red-500/60 bg-red-500/15 text-red-300"
                      : "border border-border text-ink-muted hover:border-red-500/40 hover:text-red-300"
                  }`}
                >
                  Reject
                </button>
              </div>
            </div>
            {editing === it.speciesType ? (
              <>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={6}
                  className="mt-2 w-full resize-y rounded-md border border-border bg-panel p-2 font-sans text-xs leading-relaxed text-ink focus:border-accent focus:outline-none"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => {
                      onAct(card.id, {
                        action: "edit",
                        speciesType: it.speciesType,
                        text: text.trim(),
                      } as never);
                      setEditing(null);
                    }}
                    disabled={busy || !text.trim()}
                    className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <p className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-ink-muted">
                {it.description}
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-ink-muted">
          {allDecided
            ? "All decided — continuing drafts the full expansion for your review (a few minutes)."
            : "Decide every implementation to continue."}
        </span>
        <button
          onClick={() => onAct(card.id, { action: "confirm" } as never)}
          disabled={busy || !allDecided}
          className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
        >
          Confirm &amp; Continue
        </button>
      </div>
    </div>
  );
}

/** GATE 2 (V1): every expansion artifact individually reviewable — Regenerate /
 *  Keep / Edit / Remove — then Finalize Expansion weaves the kept ones in. */
function ExpansionReviewView({
  card,
  busy,
  onAct,
  onDecide,
}: {
  card: ExpansionReviewCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
  onDecide: (cardId: string, input: never) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const keptCount = card.artifacts.filter((a) => a.kept).length;
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="font-sans text-base font-semibold text-ink">Review expanded content</div>
      <p className="mt-0.5 font-sans text-xs text-ink-muted">
        Approve, edit, or reject each artifact. Only approved content enters your draft.
      </p>
      <div className="mt-3 space-y-3">
        {card.artifacts.map((a) => {
          const isOpen = expanded.has(a.id);
          return (
            <div
              key={a.id}
              className={`rounded-md border p-3 ${
                a.kept ? "border-border bg-bg" : "border-border bg-bg/40 opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                    {a.label}
                  </div>
                  {a.original && (
                    <p className="mt-0.5 truncate font-sans text-[11px] italic text-ink-muted/80">
                      {a.original}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => onAct(card.id, { action: "regenerate", artifactId: a.id } as never)}
                    disabled={busy}
                    className="rounded-md border border-border px-2.5 py-1 font-sans text-xs text-ink-muted hover:text-ink disabled:opacity-50"
                  >
                    Regenerate
                  </button>
                  <button
                    onClick={() => onDecide(card.id, { action: "keep", artifactId: a.id } as never)}
                    disabled={busy}
                    className={`rounded-md px-2.5 py-1 font-sans text-xs font-medium disabled:opacity-50 ${
                      a.kept ? "bg-accent text-brand" : "border border-border text-ink-muted hover:text-ink"
                    }`}
                  >
                    Keep
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(a.id);
                      setText(a.text);
                    }}
                    disabled={busy}
                    className="rounded-md border border-border px-2.5 py-1 font-sans text-xs text-ink-muted hover:text-ink disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDecide(card.id, { action: "remove", artifactId: a.id } as never)}
                    disabled={busy}
                    className={`rounded-md px-2.5 py-1 font-sans text-xs disabled:opacity-50 ${
                      !a.kept
                        ? "border border-red-500/60 bg-red-500/15 text-red-300"
                        : "border border-border text-ink-muted hover:border-red-500/40 hover:text-red-300"
                    }`}
                  >
                    Remove
                  </button>
                </div>
              </div>
              {editingId === a.id ? (
                <>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={8}
                    className="mt-2 w-full resize-y rounded-md border border-border bg-panel p-2 font-sans text-xs leading-relaxed text-ink focus:border-accent focus:outline-none"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => {
                        onAct(card.id, { action: "edit", artifactId: a.id, text: text.trim() } as never);
                        setEditingId(null);
                      }}
                      disabled={busy || !text.trim()}
                      className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p
                    className={`mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-ink ${
                      isOpen ? "" : "line-clamp-4"
                    }`}
                  >
                    {a.text}
                  </p>
                  <button
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(a.id)) next.delete(a.id);
                        else next.add(a.id);
                        return next;
                      })
                    }
                    className="mt-1 font-sans text-[11px] text-accent underline-offset-2 hover:underline"
                  >
                    {isOpen ? "Collapse" : "Read full text"}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-ink-muted">
          {keptCount} of {card.artifacts.length} will be woven into your draft.
        </span>
        <button
          onClick={() => onAct(card.id, { action: "finalize" } as never)}
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
        >
          Finalize Expansion
        </button>
      </div>
    </div>
  );
}

function ChoiceView({
  card,
  busy,
  onAct,
}: {
  card: ChoiceCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-action">
        Broaden? · optional
      </div>
      <p className="mt-1 font-sans text-xs leading-relaxed text-ink-muted">{card.question}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onAct(card.id, { choice: "broaden" } as never)}
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
        >
          Broaden it
        </button>
        <button
          onClick={() => onAct(card.id, { choice: "skip" } as never)}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink disabled:opacity-50"
        >
          Finish as is
        </button>
      </div>
    </div>
  );
}

function VariationView({
  card,
  busy,
  onAct,
}: {
  card: VariationCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-action">
        Variation · keep or drop
      </div>
      <div className="font-sans text-sm font-semibold text-ink">
        {card.name}
        <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
          {card.speciesType.replace(/_/g, " ")}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-ink-muted">
        {card.description}
      </p>
      {card.improvements.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4">
          {card.improvements.map((imp, i) => (
            <li key={i} className="font-sans text-[11px] leading-relaxed text-ink-muted">
              {imp}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onAct(card.id, { action: "keep" } as never)}
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
        >
          Keep
        </button>
        <button
          onClick={() => onAct(card.id, { action: "drop" } as never)}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink disabled:opacity-50"
        >
          Drop
        </button>
      </div>
    </div>
  );
}

function WidenedReviewView({
  card,
  busy,
  onAct,
}: {
  card: WidenedReviewCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(card.broadened);
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-action">
        Broadened · approve, edit, or discard
      </div>
      <div className="font-sans text-sm font-semibold text-ink">{card.title}</div>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">Original</p>
      <p className="mt-1 whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-ink-muted">
        {card.original}
      </p>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">Broadened</p>
      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className="mt-1 w-full resize-y rounded-md border border-border bg-bg p-2 font-sans text-xs text-ink focus:border-accent focus:outline-none"
        />
      ) : (
        <p className="mt-1 whitespace-pre-wrap font-sans text-xs leading-relaxed text-ink">
          {card.broadened}
        </p>
      )}
      {editing ? (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() =>
              onAct(card.id, { action: "request_edit", correction: text.trim() } as never)
            }
            disabled={busy || !text.trim()}
            className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
          >
            Save my version
          </button>
          <button
            onClick={() => setEditing(false)}
            className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => onAct(card.id, { action: "approve" } as never)}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => setEditing(true)}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink disabled:opacity-50"
          >
            Edit
          </button>
          <button
            onClick={() => onAct(card.id, { action: "discard" } as never)}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-red-300 hover:border-red-500/40 hover:bg-red-500/10 disabled:opacity-50"
          >
            Keep original
          </button>
        </div>
      )}
    </div>
  );
}
