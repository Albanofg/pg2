/**
 * The Evidence Ledger — the cross-module proof trail.
 *
 * Append-only, ordered record of every meaningful event in a session. It is the
 * backbone of the product's real deliverable: a verbatim trail of the inventor's
 * own words, timestamped, that lets us prove later who conceived what. The same
 * ledger can be threaded through every module so the trail is continuous.
 *
 * Invariants:
 *  1. Inventor inputs are recorded VERBATIM and BEFORE any AI step touches them.
 *  2. The log is append-only — a correction is a new entry, never a mutation.
 *
 * Entry-type vocabularies are module-specific, so the ledger stores `type` as a
 * string and is told at construction which types are inventor-sourced (and thus
 * must carry verbatim text). Each module defines its own type union + the set of
 * human-source types it passes in.
 *
 * Pure logic — no model, no server-only imports.
 */

export type Origin = "human" | "machine";

export type LedgerEntry = {
  id: string;
  /** Module-specific event type (stored as a string). */
  type: string;
  /** Present (exact, unedited) whenever the inventor is the source. */
  verbatim_text?: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  origin: Origin;
  tags: string[];
  /** Structured payload for machine events and cross-linking. */
  meta?: Record<string, unknown>;
};

export type AppendOptions = {
  type: string;
  /** Required when `type` is a human-source type; stored exactly as given. */
  verbatim_text?: string;
  origin: Origin;
  tags?: string[];
  meta?: Record<string, unknown>;
};

export class EvidenceLedger {
  private entries: LedgerEntry[] = [];

  /**
   * @param humanSourceTypes  entry types where the inventor is the source and
   *   verbatim text is required. To thread one ledger through several modules,
   *   pass the union of every module's human-source types.
   */
  constructor(
    private readonly humanSourceTypes: ReadonlySet<string>,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly genId: () => string = defaultGenId,
  ) {}

  /** All entries, in append order. Returns a copy; the log stays immutable. */
  all(): LedgerEntry[] {
    return [...this.entries];
  }

  /** Just the verbatim inventor inputs, in order — the conception-trail source. */
  humanVerbatim(): LedgerEntry[] {
    return this.entries.filter(
      (e) =>
        this.humanSourceTypes.has(e.type) &&
        typeof e.verbatim_text === "string",
    );
  }

  /** Look up an entry by id. */
  get(id: string): LedgerEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /** Is this type one where the inventor is the source (verbatim required)? */
  isHumanSourceType(type: string): boolean {
    return this.humanSourceTypes.has(type);
  }

  /**
   * Append an entry. Enforces that human-source events carry verbatim text and
   * originate from the human.
   */
  append(opts: AppendOptions): LedgerEntry {
    const isHumanSource = this.humanSourceTypes.has(opts.type);

    if (isHumanSource) {
      if (
        typeof opts.verbatim_text !== "string" ||
        opts.verbatim_text.length === 0
      ) {
        throw new Error(
          `Ledger: entry type "${opts.type}" is inventor-sourced and requires non-empty verbatim_text.`,
        );
      }
      if (opts.origin !== "human") {
        throw new Error(
          `Ledger: entry type "${opts.type}" must have origin "human".`,
        );
      }
    }

    const entry: LedgerEntry = {
      id: this.genId(),
      type: opts.type,
      timestamp: this.now(),
      origin: opts.origin,
      tags: opts.tags ?? [],
      ...(opts.verbatim_text !== undefined
        ? { verbatim_text: opts.verbatim_text }
        : {}),
      ...(opts.meta !== undefined ? { meta: opts.meta } : {}),
    };
    this.entries.push(entry);
    return entry;
  }

  /**
   * Record an inventor input verbatim. Call this FIRST, before any AI step
   * processes the input. Throws if `type` is not a registered human-source type.
   */
  recordInventorSource(
    type: string,
    verbatim_text: string,
    tags: string[] = [],
    meta?: Record<string, unknown>,
  ): LedgerEntry {
    if (!this.humanSourceTypes.has(type)) {
      throw new Error(
        `Ledger: "${type}" is not a registered human-source type; cannot record as inventor verbatim.`,
      );
    }
    return this.append({ type, verbatim_text, origin: "human", tags, meta });
  }

  /** Record an explicit inventor decision (origin human, no new substance). */
  recordDecision(
    type: string,
    tags: string[] = [],
    meta?: Record<string, unknown>,
  ): LedgerEntry {
    return this.append({ type, origin: "human", tags, meta });
  }

  /** Record a machine (AI/tool) event. Never carries inventor verbatim. */
  recordMachineEvent(
    type: string,
    tags: string[] = [],
    meta?: Record<string, unknown>,
  ): LedgerEntry {
    return this.append({ type, origin: "machine", tags, meta });
  }

  /** Serialize for persistence by the Helper. */
  serialize(): LedgerEntry[] {
    return this.all();
  }

  /** Rehydrate a ledger from persisted entries (preserves order and ids). */
  static fromEntries(
    entries: LedgerEntry[],
    humanSourceTypes: ReadonlySet<string>,
    now?: () => string,
    genId?: () => string,
  ): EvidenceLedger {
    const ledger = new EvidenceLedger(humanSourceTypes, now, genId);
    ledger.entries = [...entries];
    return ledger;
  }
}

export function defaultGenId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `e_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}
