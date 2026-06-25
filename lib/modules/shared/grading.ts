/**
 * The grading gate — the one place a module ACTS on a cross-agent verdict.
 *
 * Every module records its artifacts to the Shared Consciousness with a few
 * concrete `reasons` (anchored to the inventor's words), then has a DIFFERENT
 * agent grade the artifact for consistency against those reasons + the inventor's
 * material. The grade was already being computed in each module — but a "fail"
 * was silently dropped (the entry stayed an unsettled draft and the flow moved on,
 * which is exactly how an assessment could later contradict itself).
 *
 * `applyGrade` closes that loop in ONE shared seam so every module boundary acts
 * on the verdict identically:
 *  - PASS  → settles the entry (cross-verified fact; nothing later can silently
 *            contradict it), via the existing `SharedConsciousness.verify`.
 *  - FAIL  → leaves the entry a draft AND makes the failure durable + visible: a
 *            `decision` entry tagged `grade:fail` in the consciousness and a
 *            `grade_failed` event in the ledger. The caller surfaces the returned
 *            `Grade` to the inventor rather than burying it.
 *
 * Pure — no server-only, no model. Client-safe (the resolved `Grade` travels to
 * the UI), like the Ledger and the Consciousness it coordinates.
 */

import type { EvidenceLedger } from "./ledger";
import type { ConsciousnessEntry, SharedConsciousness } from "./consciousness";

/** A resolved grade, carried forward to the module view and the UI. */
export type Grade = {
  verdict: "pass" | "fail";
  /** The grader's one-line note — the source of truth shown to the inventor. */
  note?: string;
  /** The reasons the piece was checked against (the anti-drift commitments). */
  reasons: string[];
  /** 1-based indices into `reasons` the piece contradicted (fail only). */
  violatedReasons?: number[];
};

/** The raw verdict a module's verifier returns, before it is resolved into a `Grade`. */
export type GradeResult = {
  verdict: "pass" | "fail";
  note?: string;
  /** 1-based indices (matching the numbered reasons shown to the verifier). */
  violatedReasons?: number[];
};

/**
 * Apply a cross-agent verdict to a freshly-recorded consciousness entry, acting
 * on a "fail" instead of dropping it. `by` MUST differ from the entry's creating
 * agent (the consciousness enforces this). Returns the resolved `Grade` for the
 * caller to attach to its view.
 */
export function applyGrade(
  consciousness: SharedConsciousness,
  ledger: EvidenceLedger,
  entry: ConsciousnessEntry,
  result: GradeResult,
  opts: { by: string; tags?: string[] },
): Grade {
  const reasons = entry.reasons ? [...entry.reasons] : [];
  const tags = opts.tags ?? [];

  consciousness.verify(entry.id, {
    by: opts.by,
    verdict: result.verdict,
    ...(result.note ? { note: result.note } : {}),
  });

  if (result.verdict === "fail") {
    // Make the failure durable and inspectable — not a silently-unsettled draft.
    consciousness.record({
      part: entry.part,
      kind: "decision",
      content:
        result.note?.trim() ||
        "The graded piece drifted from its recorded reasons and needs inventor review.",
      why: "grading gate failed — surfaced for inventor review",
      agent: opts.by,
      derivedFrom: [entry.id],
      tags: [...tags, "grade:fail"],
    });
    ledger.recordMachineEvent("grade_failed", [...tags, "grade"], {
      part: entry.part,
      entryId: entry.id,
      note: result.note ?? "",
      violatedReasons: result.violatedReasons ?? [],
    });
  }

  return {
    verdict: result.verdict,
    ...(result.note ? { note: result.note } : {}),
    reasons,
    ...(result.violatedReasons?.length
      ? { violatedReasons: [...result.violatedReasons] }
      : {}),
  };
}
