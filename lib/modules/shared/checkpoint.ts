import "server-only";
import { createHash } from "node:crypto";
import type { EvidenceLedger, LedgerEntry } from "./ledger";

/**
 * Seal a Checkpoint into the Ledger at a module's Finalize: a `checkpoint` entry
 * whose meta carries a SHA-256 hash over the full ledger so far, CHAINED to the
 * previous checkpoint's hash, and timestamped (the entry's own timestamp). This
 * fixes the finalized state on the record so it can't be silently altered later.
 *
 * server-only (uses node:crypto). The shared ledger class stays pure; only this
 * sealing helper is node-bound, and only server-side engines call it.
 */
export function sealCheckpoint(ledger: EvidenceLedger, module: string): LedgerEntry {
  const entries = ledger.all();
  const prevHash =
    [...entries].reverse().find((e) => e.type === "checkpoint")?.meta?.hash;
  const prev = typeof prevHash === "string" ? prevHash : "genesis";

  // Canonical content over the entries that exist BEFORE this checkpoint.
  const payload = JSON.stringify(
    entries.map((e) => ({
      id: e.id,
      type: e.type,
      verbatim_text: e.verbatim_text ?? null,
      timestamp: e.timestamp,
      origin: e.origin,
      tags: e.tags,
      meta: e.meta ?? null,
    })),
  );
  const hash = createHash("sha256").update(`${prev}\n${payload}`).digest("hex");

  return ledger.recordMachineEvent("checkpoint", [module, "checkpoint"], {
    hash,
    prevHash: prev,
    entryCount: entries.length,
  });
}

/** Has a checkpoint already been sealed for this module? */
export function hasCheckpoint(ledger: EvidenceLedger, module: string): boolean {
  return ledger
    .all()
    .some((e) => e.type === "checkpoint" && e.tags.includes(module));
}
