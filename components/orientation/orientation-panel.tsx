"use client";

import { useState } from "react";
import { useOrientation } from "@/lib/hooks/use-orientation";
import { useWorkspace } from "@/lib/store";
import HelperComposer from "@/components/workspace/helper-composer";
import HelperThread from "@/components/workspace/helper-thread";
import { VoiceTextarea } from "@/components/ui/voice-textarea";
import { Button } from "@/components/ui/button";
import type { Clause, DiscoveryPhase, OrientationSession } from "@/lib/modules/orientation/types";

/**
 * Module 0 — Orientation. Guided mechanism discovery: the inventor moves from a
 * business outcome to a real machine mechanism (that resolves a requirement
 * conflict), stated in their own words. The panel shows the CONVERSATION plus a
 * live, provenance-tagged view of the structured discovery so far, so the inventor
 * always sees the idea materializing — not just a stream of questions.
 */

/** The discovery phases in order, for the progress rail. */
const PHASE_LABELS: { key: DiscoveryPhase; label: string }[] = [
  { key: "objective", label: "Objective" },
  { key: "process", label: "Ordinary process" },
  { key: "baseline", label: "Where it fails" },
  { key: "limitation", label: "Machine limitation" },
  { key: "conflict", label: "The conflict" },
  { key: "mechanism", label: "Your mechanism" },
  { key: "effect", label: "Technical effect" },
];

/** Which phases have a real artifact yet (drives the progress rail ticks). */
function phaseDone(s: OrientationSession, key: DiscoveryPhase): boolean {
  switch (key) {
    case "objective":
      return !!s.commercialObjective;
    case "process":
      return s.informationProcess.length > 0;
    case "baseline":
      return s.failureCases.length > 0;
    case "limitation":
      return s.machineLimitations.length > 0;
    case "conflict":
      return s.requirementConflicts.length > 0;
    case "mechanism":
      return s.approvedMechanism.length > 0;
    case "effect":
      return s.technicalEffects.length > 0;
    default:
      return false;
  }
}

/** Provenance dot + label. */
function originBadge(origin: Clause["origin"]) {
  const map = {
    user_stated: { c: "text-emerald-400", t: "yours" },
    user_selected: { c: "text-emerald-400", t: "yours" },
    system_inferred: { c: "text-amber-400", t: "suggested" },
    system_suggested: { c: "text-amber-400", t: "suggested" },
  } as const;
  const m = map[origin];
  return <span className={`font-mono text-[9px] uppercase tracking-[0.1em] ${m.c}`}>{m.t}</span>;
}

export default function OrientationPanel({ maxW = "max-w-2xl" }: { maxW?: string }) {
  const projectId = useWorkspace((s) => s.projectId);
  const setStage = useWorkspace((s) => s.setStage);
  const setOrientationBrief = useWorkspace((s) => s.setOrientationBrief);
  const { view, busy, ready, error, ingest, tell, buildBrief, editBrief, finish, reset } =
    useOrientation(projectId);
  const working = busy || !ready;
  const [briefDraft, setBriefDraft] = useState<string | null>(null);
  const brief = briefDraft ?? view.brief;
  const s = view.session;

  const carryIntoGeyser = async () => {
    await editBrief(brief);
    await finish();
    setOrientationBrief(brief);
    setStage("conception");
  };

  // The choose-phase options ("write my brief", …) are ACTIONS, not chat. If we
  // sent them to the Helper as messages it would just reply "choose what you want"
  // forever. Route "write my brief" to the real build; everything else continues
  // the conversation.
  const handleSend = (text: string) => {
    const t = text.trim().toLowerCase();
    if (t.includes("write my brief") || t.includes("write the brief")) {
      void buildBrief();
      return;
    }
    void tell(text);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className={`mx-auto flex w-full flex-col gap-5 p-6 ${maxW}`}>
          <header className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-action">
                Getting started
              </div>
              <h2 className="mt-1 font-sans text-lg font-semibold text-ink">
                Find the real machine idea in your hands
              </h2>
            </div>
            {view.phase !== "empty" && (
              <button
                onClick={() => {
                  setBriefDraft(null);
                  void reset();
                }}
                className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-red-300"
              >
                ↺ Start over
              </button>
            )}
          </header>

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-300">
              {error}
            </div>
          )}

          {/* Entry: drop the raw idea. */}
          {view.phase === "empty" && (
            <div className="rounded-lg border border-border bg-panel p-5">
              <h3 className="font-sans text-base font-semibold text-ink">What&apos;s your idea?</h3>
              <p className="mt-1 font-sans text-sm text-ink-muted">
                Say it however it lives in your head — the problem, the product, whatever you&apos;ve
                got. If it&apos;s a business idea, we&apos;ll work out together the real machine
                mechanism inside it. If it&apos;s already technical, we go straight through.
              </p>
              <div className="mt-3">
                <HelperComposer
                  placeholder="Describe your idea in your own words…"
                  busy={busy}
                  onSend={ingest}
                />
              </div>
              <button
                onClick={() => setStage("conception")}
                className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-accent"
              >
                Skip — describe my invention directly →
              </button>
            </div>
          )}

          {/* Discovery progress rail — visible progression, never legal labels. */}
          {view.phase === "discovery" && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {PHASE_LABELS.map((p, i) => {
                const done = phaseDone(s, p.key);
                const current = view.discoveryPhase === p.key;
                return (
                  <span key={p.key} className="flex items-center gap-2">
                    <span
                      className={`font-mono text-[10px] uppercase tracking-[0.1em] ${
                        done ? "text-accent" : current ? "text-ink" : "text-ink-muted/50"
                      }`}
                    >
                      {done ? "✓ " : ""}
                      {p.label}
                    </span>
                    {i < PHASE_LABELS.length - 1 && <span className="text-ink-muted/30">·</span>}
                  </span>
                );
              })}
            </div>
          )}

          {/* Conversation. */}
          {view.phase !== "empty" && (
            <>
              <HelperThread
                turns={view.conversation}
                onQuickReply={handleSend}
                busy={busy}
                primaryOption={view.canWriteBrief ? "write my brief" : undefined}
              />

              {working && view.conversation[view.conversation.length - 1]?.role === "inventor" && (
                <div className="flex items-center gap-3 rounded-md border border-accent/30 bg-accent/5 p-3">
                  <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  <span className="font-mono text-xs text-ink-muted">Thinking…</span>
                </div>
              )}

              {/* THE DISCOVERY CANVAS — what you've built so far, with provenance. */}
              {view.phase === "discovery" && <DiscoveryCanvas s={s} mechanism={view.mechanism} />}

              {/* Forward path only: the idea already has a mechanism and there is no
                  choose-phase option, so a button is the way to build the brief. On
                  the DISCOVERY path the "write my brief" choice in the thread above
                  does this — no redundant bottom button. */}
              {view.phase === "forward" && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-accent/30 bg-accent/[0.06] p-3">
                  <span className="font-sans text-[13px] text-ink">
                    Your idea&apos;s ready — I&apos;ll write it up as a detailed brief you can edit.
                  </span>
                  <Button variant="primary" onClick={() => void buildBrief()} disabled={busy}>
                    {busy ? "…" : "Write my brief →"}
                  </Button>
                </div>
              )}

              {/* Brief editor. */}
              {view.phase === "brief_ready" && (
                <div className="rounded-lg border border-accent/40 bg-accent/10 p-4">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-accent">
                    Your detailed brief · edit anything, then carry it in
                  </div>
                  <p className="mb-2 font-sans text-xs text-ink-muted">
                    Built from your own words. Fix or add anything — you&apos;ll review it again as
                    your invention description in the next step.
                  </p>
                  <VoiceTextarea
                    value={brief}
                    onChange={setBriefDraft}
                    rows={14}
                    className="w-full resize-y rounded-md border border-border bg-bg p-3 font-sans text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none"
                  />
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <button
                      onClick={() => void buildBrief()}
                      disabled={busy}
                      className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:text-accent disabled:opacity-50"
                    >
                      ↻ Rebuild from our conversation
                    </button>
                    <Button
                      variant="primary"
                      onClick={() => void carryIntoGeyser()}
                      disabled={busy || !brief.trim()}
                    >
                      Take this into Patent Geyser →
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {view.phase !== "empty" && (
        <div className="border-t border-border bg-panel p-4">
          <div className={`mx-auto w-full ${maxW}`}>
            <HelperComposer
              placeholder="Tell the Helper more, or answer its question…"
              busy={busy}
              onSend={handleSend}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** The structured discovery so far — every artifact the inventor has surfaced,
 *  provenance-tagged (yours vs suggested), with the conflict shown two-sided and
 *  the open gaps listed. This is the "you can always see what's discovered" view. */
function DiscoveryCanvas({ s, mechanism }: { s: OrientationSession; mechanism: string }) {
  const has =
    s.commercialObjective ||
    s.machineLimitations.length ||
    s.requirementConflicts.length ||
    s.approvedMechanism.length ||
    mechanism;
  if (!has) return null;

  return (
    <div className="rounded-lg border border-accent/40 bg-accent/[0.05] p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.15em] text-accent">
        What you&apos;ve discovered so far
      </div>

      {s.machineLimitations.length > 0 && (
        <Section title="The machine limitation">
          {s.machineLimitations.map((c) => (
            <ClauseLine key={c.id} c={c} />
          ))}
        </Section>
      )}

      {s.requirementConflicts.length > 0 && (
        <Section title="The requirement conflict">
          {s.requirementConflicts.map((c) => (
            <div key={c.id} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-border bg-bg/60 p-2.5">
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
                  The system must…
                </div>
                <p className="mt-0.5 font-sans text-[13px] text-ink">{c.sideA}</p>
              </div>
              <div className="rounded-md border border-border bg-bg/60 p-2.5">
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
                  …but it must also
                </div>
                <p className="mt-0.5 font-sans text-[13px] text-ink">{c.sideB}</p>
              </div>
            </div>
          ))}
        </Section>
      )}

      {s.approvedMechanism.length > 0 ? (
        <Section title="Your mechanism">
          {s.approvedMechanism.map((c) => (
            <ClauseLine key={c.id} c={c} />
          ))}
        </Section>
      ) : mechanism ? (
        <Section title="Your mechanism (so far)">
          <p className="font-sans text-[13px] leading-relaxed text-ink">{mechanism}</p>
        </Section>
      ) : null}

      {s.technicalEffects.length > 0 && (
        <Section title="The technical effect">
          {s.technicalEffects.map((c) => (
            <ClauseLine key={c.id} c={c} />
          ))}
        </Section>
      )}

      {s.humanPerformanceFindings.length > 0 && (
        <Section title="The machine-dependent part">
          {s.humanPerformanceFindings.map((c) => (
            <ClauseLine key={c.id} c={c} />
          ))}
        </Section>
      )}

      {s.unresolvedGaps.length > 0 && (
        <Section title="Still open">
          <ul className="space-y-0.5">
            {s.unresolvedGaps.map((c) => (
              <li key={c.id} className="font-sans text-[12px] text-ink-muted">
                • {c.text}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
        {title}
      </div>
      {children}
    </div>
  );
}

function ClauseLine({ c }: { c: Clause }) {
  return (
    <p className="flex items-start justify-between gap-2 font-sans text-[13px] leading-relaxed text-ink">
      <span>{c.text}</span>
      <span className="mt-1 shrink-0">{originBadge(c.origin)}</span>
    </p>
  );
}
