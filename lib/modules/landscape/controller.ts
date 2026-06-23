import "server-only";
import { EvidenceLedger } from "@/lib/modules/shared";
import { hasCheckpoint, sealCheckpoint } from "@/lib/modules/shared/checkpoint";
import type { ConceptObject } from "@/lib/modules/shared";
import { LANDSCAPE_HUMAN_SOURCE_TYPES } from "./types";
import type {
  LandscapeDeps,
  LandscapeIdea,
  LandscapeSource,
  Module3Phase,
  Module3View,
  PriorArtSearch,
} from "./types";

/**
 * Module 3 — the Landscape flow engine.
 *
 * Mostly the tool working: it takes each carried-forward idea, searches real
 * patent databases + scientific publications (via the injected `search` seam —
 * an n8n webhook in practice), and returns the closest existing art grouped by
 * idea with a closeness score. Nothing inventive happens; it gathers facts.
 *
 * The Helper drives it: `start()` runs the searches, render `view().ideas`, then
 * `finish()` to hand the landscape to Differentiation.
 */

export type LandscapeSnapshot = {
  phase: Module3Phase;
  started: boolean;
  context: string;
  ideas: LandscapeIdea[];
  ledger: import("@/lib/modules/shared").LedgerEntry[];
};

export class LandscapeModule {
  private readonly search: PriorArtSearch;
  private readonly now: () => string;
  private readonly genId: () => string;
  private readonly ledger: EvidenceLedger;

  private phase: Module3Phase = "idle";
  private started = false;
  private context = "";
  private ideas: LandscapeIdea[] = [];

  constructor(deps: LandscapeDeps) {
    this.search = deps.search;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.genId = deps.genId ?? defaultGenId;
    this.ledger =
      deps.ledger ??
      new EvidenceLedger(LANDSCAPE_HUMAN_SOURCE_TYPES, this.now, this.genId);
    this.context = deps.context;
    this.ideas = deps.concepts
      .filter((c) => c.status.state === "active")
      .map((c) => ({
        conceptId: c.id,
        title: c.title,
        statement: c.formalized_statement,
        sources: [],
        status: "pending" as const,
        territory: "open" as const,
      }));
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  /** Search every idea against existing art. Each idea fails independently. */
  async start(): Promise<Module3View> {
    if (this.started) return this.view();
    this.started = true;
    this.phase = "searching";
    this.ledger.recordMachineEvent("landscape_started", ["module3"], {
      ideaCount: this.ideas.length,
    });

    await this.runSearch(this.ideas);

    this.phase = "ready";
    this.ledger.recordMachineEvent("module_completed", ["module3"], {
      ideaCount: this.ideas.length,
    });
    this.maybeCheckpoint();
    return this.view();
  }

  /** Re-run the search for a single idea. */
  async research(conceptId: string): Promise<Module3View> {
    const idea = this.ideas.find((i) => i.conceptId === conceptId);
    if (idea) await this.runSearch([idea]);
    this.maybeCheckpoint();
    return this.view();
  }

  /** Seal a Checkpoint to the Ledger once the whole landscape is gathered. */
  private maybeCheckpoint(): void {
    if (this.view().complete && !hasCheckpoint(this.ledger, "module3")) {
      sealCheckpoint(this.ledger, "module3");
    }
  }

  /** The inventor types to the Helper — captured as a verbatim note. */
  async tell(text: string): Promise<Module3View> {
    const t = text.trim();
    if (t) this.ledger.recordInventorSource("inventor_note", t, ["landscape", "note"]);
    return this.view();
  }

  view(): Module3View {
    return {
      phase: this.phase,
      ideas: this.ideas.map(cloneIdea),
      ledger: this.ledger.serialize(),
      complete: this.ideas.length > 0 && this.ideas.every((i) => i.status === "done"),
    };
  }

  /** The deliverable: each idea paired with its closest existing art. */
  finish(): LandscapeIdea[] {
    return this.ideas.map(cloneIdea);
  }

  ledgerEntries() {
    return this.ledger.serialize();
  }

  /* ------------------------------------------------------------------ *
   * Persistence
   * ------------------------------------------------------------------ */

  toSnapshot(): LandscapeSnapshot {
    return {
      phase: this.phase,
      started: this.started,
      context: this.context,
      ideas: this.ideas.map(cloneIdea),
      ledger: this.ledger.serialize(),
    };
  }

  static fromSnapshot(snap: LandscapeSnapshot, deps: LandscapeDeps): LandscapeModule {
    const now = deps.now ?? (() => new Date().toISOString());
    const genId = deps.genId ?? defaultGenId;
    const ledger = EvidenceLedger.fromEntries(
      snap.ledger,
      LANDSCAPE_HUMAN_SOURCE_TYPES,
      now,
      genId,
    );
    const m = new LandscapeModule({ ...deps, concepts: [], context: snap.context, ledger });
    m.phase = snap.phase;
    m.started = snap.started;
    m.context = snap.context;
    m.ideas = snap.ideas.map(cloneIdea);
    return m;
  }

  /* ------------------------------------------------------------------ *
   * Internals
   * ------------------------------------------------------------------ */

  /**
   * Search the given ideas in ONE batch (the workflow is multi-concept), then
   * distribute the results back to each idea by id. The whole batch fails or
   * succeeds together; on failure every idea in the batch is marked errored.
   */
  private async runSearch(ideas: LandscapeIdea[]): Promise<void> {
    if (!ideas.length) return;
    for (const idea of ideas) {
      idea.status = "searching";
      idea.error = undefined;
    }
    try {
      const byId = await this.search({
        concepts: ideas.map((i) => ({ id: i.conceptId, concept: i.statement })),
        category: "Software",
      });
      for (const idea of ideas) {
        const sources = byId[idea.conceptId] ?? [];
        // Closest first when a closeness score is available.
        idea.sources = [...sources].sort(
          (a, b) => (b.closeness ?? 0) - (a.closeness ?? 0),
        );
        idea.territory = readTerritory(idea.sources);
        idea.status = "done";
        this.ledger.recordMachineEvent("search_run", ["landscape"], {
          conceptId: idea.conceptId,
          results: idea.sources.length,
        });
      }
    } catch (err) {
      console.error("[landscape] batch search failed", err);
      for (const idea of ideas) {
        idea.status = "error";
        idea.error =
          "The search couldn't run. Check the search service and try again.";
      }
      this.ledger.recordMachineEvent("search_error", ["landscape"], {
        error: String(err),
      });
    }
  }
}

function cloneIdea(i: LandscapeIdea): LandscapeIdea {
  return { ...i, sources: i.sources.map((s) => ({ ...s })) };
}

/** Read crowded/open from how close the existing art sits to the idea. */
function readTerritory(sources: LandscapeSource[]): "crowded" | "moderate" | "open" {
  if (sources.length === 0) return "open";
  const top = Math.max(...sources.map((s) => s.closeness ?? 0));
  const strong = sources.filter((s) => (s.closeness ?? 0) >= 0.7).length;
  if (top >= 0.7 || strong >= 2) return "crowded";
  if (top >= 0.4) return "moderate";
  return "open";
}

function defaultGenId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `l_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}
