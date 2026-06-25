/**
 * The Shared Consciousness — the living memory of the DRAFT.
 *
 * This is the second of the two shared layers every agent reads from (the other
 * is the static Backpack of patent-writing knowledge). Where the Backpack says
 * HOW to write a patent, the Shared Consciousness says WHAT has already been
 * decided for THIS patent and WHY — readable by every agent so no two contradict
 * each other.
 *
 * It is DISTINCT from the EvidenceLedger: the Ledger is the inventor's notebook
 * (what the human said, verbatim, sealed — the proof of human conception). The
 * Shared Consciousness is what the AGENTS built and the reasoning behind it.
 *
 * Invariants (these are what make it a consciousness, not just a log):
 *  1. Content-immutable. An entry's content/why/derivedFrom never change. To
 *     change a settled piece you APPEND a new entry that supersedes the old one
 *     — the old one is retained as history, never deleted or overwritten. This
 *     is why "once settled, nothing later can silently contradict it".
 *  2. Cross-verification gates "settled". A piece created by one agent only
 *     becomes settled (readable as fact, never to be contradicted) once a
 *     DIFFERENT agent verifies it. Self-verification is rejected.
 *  3. Downward propagation. Every entry records what it was built on
 *     (`derivedFrom`); when a piece is superseded, everything downstream of it
 *     is flagged stale (to be redone), so a changed novelty can't leave a stale
 *     abstract behind.
 *  4. The invention never leaks. `open_question` entries (a possible invention
 *     the AI detected but must NOT reveal) are visible to agents/the Helper for
 *     Socratic steering, but are excluded from the human-facing draft view.
 *
 * Pure logic — no model, no server-only imports (client-safe, like the Ledger).
 */

import { defaultGenId } from "./ledger";

/** What a Shared-Consciousness entry represents. */
export type ConsciousnessKind =
  /** A piece of the draft an agent produced (title, abstract, a concept, ...). */
  | "artifact"
  /** A decision/rationale recorded for the others to honor. */
  | "decision"
  /**
   * A possible invention the AI detected but must NEVER reveal to the human.
   * Held only to let the Helper steer the human Socratically toward it.
   */
  | "open_question";

/**
 * Lifecycle of a piece:
 *  - "draft":      created, not yet agreed by a second agent.
 *  - "settled":    cross-verified and agreed — readable as fact.
 *  - "superseded": replaced by a newer entry (kept as history).
 */
export type ConsciousnessStatus = "draft" | "settled" | "superseded";

export type Verification = {
  /** The agent that verified — MUST differ from the creator. */
  by: string;
  verdict: "pass" | "fail";
  note?: string;
  /** ISO-8601 timestamp. */
  at: string;
};

export type ConsciousnessEntry = {
  id: string;
  /** Stable key for the piece of the draft this concerns (e.g. "abstract", "concept:42"). */
  part: string;
  kind: ConsciousnessKind;
  /** The piece itself, or the question. Immutable once written. */
  content: string;
  /** Why it is the way it is. Immutable once written. */
  why: string;
  /**
   * A few concrete reasons (anchored to the inventor's words) this piece was made
   * the way it is. A downstream grade checks the new output for consistency
   * against EACH of these — recording them is what keeps the draft from drifting.
   * Immutable once written.
   */
  reasons?: string[];
  /** The agent that created it. */
  agent: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** Ids of the entries this was built on — the dependency edges. */
  derivedFrom: string[];
  /** Optional links to inventor's-notebook (Ledger) entries this traces to. */
  tracesTo?: string[];
  status: ConsciousnessStatus;
  /** When this entry replaced another, the id of the one it replaced. */
  supersedes?: string;
  /** When this entry was replaced, the id of its replacement. */
  supersededBy?: string;
  /** Flagged true when an upstream piece changed and this needs redoing. */
  stale?: boolean;
  /** The cross-verification verdict, once a second agent has reviewed it. */
  verification?: Verification;
  tags: string[];
};

export type RecordOptions = {
  part: string;
  content: string;
  agent: string;
  kind?: ConsciousnessKind;
  why?: string;
  reasons?: string[];
  derivedFrom?: string[];
  tracesTo?: string[];
  tags?: string[];
  /** Id of an existing entry this one replaces (triggers propagation). */
  supersedes?: string;
};

export type VerifyOptions = {
  /** The verifying agent — rejected if equal to the entry's creator. */
  by: string;
  verdict: "pass" | "fail";
  note?: string;
};

export class SharedConsciousness {
  private entries: ConsciousnessEntry[] = [];
  /** Ids already persisted (set at load). Used to compute the persist diff. */
  private baseline = new Set<string>();
  /** Baseline ids whose mutable fields changed since load (need an UPDATE). */
  private dirty = new Set<string>();

  constructor(
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly genId: () => string = defaultGenId,
  ) {}

  /** Flag a baseline entry as changed so persistence updates its row. */
  private touch(e: ConsciousnessEntry): void {
    if (this.baseline.has(e.id)) this.dirty.add(e.id);
  }

  /* ---- reads -------------------------------------------------------- */

  /** All entries, in append order. Returns a copy; the store stays immutable. */
  all(): ConsciousnessEntry[] {
    return [...this.entries];
  }

  get(id: string): ConsciousnessEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /** Entries that are still live (not superseded), in order. */
  active(): ConsciousnessEntry[] {
    return this.entries.filter((e) => e.status !== "superseded");
  }

  /** All entries concerning one part, in order (includes history). */
  forPart(part: string): ConsciousnessEntry[] {
    return this.entries.filter((e) => e.part === part);
  }

  /**
   * The current live piece for a part — the latest non-superseded ARTIFACT.
   * Open questions and decisions are not "the piece", so they are skipped.
   */
  current(part: string): ConsciousnessEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.part === part && e.kind === "artifact" && e.status !== "superseded") {
        return e;
      }
    }
    return undefined;
  }

  /** The hidden possible-inventions — for the Helper/agents only, never the human. */
  openQuestions(): ConsciousnessEntry[] {
    return this.active().filter((e) => e.kind === "open_question");
  }

  /** Entries flagged for redo because something upstream changed. */
  stale(): ConsciousnessEntry[] {
    return this.active().filter((e) => e.stale === true);
  }

  /** Direct dependents of an entry (entries built on it). */
  dependentsOf(id: string): ConsciousnessEntry[] {
    return this.entries.filter((e) => e.derivedFrom.includes(id));
  }

  /* ---- writes ------------------------------------------------------- */

  /**
   * Append a new piece (or open question, or decision). If `supersedes` is set,
   * the replaced entry is marked superseded and everything downstream of it is
   * flagged stale (downward propagation).
   */
  record(opts: RecordOptions): ConsciousnessEntry {
    if (!opts.content.trim()) {
      throw new Error("SharedConsciousness: entry content must be non-empty.");
    }

    const entry: ConsciousnessEntry = {
      id: this.genId(),
      part: opts.part,
      kind: opts.kind ?? "artifact",
      content: opts.content,
      why: opts.why ?? "",
      ...(opts.reasons?.length ? { reasons: [...opts.reasons] } : {}),
      agent: opts.agent,
      createdAt: this.now(),
      derivedFrom: opts.derivedFrom ? [...opts.derivedFrom] : [],
      ...(opts.tracesTo ? { tracesTo: [...opts.tracesTo] } : {}),
      status: "draft",
      tags: opts.tags ?? [],
    };

    if (opts.supersedes) {
      const old = this.get(opts.supersedes);
      if (!old) {
        throw new Error(
          `SharedConsciousness: cannot supersede unknown entry "${opts.supersedes}".`,
        );
      }
      old.status = "superseded";
      old.supersededBy = entry.id;
      entry.supersedes = old.id;
      this.touch(old);
    }

    this.entries.push(entry);

    // Propagate AFTER the new entry exists, so it is excluded from staleness.
    if (entry.supersedes) this.propagateStale(entry.supersedes, entry.id);

    return entry;
  }

  /**
   * Cross-verify an entry. The verifier MUST be a different agent than the
   * creator. A "pass" settles the entry (it becomes readable as agreed fact); a
   * "fail" leaves it a draft for the creator to supersede with a fix.
   */
  verify(id: string, opts: VerifyOptions): ConsciousnessEntry {
    const entry = this.get(id);
    if (!entry) throw new Error(`SharedConsciousness: unknown entry "${id}".`);
    if (entry.status === "superseded") {
      throw new Error(`SharedConsciousness: cannot verify a superseded entry.`);
    }
    if (opts.by === entry.agent) {
      throw new Error(
        `SharedConsciousness: cross-verification requires a DIFFERENT agent than the creator ("${entry.agent}").`,
      );
    }

    entry.verification = {
      by: opts.by,
      verdict: opts.verdict,
      ...(opts.note ? { note: opts.note } : {}),
      at: this.now(),
    };
    if (opts.verdict === "pass") {
      entry.status = "settled";
      entry.stale = false;
    }
    this.touch(entry);
    return entry;
  }

  /** Mark every live entry transitively downstream of `rootId` as stale. */
  private propagateStale(rootId: string, exclude: string): void {
    const queue = [rootId];
    const seen = new Set<string>([rootId, exclude]);
    while (queue.length) {
      const id = queue.shift() as string;
      for (const dep of this.dependentsOf(id)) {
        if (seen.has(dep.id) || dep.status === "superseded") continue;
        seen.add(dep.id);
        dep.stale = true;
        this.touch(dep);
        queue.push(dep.id);
      }
    }
  }

  /* ---- render (the two views) -------------------------------------- */

  /**
   * The view an AGENT gets before it creates its piece — everything live and
   * relevant, INCLUDING the hidden open questions it may steer toward. Optionally
   * scoped to one part. This is what gets injected into the agent's prompt.
   */
  renderForAgent(opts?: { part?: string }): string {
    const rows = (opts?.part ? this.forPart(opts.part) : this.active()).filter(
      (e) => e.status !== "superseded",
    );
    if (!rows.length) return "(nothing recorded yet for this patent)";
    return rows.map((e) => this.line(e, { forHuman: false })).join("\n");
  }

  /**
   * The view the HUMAN gets in the draft display — settled artifacts only. Never
   * includes open questions (the invention must not leak) or unsettled drafts.
   */
  renderForHuman(): string {
    const rows = this.active().filter(
      (e) => e.kind === "artifact" && e.status === "settled",
    );
    if (!rows.length) return "";
    return rows.map((e) => this.line(e, { forHuman: true })).join("\n");
  }

  private line(e: ConsciousnessEntry, o: { forHuman: boolean }): string {
    if (o.forHuman) return `## ${e.part}\n${e.content}`;
    const flags = [
      e.kind !== "artifact" ? e.kind.toUpperCase() : null,
      e.status,
      e.stale ? "STALE—needs redo" : null,
    ]
      .filter(Boolean)
      .join(", ");
    const why = e.why ? `\n  why: ${e.why}` : "";
    const reasons = e.reasons?.length
      ? `\n  reasons (stay consistent with each):${e.reasons
          .map((r, i) => `\n    ${i + 1}. ${r}`)
          .join("")}`
      : "";
    return `[${e.part}] (${flags}) by ${e.agent}\n  ${e.content}${why}${reasons}`;
  }

  /* ---- persistence -------------------------------------------------- */

  /** Serialize for persistence (a flat, ordered array — like the Ledger). */
  serialize(): ConsciousnessEntry[] {
    return this.all();
  }

  /**
   * Entries created since load — they must be INSERTed. Concurrent appends from
   * different requests are distinct inserts, so they never clobber each other.
   */
  pendingInserts(): ConsciousnessEntry[] {
    return this.entries.filter((e) => !this.baseline.has(e.id));
  }

  /** Already-persisted entries whose status/flags changed — UPDATE by id. */
  dirtyUpdates(): ConsciousnessEntry[] {
    return this.entries.filter(
      (e) => this.baseline.has(e.id) && this.dirty.has(e.id),
    );
  }

  /** Call after a successful persist: the current state becomes the new baseline. */
  markPersisted(): void {
    for (const e of this.entries) this.baseline.add(e.id);
    this.dirty.clear();
  }

  /** Rehydrate from persisted entries (preserves order and ids). */
  static fromEntries(
    entries: ConsciousnessEntry[],
    now?: () => string,
    genId?: () => string,
  ): SharedConsciousness {
    const sc = new SharedConsciousness(now, genId);
    sc.entries = [...entries];
    sc.baseline = new Set(entries.map((e) => e.id));
    return sc;
  }
}
