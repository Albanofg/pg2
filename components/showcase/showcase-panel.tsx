"use client";

import { useEffect, useRef, useState } from "react";
import { useShowcase } from "@/lib/hooks/use-showcase";
import { useWorkspace } from "@/lib/store";
import HelperComposer from "@/components/workspace/helper-composer";
import HelperThread from "@/components/workspace/helper-thread";
import RestartPart from "@/components/workspace/restart-part";
import type {
  ChoiceCard,
  ConstraintReviewCard,
  CriterionCard,
  DeltaReviewCard,
  ExpansionReviewCard,
  ForestCard,
  ForestTree,
  GenusReviewCard,
  KCHygieneCard,
  Module5Card,
  ShowcaseDrawing,
  ShowcaseKeyConcept,
  SweepCard,
  SweepItem,
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

/** A human-readable filename fragment: keep spaces/case, drop characters illegal
 *  in filenames, collapse whitespace, cap the length. */
function cleanTitleForFilename(title: string | undefined | null): string {
  return (title ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim();
}

const KC_TAB = "__key_concepts";
const DRAWINGS_TAB = "__drawings";

export default function ShowcasePanel({
  projectId,
  maxW = "max-w-5xl",
  mode = "draft",
}: {
  projectId: string | null;
  maxW?: string;
  /** "expansion" = the Genus & Species step (its own page); "draft" = the final Showcase. */
  mode?: "expansion" | "draft";
}) {
  const {
    view,
    busy,
    error,
    ready,
    act,
    decide,
    tell,
    editSection,
    editDrawing,
    editKeyConcept,
    polishSection,
    expand,
    restart,
    exportDisclosure,
    generateDiagrams,
  } = useShowcase(projectId);
  const setStage = useWorkspace((s) => s.setStage);
  const working = busy || !ready;

  const [activeKey, setActiveKey] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [query, setQuery] = useState("");
  const [note, setNote] = useState<string | null>(null);
  // The on-demand section drafter/reviser (narrative sections only): its own busy
  // flag + the agent's change summary, shown under the editor. The proposal lands
  // in the same editable box — nothing is saved until the inventor hits Save.
  const [polishing, setPolishing] = useState<null | "draft" | "revise">(null);
  const [polishNote, setPolishNote] = useState<string | null>(null);

  // Diagrams generation modal — its own busy/error so the slow (planning + render)
  // run never hijacks the panel's module spinner. The finished figures live in the
  // ICB's Drawings tab (view.drawings), not here — this modal is just progress.
  const [diagramsOpen, setDiagramsOpen] = useState(false);
  const [diagramsBusy, setDiagramsBusy] = useState(false);
  const [diagramsError, setDiagramsError] = useState<string | null>(null);

  // Re-running the Genus & Species Expansion overwrites the one already woven into
  // the draft, so once it's been applied we confirm before letting it run again.
  const [confirmReexpand, setConfirmReexpand] = useState(false);
  const onExpandClick = () => {
    if (view.broadened) setConfirmReexpand(true);
    else void expand();
  };

  // The Genus & Species step runs on its own — no button. On landing (and after
  // "Start this part over"), if the engine is SEEDED, not yet applied, and there's
  // nothing to review yet (no sweep on screen), kick it off. The `seeded` guard is
  // essential: during a reset the view is momentarily empty (engine cleared) —
  // firing then no-ops and would wrongly consume the once-guard, so we re-arm.
  const seeded = view.keyConcepts.length > 0 || view.disclosure.length > 0;
  const hasSweep = view.cards.some((c) => c.type === "candidate_sweep");
  const [attempted, setAttempted] = useState(false);
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (mode !== "expansion") return;
    if (!seeded) {
      autoRanRef.current = false; // empty/resetting — re-arm for the fresh start
      setAttempted(false);
      return;
    }
    if (autoRanRef.current || !ready || busy || view.broadened || hasSweep) return;
    autoRanRef.current = true;
    setAttempted(true);
    void expand();
  }, [mode, seeded, ready, busy, view.broadened, hasSweep, expand]);

  // When the inventor goes THROUGH the sweep and finalizes, move straight to the
  // draft — no "continue" button. Keyed on "saw a sweep, then it's applied and the
  // sweep is gone", so it fires for the first run AND a restart re-run, but never
  // bounces someone who just navigated back to a finished step (no sweep seen).
  const sawSweepRef = useRef(false);
  const advancedRef = useRef(false);
  useEffect(() => {
    if (mode !== "expansion") return;
    if (hasSweep) sawSweepRef.current = true;
    if (sawSweepRef.current && view.broadened && !busy && !hasSweep && !advancedRef.current) {
      advancedRef.current = true;
      setStage("showcase");
    }
  }, [mode, hasSweep, view.broadened, busy, setStage]);

  const sections = view.disclosure;
  const drawings = view.drawings;
  // The invention's Title section — used to name downloaded files.
  const inventionTitle = sections.find((s) => s.key === "title")?.body;
  // Why the gated actions are locked, so the required order is obvious.
  const gateHint =
    sections.length === 0
      ? null
      : !view.broadened
        ? "Complete the Genus & Species Expansion above to unlock diagram generation."
        : drawings.length === 0
          ? "Generate the diagrams to unlock the Invention Concept Blueprint and Proof of Human Conception downloads."
          : null;
  const tabs = [
    ...sections.map((s) => ({ key: s.key, label: s.label })),
    ...(view.keyConcepts.length ? [{ key: KC_TAB, label: "Key Concepts" }] : []),
    ...(drawings.length ? [{ key: DRAWINGS_TAB, label: "Drawings" }] : []),
  ];
  // Resolve the selected tab (default to the first section).
  const currentKey = tabs.some((t) => t.key === activeKey) ? activeKey : (tabs[0]?.key ?? "");
  const activeSection = sections.find((s) => s.key === currentKey);

  // Only cards the renderer can actually DRAW. A card of an unknown or stale type
  // rendered as null — which left the "your decisions" header with nothing under it
  // (a permanent blank page), and the empty-state never fired because length > 0.
  // Ignoring undrawable cards means the recovery message + Start-over always show.
  const broadeningCards = view.cards.filter(
    (c) => c.type !== "choice" && RENDERABLE_CARD_TYPES.has(c.type),
  );

  const select = (key: string) => {
    setActiveKey(key);
    setEditing(false);
    setPolishNote(null);
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

  // The narrative sections that offer the on-demand AI drafter/reviser.
  const NARRATIVE_KEYS = new Set(["background", "summary", "abstract"]);
  const canPolish = !!activeSection && NARRATIVE_KEYS.has(activeSection.key);

  const startEdit = () => {
    if (!activeSection) return;
    setDraftText(activeSection.body);
    setPolishNote(null);
    setEditing(true);
  };
  const saveEdit = async () => {
    if (!activeSection) return;
    await editSection(activeSection.key, draftText);
    setPolishNote(null);
    setEditing(false);
  };

  // Draft (rebuild) or revise (preserve + improve) the active section with AI.
  // The result fills the editable box; the inventor reviews and Saves to accept.
  const runPolish = async (mode: "draft" | "revise") => {
    if (!activeSection || polishing) return;
    setPolishing(mode);
    setPolishNote(null);
    const r = await polishSection(activeSection.key, mode);
    setPolishing(null);
    if (r?.proposed) {
      setDraftText(r.proposed);
      setPolishNote(r.changeSummary || "Draft ready — review it below, then Save to keep it.");
    }
  };

  const doExport = async (which: "icb" | "proof") => {
    const r = await exportDisclosure();
    if (!r) return;
    if (which === "icb") {
      // "Invention Concept Blueprint - <Title>.docx", falling back when untitled.
      const cleanTitle = cleanTitleForFilename(inventionTitle);
      const filename = cleanTitle
        ? `Invention Concept Blueprint - ${cleanTitle}.docx`
        : "Invention Concept Blueprint.docx";
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

  // Plan + draw the figures, persist them to the ICB, then jump to the Drawings
  // tab. Opens a progress modal (planning + render can take a couple of minutes);
  // on success it closes and the figures live permanently in the Drawings tab.
  const doGenerateDiagrams = async () => {
    setDiagramsOpen(true);
    setDiagramsBusy(true);
    setDiagramsError(null);
    try {
      const r = await generateDiagrams();
      if (r.drawings.length) {
        setDiagramsOpen(false);
        setActiveKey(DRAWINGS_TAB);
        setNote(
          `Added ${r.drawings.length} figure${r.drawings.length === 1 ? "" : "s"} to your ICB — see the Drawings tab.`,
        );
      } else {
        setDiagramsError("We couldn't derive any figures from this draft yet.");
      }
    } catch (e) {
      setDiagramsError(
        e instanceof Error && e.message
          ? e.message
          : "Couldn't generate diagrams just now. Please try again in a moment.",
      );
    } finally {
      setDiagramsBusy(false);
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
              {mode === "expansion"
                ? "Genus & Species — more ways to build it"
                : "Invention Concept Blueprint — Final Steps"}
            </h2>
            <p className="mt-1 font-sans text-sm text-ink-muted">
              {mode === "expansion"
                ? "Explore the ways your invention could be built and keep the ones that fit — we'll write them into your draft."
                : "Complete the last part of the process and download your Invention Concept Blueprint."}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={() => setStage(mode === "expansion" ? "differentiation" : "genus_species")}
                className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-accent"
              >
                {mode === "expansion" ? "← Differentiation" : "← Genus & Species"}
              </button>
              {mode === "expansion" ? (
                // Same action as arriving here from Differentiation: just re-run the
                // step (regenerate the ways) — NOT a destructive stage reset.
                <button
                  type="button"
                  onClick={onExpandClick}
                  disabled={busy}
                  className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-accent disabled:opacity-50"
                >
                  ↻ Start this part over
                </button>
              ) : (
                <RestartPart stage="showcase" onRestartThis={restart} />
              )}
            </div>
          </header>

          {/* The final draft's actions. The Genus & Species step has no top actions —
              it runs on its own and moves to the draft when it's done. */}
          {mode === "draft" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ActionButton
                onClick={() => void doGenerateDiagrams()}
                disabled={busy || diagramsBusy || sections.length === 0 || !view.broadened}
                label={drawings.length > 0 ? "Re-Generate Diagrams" : "Generate Diagrams"}
                icon="▤"
                hint={!view.broadened ? "Do the Genus & Species step first" : undefined}
              />
              <ActionButton
                onClick={() => void doExport("icb")}
                disabled={busy || sections.length === 0 || drawings.length === 0}
                primary
                label="Download the Invention Concept Blueprint"
                icon="⭳"
                hint={drawings.length === 0 ? "Generate diagrams first" : undefined}
              />
              <ActionButton
                onClick={() => void doExport("proof")}
                disabled={busy || drawings.length === 0}
                label="Download Proof of Human Conception"
                icon="⭳"
                hint={drawings.length === 0 ? "Generate diagrams first" : undefined}
              />
            </div>
          )}
          {gateHint && mode === "draft" && (
            <p className="flex items-center justify-center gap-1.5 text-center font-mono text-[11px] text-ink-muted">
              <span aria-hidden>🔒</span> {gateHint}
            </p>
          )}
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
                  : view.phase === "sweeping" || view.phase === "awaiting_criterion"
                    ? "Finding more ways your invention could be built… this takes a minute or two."
                    : view.phase === "reviewing_artifacts"
                      ? "Writing up the ways you kept…"
                      : "Working through your invention… this takes a minute or two."}
              </span>
            </div>
          )}

          {/* Ran, but nothing came back — never leave a silent blank. */}
          {mode === "expansion" &&
            attempted &&
            ready &&
            !working &&
            !view.broadened &&
            !hasSweep &&
            broadeningCards.length === 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-center">
                <p className="font-sans text-sm font-medium text-ink">
                  We couldn&apos;t find strong ways to build it this time.
                </p>
                <p className="mt-1 font-mono text-xs text-ink-muted">
                  Tap &ldquo;↻ Start this part over&rdquo; above to try again.
                </p>
              </div>
            )}

          {mode === "expansion" && view.broadened && (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2">
              <span className="text-emerald-400">✓</span>
              <span className="font-sans text-[13px] text-ink">
                Added to your draft — continue when you&apos;re ready.
              </span>
            </div>
          )}

          {/* Broadening decisions, when the expansion surfaced any */}
          {mode === "expansion" && broadeningCards.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                Genus &amp; Species · your decisions
              </div>
              {broadeningCards.map((card) => (
                <CardView key={card.id} card={card} busy={busy} onAct={act} onDecide={decide} />
              ))}
            </div>
          )}

          {/* The ICB Draft — tabbed + editable */}
          {mode === "draft" && sections.length > 0 && (
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
                  {currentKey === DRAWINGS_TAB ? (
                    <DrawingsView
                      drawings={drawings}
                      titleBase={slugFilename(inventionTitle, "figure")}
                      busy={working}
                      onEditDescription={editDrawing}
                    />
                  ) : currentKey === KC_TAB ? (
                    <div>
                      <div className="mb-2 font-sans text-sm font-semibold text-ink">Key Concepts</div>
                      <ul className="space-y-3">
                        {view.keyConcepts.map((k) => (
                          <KeyConceptRow
                            key={k.id}
                            kc={k}
                            busy={working}
                            onSave={editKeyConcept}
                          />
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
                          {/* On-demand AI drafter/reviser — narrative sections only.
                              "Revise" preserves your text and only improves it;
                              "Draft fresh" rebuilds from your established material.
                              Both fill the box below — nothing saves until you Save. */}
                          {canPolish && (
                            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-accent/40 bg-accent/[0.04] p-2">
                              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-accent">
                                Let AI help
                              </span>
                              <button
                                onClick={() => void runPolish("revise")}
                                disabled={!!polishing || busy}
                                className="rounded-md bg-accent px-2.5 py-1 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
                              >
                                {polishing === "revise" ? "Revising…" : "✨ Revise current"}
                              </button>
                              <button
                                onClick={() => void runPolish("draft")}
                                disabled={!!polishing || busy}
                                className="rounded-md border border-accent/50 px-2.5 py-1 font-sans text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
                              >
                                {polishing === "draft" ? "Drafting…" : "✨ Draft fresh"}
                              </button>
                              <span className="font-mono text-[10px] italic text-ink-muted">
                                Revise keeps your wording; both preserve every point — review before saving.
                              </span>
                            </div>
                          )}
                          <textarea
                            value={draftText}
                            onChange={(e) => setDraftText(e.target.value)}
                            rows={16}
                            className="w-full resize-y rounded-md border border-border bg-bg p-3 font-sans text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none"
                          />
                          {polishNote && (
                            <div className="mt-2 flex items-start justify-between gap-2 rounded-md border border-accent/30 bg-accent/[0.06] p-2">
                              <p className="font-sans text-[12px] leading-relaxed text-ink-muted">
                                <span className="font-semibold text-accent">AI draft applied — </span>
                                {polishNote}
                              </p>
                              <button
                                onClick={() => {
                                  setDraftText(activeSection.body);
                                  setPolishNote(null);
                                }}
                                className="shrink-0 rounded-md border border-border px-2 py-0.5 font-sans text-[11px] text-ink-muted hover:text-ink"
                              >
                                Restore original
                              </button>
                            </div>
                          )}
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => void saveEdit()}
                              disabled={busy || !!polishing || !draftText.trim()}
                              className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => {
                                setEditing(false);
                                setPolishNote(null);
                              }}
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

          {mode === "draft" && (
            <HelperThread turns={view.conversation} onQuickReply={tell} busy={busy} />
          )}
        </div>
      </div>

      {mode === "draft" && (
        <div className="border-t border-border bg-panel p-4">
          <div className={`mx-auto w-full ${maxW}`}>
            <HelperComposer placeholder="Ask the Helper to polish a section…" busy={busy} onSend={tell} />
          </div>
        </div>
      )}

      {diagramsOpen && (
        <DiagramsProgressModal
          busy={diagramsBusy}
          error={diagramsError}
          onRetry={() => void doGenerateDiagrams()}
          onClose={() => setDiagramsOpen(false)}
        />
      )}

      {confirmReexpand && (
        <ConfirmModal
          title="Re-run the expansion?"
          body="You've already run the Genus & Species Expansion — running it again will replace the current expansion in your draft. Continue?"
          confirmLabel="Re-run expansion"
          onConfirm={() => {
            setConfirmReexpand(false);
            void expand();
          }}
          onClose={() => setConfirmReexpand(false)}
        />
      )}
    </div>
  );
}

/** A small confirm/cancel modal, styled like DiagramsProgressModal — used to guard
 *  destructive re-runs (e.g. re-running an expansion already woven into the draft).
 *  Closes on the backdrop, the ✕, Cancel, or Escape. */
function ConfirmModal({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">
              Genus &amp; Species
            </div>
            <div className="mt-0.5 font-sans text-sm font-semibold text-ink">{title}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 font-mono text-xs text-ink-muted hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="p-6">
          <p className="font-sans text-[13px] leading-relaxed text-ink-muted">{body}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Transient progress modal for figure generation — spinner while planning +
 *  rendering, or the error with a retry. The finished figures live in the
 *  Drawings tab, not here. */
function DiagramsProgressModal({
  busy,
  error,
  onRetry,
  onClose,
}: {
  busy: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">Drawings</div>
            <div className="mt-0.5 font-sans text-sm font-semibold text-ink">
              Generating your figures
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 font-mono text-xs text-ink-muted hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="p-6">
          {busy ? (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <p className="font-mono text-xs text-ink-muted">
                Planning the figure set and drawing each one…
              </p>
              <p className="max-w-xs font-sans text-[11px] text-ink-muted">
                This can take a couple of minutes. They will be saved to the Drawings tab of your ICB.
              </p>
            </div>
          ) : error ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-300">
                {error}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90"
                >
                  Try again
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** One Key Concept in the final draft — read-only text with an inline editor, so
 *  the inventor can polish the title and the concept text (mirrors the section and
 *  drawing editors). Editing the shown text writes back to the broadened form when
 *  present, else the statement. */
function KeyConceptRow({
  kc,
  busy,
  onSave,
}: {
  kc: ShowcaseKeyConcept;
  busy: boolean;
  onSave: (id: string, title: string, text: string) => void;
}) {
  const shownText = kc.broadened || kc.statement;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(kc.title);
  const [text, setText] = useState(shownText);
  // Re-sync when the persisted concept changes underneath us (e.g. broadening).
  useEffect(() => {
    if (!editing) {
      setTitle(kc.title);
      setText(kc.broadened || kc.statement);
    }
  }, [kc.title, kc.broadened, kc.statement, editing]);

  return (
    <li className="rounded-md border border-border bg-bg p-3">
      {editing ? (
        <>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Key Concept title"
            className="w-full rounded-md border border-border bg-panel px-2 py-1.5 font-sans text-[13px] font-semibold text-ink focus:border-accent focus:outline-none"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.max(3, text.split("\n").length + 1)}
            className="mt-2 w-full resize-y rounded-md border border-border bg-panel p-2 font-sans text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                onSave(kc.id, title.trim(), text.trim());
                setEditing(false);
              }}
              disabled={busy || !title.trim() || !text.trim()}
              className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setTitle(kc.title);
                setText(shownText);
                setEditing(false);
              }}
              className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="font-sans text-[13px] font-semibold text-ink">{kc.title}</div>
            <button
              type="button"
              onClick={() => {
                setTitle(kc.title);
                setText(shownText);
                setEditing(true);
              }}
              disabled={busy}
              className="shrink-0 rounded-md border border-border px-2.5 py-1 font-sans text-xs text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
            >
              ✎ Edit
            </button>
          </div>
          <p className="mt-1 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-muted">
            {shownText}
          </p>
          {kc.broadened && (
            <span className="mt-1 inline-block rounded-full border border-accent/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-accent">
              broadened
            </span>
          )}
        </>
      )}
    </li>
  );
}

/** The Drawings part of the ICB: every figure with its drawing (SVG on white, so
 *  the black line art is visible in either theme) plus its grounded Brief and
 *  Detailed descriptions, and a per-figure PDF download. Re-viewable any time. */
function DrawingsView({
  drawings,
  titleBase,
  busy,
  onEditDescription,
}: {
  drawings: ShowcaseDrawing[];
  titleBase: string;
  busy: boolean;
  onEditDescription: (figNumber: number, briefDescription: string, detailedDescription: string) => void;
}) {
  // Which figure is open in the full-screen enlarge view (null = none).
  const [zoomed, setZoomed] = useState<ShowcaseDrawing | null>(null);
  if (!drawings.length) {
    return <p className="font-sans text-sm text-ink-muted">No drawings yet.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="mb-1 font-sans text-sm font-semibold text-ink">Drawings</div>
      <p className="mb-2 font-sans text-xs text-ink-muted">
        Each figure is drawn from your draft, with a description written from the same elements —
        so the words match the drawing.
      </p>

      {/* Brief Description of the Drawings — the one-line-per-figure index. */}
      <div className="rounded-md border border-border bg-bg p-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
          Brief Description of the Drawings
        </div>
        <ul className="mt-2 space-y-1">
          {drawings.map((d) => (
            <li key={d.figNumber} className="font-sans text-[13px] leading-relaxed text-ink">
              {d.briefDescription || `FIG. ${d.figNumber} — ${d.title}`}
            </li>
          ))}
        </ul>
      </div>

      {/* Each figure + its detailed description. */}
      <div className="mt-2 flex flex-col gap-6">
        {drawings.map((d) => (
          <DrawingCard
            key={d.figNumber}
            drawing={d}
            titleBase={titleBase}
            busy={busy}
            onEnlarge={() => setZoomed(d)}
            onEditDescription={onEditDescription}
          />
        ))}
      </div>

      {zoomed && <DrawingLightbox drawing={zoomed} onClose={() => setZoomed(null)} />}
    </div>
  );
}

function DrawingCard({
  drawing,
  titleBase,
  busy,
  onEnlarge,
  onEditDescription,
}: {
  drawing: ShowcaseDrawing;
  titleBase: string;
  busy: boolean;
  onEnlarge: () => void;
  onEditDescription: (figNumber: number, briefDescription: string, detailedDescription: string) => void;
}) {
  // Inline edit of this figure's Brief + Detailed Description of the Drawings — the
  // inventor's own final polish, saved verbatim (mirrors the narrative sections).
  // The diagram itself is not editable here; it only changes by re-generating.
  const [editing, setEditing] = useState(false);
  const [brief, setBrief] = useState(drawing.briefDescription);
  const [text, setText] = useState(drawing.detailedDescription);
  // Re-sync when the persisted descriptions change underneath us (e.g. a redraw).
  useEffect(() => {
    if (!editing) {
      setBrief(drawing.briefDescription);
      setText(drawing.detailedDescription);
    }
  }, [drawing.briefDescription, drawing.detailedDescription, editing]);
  return (
    <figure className="rounded-lg border border-border bg-panel">
      <figcaption className="flex items-center justify-between gap-3 border-b border-border p-3">
        <span className="min-w-0 font-sans text-sm font-semibold text-ink">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
            Fig. {drawing.figNumber}
          </span>{" "}
          {drawing.title}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onEnlarge}
            className="rounded-md border border-border px-2.5 py-1 font-sans text-xs text-ink-muted transition-colors hover:text-ink"
          >
            ⤢ Enlarge
          </button>
          {drawing.pdfBase64 && (
            <a
              href={`data:application/pdf;base64,${drawing.pdfBase64}`}
              download={`${titleBase}-fig-${drawing.figNumber}.pdf`}
              className="rounded-md border border-border px-2.5 py-1 font-sans text-xs text-ink-muted transition-colors hover:text-ink"
            >
              ⭳ PDF
            </a>
          )}
        </div>
      </figcaption>
      {/* Black line art — render on white so it's visible in either theme; wide
          diagrams scroll inside their own box and never overflow the page. Click
          (or Enter/Space) enlarges it in a full-screen lightbox. */}
      <div className="group relative">
        <div
          role="button"
          tabIndex={0}
          onClick={onEnlarge}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onEnlarge();
            }
          }}
          title="Click to enlarge"
          aria-label={`Enlarge Figure ${drawing.figNumber} — ${drawing.title}`}
          className="diagram-svg block cursor-zoom-in overflow-x-auto bg-white p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: drawing.svgData }}
        />
        <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-white opacity-0 transition-opacity group-hover:opacity-100">
          ⤢ Click to enlarge
        </span>
      </div>
      <div className="border-t border-border p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
            Description
          </span>
          {!editing && (
            <button
              type="button"
              onClick={() => {
                setBrief(drawing.briefDescription);
                setText(drawing.detailedDescription);
                setEditing(true);
              }}
              disabled={busy}
              className="rounded-md border border-border px-2.5 py-1 font-sans text-xs text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
            >
              ✎ Edit
            </button>
          )}
        </div>
        {editing ? (
          <>
            <label className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
              Brief (the one-line caption)
            </label>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={2}
              placeholder={`FIG. ${drawing.figNumber} is a … of …`}
              className="mb-2 mt-1 w-full resize-y rounded-md border border-border bg-bg p-2 font-sans text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none"
            />
            <label className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
              Detailed walkthrough
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={Math.max(4, text.split("\n").length + 1)}
              className="mt-1 w-full resize-y rounded-md border border-border bg-bg p-2 font-sans text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onEditDescription(drawing.figNumber, brief.trim(), text.trim());
                  setEditing(false);
                }}
                disabled={busy || (!brief.trim() && !text.trim())}
                className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setBrief(drawing.briefDescription);
                  setText(drawing.detailedDescription);
                  setEditing(false);
                }}
                className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            {drawing.briefDescription && (
              <p className="mb-2 font-sans text-[13px] font-medium leading-relaxed text-ink">
                {drawing.briefDescription}
              </p>
            )}
            {drawing.detailedDescription ? (
              <p className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-muted">
                {drawing.detailedDescription}
              </p>
            ) : (
              <p className="font-sans text-[13px] italic leading-relaxed text-ink-muted">
                No description yet — click Edit to write this figure&rsquo;s walkthrough.
              </p>
            )}
          </>
        )}
      </div>
    </figure>
  );
}

/** Full-screen enlarge view for one figure — opened by clicking the drawing or its
 *  Enlarge button. The SAME SVG is re-rendered to fill a large white canvas (vector,
 *  so it stays crisp at any size) and scrolls if it overflows. Closes on backdrop
 *  click, the ✕, or Escape; body scroll is locked while open. */
function DrawingLightbox({ drawing, onClose }: { drawing: ShowcaseDrawing; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/80 p-4 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Figure ${drawing.figNumber} — ${drawing.title}`}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 pb-3">
        <span className="min-w-0 truncate font-sans text-sm font-semibold text-white">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/60">
            Fig. {drawing.figNumber}
          </span>{" "}
          {drawing.title}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md border border-white/30 px-3 py-1.5 font-mono text-xs text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          ✕ Close
        </button>
      </div>
      {/* The enlarged drawing — stop the backdrop click so clicking the drawing
          itself doesn't close the lightbox. */}
      <div
        className="mx-auto flex w-full max-w-6xl flex-1 overflow-auto rounded-lg bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="diagram-svg m-auto w-full p-6 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: drawing.svgData }}
        />
      </div>
      <p className="mx-auto mt-3 w-full max-w-6xl text-center font-mono text-[10px] text-white/50">
        Click outside the drawing or press Esc to close
      </p>
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
  tooltip,
}: {
  label: string;
  icon: string;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  hint?: string;
  // Hover-only tooltip (no inline "(…)" text). Falls back to `hint` when unset.
  tooltip?: string;
}) {
  return (
    // Wrapper span carries the tooltip: a disabled <button> doesn't fire hover in
    // most browsers, so the title must live on a non-disabled element.
    <span title={tooltip ?? hint} className="flex w-full">
      <button
        onClick={onClick}
        disabled={disabled}
        className={`flex min-h-[4.5rem] w-full flex-col items-center justify-center gap-1 rounded-md border px-4 py-3 text-center font-sans text-sm font-semibold leading-snug transition-colors disabled:cursor-not-allowed disabled:opacity-80 ${
          primary
            ? "border-accent/50 bg-accent/20 text-accent hover:bg-accent/30"
            : "border-border bg-panel text-ink hover:border-accent/50 hover:bg-bg"
        }`}
      >
        <span className="flex items-center gap-2">
          <span aria-hidden>{icon}</span>
          {label}
        </span>
        {hint && (
          <span className="font-sans text-[11px] font-medium text-ink-muted">{hint}</span>
        )}
      </button>
    </span>
  );
}

/** Card types CardView can draw. Anything else is ignored (never a silent blank). */
const RENDERABLE_CARD_TYPES: ReadonlySet<string> = new Set([
  "variation",
  "widened_review",
  "expansion_review",
  "criterion",
  "candidate_sweep",
  "kc_hygiene",
  "constraint_review",
  "genus_review",
  "delta_review",
  "forest",
]);

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
    case "expansion_review":
      return <ExpansionReviewView card={card} busy={busy} onAct={onAct} onDecide={onDecide} />;
    case "criterion":
      return <CriterionView card={card} busy={busy} onAct={onAct} />;
    case "candidate_sweep":
      return <SweepView card={card} busy={busy} onAct={onAct} />;
    case "kc_hygiene":
      return <KCHygieneView card={card} busy={busy} onAct={onAct} />;
    case "constraint_review":
      return <ConstraintReviewView card={card} busy={busy} onAct={onAct} />;
    case "genus_review":
      return <GenusReviewView card={card} busy={busy} onAct={onAct} />;
    case "delta_review":
      return <DeltaReviewView card={card} busy={busy} onAct={onAct} />;
    case "forest":
      return <ForestView card={card} busy={busy} onAct={onAct} />;
    default:
      return null;
  }
}

/** The conversational forest — steer to fill it, claim the trees worth owning. */
function ForestView({
  card,
  busy,
  onAct,
}: {
  card: ForestCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const active = card.trees.filter((t) => t.status !== "dropped");
  const claimed = active.filter((t) => t.status === "claimed").length;
  const kept = active.filter((t) => t.status === "kept").length;

  const sections: { origin: string; label: string; hint: string }[] = [
    { origin: "yours", label: "Your trees", hint: "the ways you started with" },
    { origin: "gap", label: "Filling the gaps", hint: "distinct ways you were missing" },
    { origin: "design_around", label: "Blocking design-arounds", hint: "routes a competitor would try" },
    { origin: "future", label: "Future variants", hint: "where this heads next" },
  ];

  const steer = (direction: string, label: string, icon: string) => (
    <button
      onClick={() => onAct(card.id, { action: "steer", direction } as never)}
      disabled={busy}
      className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/[0.06] px-3 py-1.5 font-sans text-xs font-medium text-ink transition-colors hover:border-accent hover:bg-accent/15 disabled:opacity-50"
    >
      <span aria-hidden>{icon}</span>
      {label}
    </button>
  );

  return (
    <div className="rounded-md border border-border bg-panel p-4">
      {/* The genus — the forest these trees live under. */}
      <div className="rounded-md border border-accent/30 bg-accent/[0.05] p-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-action">
          Your forest — the category you own
        </div>
        <div className="mt-1 font-sans text-base font-semibold text-ink">{card.genusName}</div>
        {card.genusDescription && (
          <p className="mt-1 font-sans text-[12px] leading-relaxed text-ink-muted">
            {card.genusDescription}
          </p>
        )}
        <div className="mt-2 font-mono text-[10px] text-ink-muted">
          {active.length} trees · {claimed} claimed · {kept} covered
        </div>
      </div>

      {/* Steering — the inventor drives what the forest grows into. */}
      <div className="mt-3">
        <div className="mb-1.5 font-sans text-[12px] text-ink-muted">
          Grow your forest — tap to explore, and claim the trees worth owning:
        </div>
        <div className="flex flex-wrap gap-2">
          {steer("missing", "What am I missing?", "🔍")}
          {steer("design_around", "How would a competitor get around this?", "🛡️")}
          {steer("future", "What's the future version?", "🚀")}
        </div>
      </div>

      {/* The trees, grouped by where they came onto the map. */}
      <div className="mt-4 flex flex-col gap-4">
        {sections.map((s) => {
          const trees = active.filter((t) => t.origin === s.origin);
          if (!trees.length) return null;
          return (
            <div key={s.origin}>
              <div className="mb-1.5 flex items-baseline gap-2">
                <span className="font-sans text-[12px] font-semibold text-ink">{s.label}</span>
                <span className="font-sans text-[11px] text-ink-muted">— {s.hint}</span>
              </div>
              <div className="flex flex-col gap-2">
                {trees.map((t) => (
                  <ForestTreeRow
                    key={t.id}
                    cardId={card.id}
                    t={t}
                    busy={busy}
                    claiming={claimingId === t.id}
                    detail={detail}
                    onStartClaim={() => {
                      setClaimingId(t.id);
                      setDetail(t.detail ?? "");
                    }}
                    onCancelClaim={() => setClaimingId(null)}
                    onDetail={setDetail}
                    onAct={onAct}
                    onClaimed={() => setClaimingId(null)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-ink-muted">
          {claimed + kept} of {active.length} going into your draft
        </span>
        <button
          onClick={() => onAct(card.id, { action: "finalize" } as never)}
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
        >
          Done — write up my forest
        </button>
      </div>
    </div>
  );
}

/** One tree: the way + Keep (cover) / Claim (own it, with a one-line +1) / Drop. */
function ForestTreeRow({
  cardId,
  t,
  busy,
  claiming,
  detail,
  onStartClaim,
  onCancelClaim,
  onDetail,
  onAct,
  onClaimed,
}: {
  cardId: string;
  t: ForestTree;
  busy: boolean;
  claiming: boolean;
  detail: string;
  onStartClaim: () => void;
  onCancelClaim: () => void;
  onDetail: (v: string) => void;
  onAct: (cardId: string, input: never) => void;
  onClaimed: () => void;
}) {
  const border =
    t.status === "claimed"
      ? "border-accent bg-accent/15"
      : t.status === "kept"
        ? "border-accent/60 bg-accent/[0.06]"
        : "border-border bg-bg";
  return (
    <div className={`rounded-md border p-3 ${border}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-sans text-[13px] font-semibold text-ink">{t.label}</span>
        {t.status === "claimed" && (
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-accent">claimed</span>
        )}
        {t.status === "kept" && (
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">covered</span>
        )}
      </div>
      {t.note && (
        <p className="mt-1 font-sans text-[11px] italic text-accent/90">{t.note}</p>
      )}
      <p className="mt-1 font-sans text-[12px] text-ink-muted">
        <span className="text-ink">Like:</span> {t.source}
      </p>
      <p className="mt-0.5 font-sans text-[12px] text-ink-muted">
        <span className="text-ink">For you:</span> {t.mapping}
      </p>
      <p className="mt-0.5 font-sans text-[12px] text-ink-muted">
        <span className="text-ink">Tradeoff:</span> {t.tradeoff}
      </p>

      {t.status === "claimed" && t.detail && (
        <p className="mt-1.5 rounded bg-accent/10 px-2 py-1 font-sans text-[12px] text-ink">
          <span className="text-ink-muted">Your take:</span> {t.detail}
        </p>
      )}

      {claiming ? (
        <div className="mt-2">
          <input
            autoFocus
            value={detail}
            onChange={(e) => onDetail(e.target.value)}
            placeholder="In a few words — why this matters, or how you'd actually build it"
            className="w-full rounded-md border border-border bg-panel px-2.5 py-1.5 font-sans text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
          />
          <div className="mt-1.5 flex gap-2">
            <button
              onClick={() => {
                onAct(cardId, { action: "claim", treeId: t.id, detail: detail.trim() } as never);
                onClaimed();
              }}
              disabled={busy || !detail.trim()}
              className="rounded-md bg-accent px-2.5 py-1 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
            >
              Claim it
            </button>
            <button
              onClick={onCancelClaim}
              className="rounded-md border border-border px-2.5 py-1 font-sans text-xs text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            onClick={onStartClaim}
            disabled={busy}
            className={`rounded-md px-2.5 py-1 font-sans text-[11px] font-medium disabled:opacity-50 ${
              t.status === "claimed" ? "bg-accent text-brand" : "border border-accent/50 text-ink hover:bg-accent/10"
            }`}
          >
            {t.status === "claimed" ? "Edit my take" : "Claim it (worth a patent claim)"}
          </button>
          <button
            onClick={() => onAct(cardId, { action: "keep", treeId: t.id } as never)}
            disabled={busy}
            className={`rounded-md px-2.5 py-1 font-sans text-[11px] disabled:opacity-50 ${
              t.status === "kept" ? "bg-accent/70 text-brand" : "border border-border text-ink-muted hover:text-ink"
            }`}
          >
            Just cover it
          </button>
          <button
            onClick={() => onAct(cardId, { action: "drop", treeId: t.id } as never)}
            disabled={busy}
            className="rounded-md border border-border px-2.5 py-1 font-sans text-[11px] text-ink-muted hover:text-red-300 disabled:opacity-50"
          >
            Not mine
          </button>
        </div>
      )}
    </div>
  );
}

/** §6 — confirm what makes each Protected way DIFFERENT (from the inventor's own words). */
function DeltaReviewView({
  card,
  busy,
  onAct,
}: {
  card: DeltaReviewCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState("");
  return (
    <div className="rounded-md border border-accent/40 bg-accent/[0.05] p-4">
      <div className="font-sans text-base font-semibold text-ink">
        What makes these worth protecting?
      </div>
      <p className="mt-0.5 font-sans text-xs text-ink-muted">
        For a claim, each protected way needs something specific that&rsquo;s different. Here&rsquo;s what
        you already said about each — keep what fits. Nothing was written for you.
      </p>
      <div className="mt-3 flex flex-col gap-4">
        {card.regions.map((r) => {
          const off = r.doesNotApply;
          const same = r.sameAsPrimary;
          return (
            <div
              key={r.regionId}
              className={`rounded-md border p-3 ${
                off ? "border-red-500/40 bg-red-500/[0.04] opacity-70" : "border-border bg-bg"
              }`}
            >
              <div className="font-sans text-[13px] font-semibold text-ink">{r.regionLabel}</div>
              {r.deltas.length === 0 && !same && !off && (
                <p className="mt-1 font-sans text-[12px] text-ink-muted">
                  Nothing specific found in your words for this one. Is it the same as your main
                  approach, or not a real option?
                </p>
              )}
              {!off &&
                r.deltas.map((d) => {
                  const kept = d.decision === "kept";
                  return (
                    <div key={d.id} className="mt-2">
                      {editingId === d.id ? (
                        <>
                          <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            rows={2}
                            className="w-full resize-y rounded-md border border-border bg-panel p-2 font-sans text-xs text-ink focus:border-accent focus:outline-none"
                          />
                          <div className="mt-1.5 flex gap-2">
                            <button
                              onClick={() => {
                                onAct(card.id, {
                                  action: "edit",
                                  deltaId: d.id,
                                  quote: text.trim(),
                                } as never);
                                setEditingId(null);
                              }}
                              disabled={busy || !text.trim()}
                              className="rounded-md bg-accent px-2.5 py-1 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="rounded-md border border-border px-2.5 py-1 font-sans text-xs text-ink-muted hover:text-ink"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      ) : (
                        <div
                          className={`rounded-md border p-2 ${
                            kept ? "border-border bg-panel" : "border-border bg-panel/40 opacity-60"
                          }`}
                        >
                          <p className="font-sans text-[12px] leading-relaxed text-ink">
                            &ldquo;{d.quote}&rdquo;
                          </p>
                          <div className="mt-1.5 flex gap-1.5">
                            <button
                              onClick={() => onAct(card.id, { action: "keep", deltaId: d.id } as never)}
                              disabled={busy}
                              className={`rounded-md px-2 py-0.5 font-sans text-[11px] font-medium disabled:opacity-50 ${
                                kept ? "bg-accent text-brand" : "border border-border text-ink-muted hover:text-ink"
                              }`}
                            >
                              Keep
                            </button>
                            <button
                              onClick={() => {
                                setEditingId(d.id);
                                setText(d.quote);
                              }}
                              disabled={busy}
                              className="rounded-md border border-border px-2 py-0.5 font-sans text-[11px] text-ink-muted hover:text-ink disabled:opacity-50"
                            >
                              Trim
                            </button>
                            <button
                              onClick={() => onAct(card.id, { action: "remove", deltaId: d.id } as never)}
                              disabled={busy}
                              className="rounded-md border border-border px-2 py-0.5 font-sans text-[11px] text-ink-muted hover:text-red-300 disabled:opacity-50"
                            >
                              Not this
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  onClick={() =>
                    onAct(card.id, { action: "same_as_primary", regionId: r.regionId } as never)
                  }
                  disabled={busy}
                  className={`rounded-md px-2 py-0.5 font-sans text-[11px] disabled:opacity-50 ${
                    same ? "bg-accent text-brand" : "border border-border text-ink-muted hover:text-ink"
                  }`}
                >
                  Same as my main way
                </button>
                <button
                  onClick={() =>
                    onAct(card.id, { action: "does_not_apply", regionId: r.regionId } as never)
                  }
                  disabled={busy}
                  className={`rounded-md px-2 py-0.5 font-sans text-[11px] disabled:opacity-50 ${
                    off ? "border border-red-500/60 bg-red-500/15 text-red-300" : "border border-border text-ink-muted hover:text-ink"
                  }`}
                >
                  Doesn&rsquo;t apply
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          onClick={() => onAct(card.id, { action: "confirm" } as never)}
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
        >
          Confirm &amp; continue
        </button>
      </div>
    </div>
  );
}

/** A2 — confirm or edit the extracted genus (the category the invention belongs to). */
function GenusReviewView({
  card,
  busy,
  onAct,
}: {
  card: GenusReviewCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(card.genus.genus_description);
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-action">
        The bigger category your invention belongs to
      </div>
      <div className="mt-1 font-sans text-base font-semibold text-ink">
        {card.genus.genus_name}
      </div>
      {editing ? (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="mt-2 w-full resize-y rounded-md border border-border bg-bg p-2 font-sans text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => {
                onAct(card.id, { action: "edit", description: text.trim() } as never);
                setEditing(false);
              }}
              disabled={busy || !text.trim()}
              className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => {
                setText(card.genus.genus_description);
                setEditing(false);
              }}
              className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <p className="mt-1.5 font-sans text-[13px] leading-relaxed text-ink">
          {card.genus.genus_description}
        </p>
      )}

      {card.overbroad.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/[0.05] p-2.5">
          <div className="font-sans text-[12px] font-semibold text-amber-400">
            Might reach further than your words support
          </div>
          <ul className="mt-1 space-y-1">
            {card.overbroad.map((o, i) => (
              <li key={i} className="font-sans text-[12px] text-ink-muted">
                <span className="rounded bg-amber-500/15 px-1 text-amber-300">{o.quote}</span> —{" "}
                {o.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!editing && (
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => {
              setText(card.genus.genus_description);
              setEditing(true);
            }}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted hover:text-ink disabled:opacity-50"
          >
            Edit
          </button>
          <button
            onClick={() => onAct(card.id, { action: "keep" } as never)}
            disabled={busy}
            className="rounded-md bg-accent px-4 py-1.5 font-sans text-sm font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
          >
            Looks right &mdash; continue
          </button>
        </div>
      )}
    </div>
  );
}

/** A3 — confirm the mined constraints (the inventor's own words), grouped by kind. */
function ConstraintReviewView({
  card,
  busy,
  onAct,
}: {
  card: ConstraintReviewCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const groups: { kind: string; label: string }[] = [
    { kind: "constraint", label: "Rules it follows" },
    { kind: "invariant", label: "Things that always hold" },
    { kind: "operation_step", label: "Steps it takes" },
    { kind: "data_structure", label: "What it keeps track of" },
  ];
  const keptCount = card.items.filter((i) => i.kept).length;
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="font-sans text-base font-semibold text-ink">
        Confirm what your invention requires
      </div>
      <p className="mt-0.5 font-sans text-xs text-ink-muted">
        These are pulled straight from your own words. Keep the ones that are real requirements —
        they sharpen every option we show next. Nothing here was written for you.
      </p>
      <div className="mt-3 flex flex-col gap-4">
        {groups.map((g) => {
          const items = card.items.filter((i) => i.kind === g.kind);
          if (!items.length) return null;
          return (
            <div key={g.kind}>
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                {g.label}
              </div>
              <div className="flex flex-col gap-2">
                {items.map((it) => (
                  <div
                    key={it.id}
                    className={`rounded-md border p-2.5 ${
                      it.kept ? "border-border bg-bg" : "border-border bg-bg/40 opacity-60"
                    }`}
                  >
                    {editingId === it.id ? (
                      <>
                        <textarea
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          rows={2}
                          className="w-full resize-y rounded-md border border-border bg-panel p-2 font-sans text-xs text-ink focus:border-accent focus:outline-none"
                        />
                        <div className="mt-1.5 flex gap-2">
                          <button
                            onClick={() => {
                              onAct(card.id, {
                                action: "edit",
                                itemId: it.id,
                                quote: text.trim(),
                              } as never);
                              setEditingId(null);
                            }}
                            disabled={busy || !text.trim()}
                            className="rounded-md bg-accent px-2.5 py-1 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="rounded-md border border-border px-2.5 py-1 font-sans text-xs text-ink-muted hover:text-ink"
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-sans text-[12px] leading-relaxed text-ink">
                          &ldquo;{it.quote}&rdquo;
                        </p>
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            onClick={() => {
                              setEditingId(it.id);
                              setText(it.quote);
                            }}
                            disabled={busy}
                            className="rounded-md border border-border px-2 py-0.5 font-sans text-[11px] text-ink-muted hover:text-ink disabled:opacity-50"
                          >
                            Trim
                          </button>
                          <button
                            onClick={() =>
                              onAct(card.id, { action: "toggle", itemId: it.id } as never)
                            }
                            disabled={busy}
                            className={`rounded-md px-2 py-0.5 font-sans text-[11px] font-medium disabled:opacity-50 ${
                              it.kept
                                ? "bg-accent text-brand"
                                : "border border-border text-ink-muted hover:text-ink"
                            }`}
                          >
                            {it.kept ? "Keep" : "Kept off"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-ink-muted">{keptCount} kept</span>
        <button
          onClick={() => onAct(card.id, { action: "confirm" } as never)}
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
        >
          Confirm &amp; continue
        </button>
      </div>
    </div>
  );
}

/** A1 hygiene — tap-resolve duplicate pairs and flagged spans before the genus runs. */
function KCHygieneView({
  card,
  busy,
  onAct,
}: {
  card: KCHygieneCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const dupes = card.duplicates.filter((d) => !d.resolved);
  const flags = card.flags.filter((f) => !f.resolved);
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.05] p-4">
      <div className="font-sans text-base font-semibold text-ink">Tidy your key concepts</div>
      <p className="mt-0.5 font-sans text-xs text-ink-muted">
        A couple of quick checks before we go on — nothing is changed until you tap.
      </p>

      {dupes.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
            These two are close — keep both unless one is truly redundant
          </div>
          {dupes.map((d) => (
            <div key={d.pairId} className="rounded-md border border-border bg-bg p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[
                  { id: d.aId, title: d.aTitle, statement: d.aStatement },
                  { id: d.bId, title: d.bTitle, statement: d.bStatement },
                ].map((c) => (
                  <div key={c.id} className="rounded-md border border-border bg-panel p-2.5">
                    <div className="font-sans text-[12px] font-semibold text-ink">{c.title}</div>
                    <p className="mt-1 font-sans text-[12px] leading-relaxed text-ink-muted">
                      {c.statement}
                    </p>
                  </div>
                ))}
              </div>
              {d.reason && (
                <p className="mt-2 font-sans text-[11px] italic text-ink-muted">{d.reason}</p>
              )}
              <div className="mt-2 flex items-center gap-3">
                {/* Default, protected action: keep both distinct positions. */}
                <button
                  onClick={() => onAct(card.id, { action: "keep_both", pairId: d.pairId } as never)}
                  disabled={busy}
                  className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
                >
                  Keep both
                </button>
                {/* Deliberate, secondary: only if one truly restates the other. */}
                <span className="font-sans text-[11px] text-ink-muted">
                  or, if one just restates the other, keep only{" "}
                  <button
                    onClick={() =>
                      onAct(card.id, {
                        action: "keep_one",
                        pairId: d.pairId,
                        keepId: d.aId,
                      } as never)
                    }
                    disabled={busy}
                    className="underline underline-offset-2 hover:text-ink disabled:opacity-50"
                  >
                    the first
                  </button>{" "}
                  or{" "}
                  <button
                    onClick={() =>
                      onAct(card.id, {
                        action: "keep_one",
                        pairId: d.pairId,
                        keepId: d.bId,
                      } as never)
                    }
                    disabled={busy}
                    className="underline underline-offset-2 hover:text-ink disabled:opacity-50"
                  >
                    the second
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {flags.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
            Worth a look
          </div>
          {flags.map((f) => (
            <div key={f.flagId} className="rounded-md border border-border bg-bg p-3">
              <p className="font-sans text-[12px] text-ink">
                <span className="text-ink-muted">In &ldquo;{f.kcTitle}&rdquo;:</span> {f.rule}
                {f.quote ? (
                  <>
                    {" "}
                    <span className="rounded bg-amber-500/15 px-1 text-amber-300">{f.quote}</span>
                  </>
                ) : null}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => onAct(card.id, { action: "keep_flag", flagId: f.flagId } as never)}
                  disabled={busy}
                  className="rounded-md border border-border px-2.5 py-1 font-sans text-xs text-ink hover:border-accent disabled:opacity-50"
                >
                  Keep as is
                </button>
                <button
                  onClick={() =>
                    onAct(card.id, { action: "remove_flag", flagId: f.flagId } as never)
                  }
                  disabled={busy}
                  className="rounded-md border border-red-500/50 px-2.5 py-1 font-sans text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                >
                  Remove this concept
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Layer 4 criterion — tap-only. Every option is the inventor's own words; no compose surface. */
function CriterionView({
  card,
  busy,
  onAct,
}: {
  card: CriterionCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-amber-400">
        The one thing to get right
      </div>
      <div className="font-sans text-sm font-semibold text-ink">{card.question}</div>
      <div className="mt-3 flex flex-col gap-2">
        {card.fragments.map((f) => (
          <button
            key={f.id}
            onClick={() => onAct(card.id, { action: "choose", fragmentId: f.id } as never)}
            disabled={busy}
            className="rounded-md border border-border bg-bg px-3 py-2 text-left font-sans text-[13px] text-ink transition-colors hover:border-accent disabled:opacity-50"
          >
            &ldquo;{f.text}&rdquo;
          </button>
        ))}
      </div>
    </div>
  );
}

/** Layer 5 sweep — all the ways to build it, shown flat; keep as many as fit. */
function SweepView({
  card,
  busy,
  onAct,
}: {
  card: SweepCard;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  // Defensive: a sweep card saved before grouping has no `groups`.
  const groups = card.groups ?? [];
  const decided = groups.reduce(
    (n, g) => n + g.items.filter((i) => i.status === "kept" || i.status === "protected").length,
    0,
  );
  if (!groups.length) {
    return (
      <div className="rounded-md border border-border bg-panel p-4">
        <p className="font-sans text-[13px] text-ink-muted">
          This list is from an earlier run. Tap <span className="text-ink">Genus &amp; Species
          Expansion</span> above to refresh it.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-action">
          Genus &amp; Species · decide each way
        </div>
        <span className="font-mono text-[10px] text-ink-muted">{decided} in</span>
      </div>
      <p className="mb-3 font-sans text-[12px] text-ink-muted">
        For each way to build it: <span className="text-ink">Keep</span> to cover it in the write-up,{" "}
        <span className="text-ink">Protect</span> for the ones worth a claim, <span className="text-ink">Remove</span>{" "}
        if it doesn&rsquo;t fit, or <span className="text-ink">Park</span> to decide later.
      </p>

      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <div key={g.family}>
            <div className="mb-1.5 font-sans text-[12px] font-semibold text-ink">{g.family}</div>
            <div className="flex flex-col gap-2">
              {g.items.map((it) => (
                <RegionRow key={it.candidateId} cardId={card.id} it={it} busy={busy} onAct={onAct} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          onClick={() => onAct(card.id, { action: "finalize" } as never)}
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 font-sans text-xs font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
        >
          Done — write these up
        </button>
      </div>
    </div>
  );
}

/** One region on the Phase-C sweep: the way + four tap decisions. */
function RegionRow({
  cardId,
  it,
  busy,
  onAct,
}: {
  cardId: string;
  it: SweepItem;
  busy: boolean;
  onAct: (cardId: string, input: never) => void;
}) {
  const border =
    it.status === "protected"
      ? "border-accent bg-accent/15"
      : it.status === "kept"
        ? "border-accent/60 bg-accent/[0.06]"
        : it.status === "excluded"
          ? "border-red-500/40 bg-red-500/[0.05] opacity-60"
          : it.status === "parked"
            ? "border-amber-500/40 bg-amber-500/[0.05]"
            : "border-border bg-bg";
  const btn = (action: string, label: string, active: boolean, tone: "accent" | "muted" | "danger") => (
    <button
      onClick={() => onAct(cardId, { action, candidateId: it.candidateId } as never)}
      disabled={busy}
      className={`rounded-md px-2.5 py-1 font-sans text-[11px] font-medium transition-colors disabled:opacity-50 ${
        active
          ? tone === "danger"
            ? "border border-red-500/60 bg-red-500/15 text-red-300"
            : "bg-accent text-brand"
          : "border border-border text-ink-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className={`rounded-md border p-3 ${border}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-sans text-[13px] font-semibold text-ink">{it.label}</span>
        {it.grade && (
          <span
            className={`font-mono text-[9px] uppercase tracking-[0.1em] ${
              it.grade === "claim" ? "text-accent" : "text-ink-muted"
            }`}
          >
            {it.grade === "claim" ? "claim" : "disclosure"}
          </span>
        )}
      </div>
      <p className="mt-1 font-sans text-[12px] text-ink-muted">
        <span className="text-ink">Like:</span> {it.source}
      </p>
      <p className="mt-0.5 font-sans text-[12px] text-ink-muted">
        <span className="text-ink">For you:</span> {it.mapping}
      </p>
      <p className="mt-0.5 font-sans text-[12px] text-ink-muted">
        <span className="text-ink">Tradeoff:</span> {it.tradeoff}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {btn("keep", "Keep", it.status === "kept", "accent")}
        {btn("protect", "Protect", it.status === "protected", "accent")}
        {btn("remove", "Remove", it.status === "excluded", "danger")}
        {btn("park", "Park", it.status === "parked", "muted")}
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
    <div className="rounded-md border border-accent/40 bg-accent/[0.06] p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-accent">
        Genus &amp; Species
      </div>
      <p className="mt-1 font-sans text-[13px] leading-relaxed text-ink">{card.question}</p>
      <div className="mt-3">
        <button
          onClick={() => onAct(card.id, { choice: "broaden" } as never)}
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-medium text-brand hover:bg-accent/90 disabled:opacity-50"
        >
          ✦ Explore how it could be built
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
