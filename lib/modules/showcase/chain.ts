/**
 * The Chain primitive — Module 5 rebuild, R1 ("no machine output is single-pass").
 *
 * Every AI artifact passes a chain before it is persisted or shown:
 *   Produce → Verify (fresh context, second model, fixed rubric) → Repair once →
 *   mechanical fallback.
 *
 * A verify FINDING must quote the exact text it flags AND cite its rule (a rubric
 * check id, or an MPEP section for patent-substance judgments). A finding missing
 * either is discarded here, before it can gate anything. Every chain writes a
 * receipt (pass or repair) via `onReceipt`.
 *
 * Pure: no server-only imports, no ledger dependency — the caller supplies the
 * receipt sink so the primitive stays reusable and testable.
 */

/** One verify finding. Discarded unless it carries BOTH a quote and a citation. */
export type Finding = {
  /** The exact text flagged, quoted verbatim from the artifact. */
  quote: string;
  /** The rule id: a rubric check id (deterministic) or an MPEP section (substance). */
  citation: string;
  /** Which rule fired, in words. */
  rule: string;
  /** Optional human-readable detail. */
  detail?: string;
};

export type VerifyResult = {
  pass: boolean;
  findings: Finding[];
};

export type ChainOutcome =
  | "verified_clean" // produced artifact passed verify with no valid findings
  | "repaired" // repair produced an artifact that then passed verify
  | "fell_back"; // repair/verify still failed; mechanical fallback used

/** A receipt for the quality ledger. `id`/`at` are stamped by the sink. */
export type Receipt = {
  chain: string;
  outcome: ChainOutcome;
  /** The valid findings that drove the outcome (already quote+citation filtered). */
  findings: Finding[];
};

export type ChainResult<T> = {
  value: T;
  outcome: ChainOutcome;
  /** Findings still standing after the chain resolved (empty unless fell_back). */
  findings: Finding[];
};

/** A finding is only allowed to gate anything if it quotes text AND cites a rule. */
export function validFindings(findings: Finding[] | undefined): Finding[] {
  return (findings ?? []).filter(
    (f) => f?.quote?.trim().length > 0 && f?.citation?.trim().length > 0,
  );
}

export type ChainSpec<T> = {
  /** Chain name (for the receipt). */
  name: string;
  /** Step 1 — produce the artifact (a model call or a deterministic build). */
  produce: () => Promise<T>;
  /** Step 2 — verify in a fresh context on the second model, against the rubric. */
  verify: (candidate: T) => Promise<VerifyResult>;
  /** Step 3 — repair ONCE from the valid findings (optional). */
  repair?: (candidate: T, findings: Finding[]) => Promise<T>;
  /** Step 4 — mechanical fallback when repair/verify still fails (optional). */
  fallback?: (candidate: T, findings: Finding[]) => T;
  /** Receipt sink — called exactly once per chain run. */
  onReceipt: (receipt: Receipt) => void;
};

/**
 * Run one chain. Always writes exactly one receipt. Returns the resolved artifact,
 * its outcome, and any findings still standing (non-empty only when it fell back).
 */
export async function runChain<T>(spec: ChainSpec<T>): Promise<ChainResult<T>> {
  const produced = await spec.produce();
  const v1 = validFindings((await spec.verify(produced)).findings);
  if (v1.length === 0) {
    spec.onReceipt({ chain: spec.name, outcome: "verified_clean", findings: [] });
    return { value: produced, outcome: "verified_clean", findings: [] };
  }

  // Repair once, then re-verify.
  if (spec.repair) {
    const repaired = await spec.repair(produced, v1);
    const v2 = validFindings((await spec.verify(repaired)).findings);
    if (v2.length === 0) {
      spec.onReceipt({ chain: spec.name, outcome: "repaired", findings: v1 });
      return { value: repaired, outcome: "repaired", findings: [] };
    }
    const value = spec.fallback ? spec.fallback(repaired, v2) : repaired;
    spec.onReceipt({ chain: spec.name, outcome: "fell_back", findings: v2 });
    return { value, outcome: "fell_back", findings: v2 };
  }

  // No repair step — fall back directly from the first verify.
  const value = spec.fallback ? spec.fallback(produced, v1) : produced;
  spec.onReceipt({ chain: spec.name, outcome: "fell_back", findings: v1 });
  return { value, outcome: "fell_back", findings: v1 };
}
