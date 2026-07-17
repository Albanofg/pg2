/**
 * Module 3 — Landscape. Type contracts.
 *
 * Pure (no server-only imports). Takes the carried-forward ideas (the concepts)
 * and checks each against existing patents + scientific publications, returning
 * results grouped by idea with a closeness score. Nothing inventive happens —
 * this stage gathers facts.
 */

import type {
  AgentRunner,
  ConceptObject,
  EvidenceLedger,
  HelperTurn,
  LedgerEntry,
} from "@/lib/modules/shared";

export type { ConceptObject, LedgerEntry, HelperTurn } from "@/lib/modules/shared";

/* ------------------------------------------------------------------ *
 * Prior-art results
 * ------------------------------------------------------------------ */

export type SourceKind = "patent" | "paper" | "other";

/** One piece of existing art found close to an idea. */
export type LandscapeSource = {
  kind: SourceKind;
  title: string;
  /** Patent number, DOI, arXiv id, etc. */
  identifier?: string;
  /** Filing / priority date when the provider supplies one (shown on the card). */
  filingDate?: string;
  url?: string;
  /** Abstract / summary snippet. */
  snippet?: string;
  /** How close to the idea, 0..1 (1 = very similar). */
  closeness?: number;
};

export type IdeaSearchStatus = "pending" | "searching" | "done" | "error";

/** A plain reading of how busy the existing art is around an idea. */
export type Territory = "crowded" | "moderate" | "open";

/** One carried-forward idea, paired with its closest existing art. */
export type LandscapeIdea = {
  conceptId: string;
  title: string;
  statement: string;
  sources: LandscapeSource[];
  status: IdeaSearchStatus;
  /** Crowded vs open — derived from the closeness of the existing art. */
  territory: Territory;
  error?: string;
};

/* ------------------------------------------------------------------ *
 * The prior-art search seam (the Helper fills this — e.g. an n8n webhook)
 * ------------------------------------------------------------------ */

/** One concept to search — `concept` is the text the search runs on. */
export type PriorArtConcept = { id: string; concept: string };

export type PriorArtSearchInput = {
  /** All concepts searched in ONE batch (the workflow is multi-concept). */
  concepts: PriorArtConcept[];
  /** Optional tracking id for the search service. */
  sessionId?: string;
  /** Domain hint for the search (defaults to "Software"). */
  category?: string;
  /** Max results per concept. */
  limit?: number;
};

/**
 * Searches real patent databases + scientific publications for art close to the
 * given concepts, in ONE batch, returning matches keyed by concept id. Module 3
 * owns nothing about HOW the search runs — the Helper provides this (the
 * reference implementation posts to an n8n webhook). It must return REAL
 * records, never invented ones.
 */
export type PriorArtSearch = (
  input: PriorArtSearchInput,
) => Promise<Record<string, LandscapeSource[]>>;

/* ------------------------------------------------------------------ *
 * Ledger vocabulary
 * ------------------------------------------------------------------ */

export type LedgerEntryType =
  | "inventor_note" // a free-text note typed into the Helper composer
  | "landscape_started"
  | "search_run"
  | "search_error"
  | "module_completed";

export const LANDSCAPE_HUMAN_SOURCE_TYPES: ReadonlySet<string> =
  new Set<LedgerEntryType>(["inventor_note"]);

/* ------------------------------------------------------------------ *
 * View + deps
 * ------------------------------------------------------------------ */

export type Module3Phase = "idle" | "searching" | "ready";

export type Module3View = {
  phase: Module3Phase;
  /** Each carried-forward idea with its closest existing art. */
  ideas: LandscapeIdea[];
  /** The Helper conversation — its replies/teaching and the inventor's messages. */
  conversation: HelperTurn[];
  ledger: LedgerEntry[];
  /** True once every idea has been searched. */
  complete: boolean;
};

export type LandscapeDeps = {
  /** The carried-forward ideas (concepts) to search. */
  concepts: ConceptObject[];
  /** The whole-invention expanded description, used to ground each search. */
  context: string;
  /** The prior-art search implementation (Helper-provided). */
  search: PriorArtSearch;
  /** The agent transport for the user-facing Helper (Helper-provided). */
  runAgent?: AgentRunner;
  /** Optional shared ledger to thread the proof trail across modules. */
  ledger?: EvidenceLedger;
  now?: () => string;
  genId?: () => string;
};
