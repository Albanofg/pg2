/**
 * Module 4 — Differentiation. Type contracts.
 *
 * The product's heavy moment and its real output. Input: each carried Concept
 * paired with its prior-art landscape (from Module 3). Per Concept the flow is:
 * frame the gap (factual) → the inventor states what is genuinely NEW against the
 * art, in their own words (verbatim, the second conception moment) → formalize +
 * confirm → select which differentiated Concepts anchor the disclosure (the Key
 * Concepts) → compile the nine-section Invention Disclosure → certify inventorship
 * (Proof of Human Conception factors).
 *
 * This file covers Slice A (frame → capture → formalize → anchor). The disclosure
 * compilation and PoHC certification types are added in later slices.
 *
 * Pure (no server-only imports) so both the client UI and the server engine can
 * import it. Cross-module currency is re-exported from the shared layer.
 */

import type {
  AgentRunner,
  ConceptObject,
  EvidenceLedger,
  HelperTurn,
  LedgerEntry,
  SharedConsciousness,
} from "@/lib/modules/shared";

export { statusLabel } from "@/lib/modules/shared";
export type {
  Provenance,
  ConceptStatus,
  ConceptionTrailItem,
  ConceptProvenancePart,
  ConceptObject,
  Origin,
  HelperTurn,
  LedgerEntry,
  AppendOptions,
  AgentRunRequest,
  AgentRunner,
} from "@/lib/modules/shared";

/* ------------------------------------------------------------------ *
 * Input — a Concept plus its prior-art landscape (from Module 3)
 * ------------------------------------------------------------------ */

export type Territory = "crowded" | "moderate" | "open";

/** One piece of existing art the search found near a Concept. */
export type PriorArtRef = {
  title: string;
  identifier?: string;
  url?: string;
  snippet?: string;
  /** 0..1, higher = closer. */
  closeness?: number;
};

/** The prior-art landscape for one Concept, carried in from Module 3. */
export type ConceptLandscape = {
  conceptId: string;
  territory: Territory;
  sources: PriorArtRef[];
};

/* ------------------------------------------------------------------ *
 * The V1 whitespace analysis — prior-art mechanism surfacing + synthesis
 * ------------------------------------------------------------------ */

export type WhitespacePatentAnalysis = {
  patentNumber: string;
  patentTitle: string;
  patentStatus: "GRANTED" | "PENDING" | "UNKNOWN";
  /** Specific mechanisms drawn literally from the reference summary (no boilerplate). */
  extractedMechanisms: string[];
  /** Open questions asking the inventor how THEIR approach works (their own words). */
  inventorClarificationQuestions: string[];
};

export type WhitespaceMatchLevel = {
  level: "Green Match" | "Yellow Match" | "Red Match";
  directMatches: number;
  adjacentMatches: number;
  unrelatedReferences: number;
};

/** The full whitespace ("open landscape") analysis for one Key Concept. */
export type WhitespaceAnalysis = {
  totalPatentsAnalyzed: number;
  patentAnalyses: WhitespacePatentAnalysis[];
  crossPatentClarificationQuestions: string[];
  overallMatchLevel: WhitespaceMatchLevel;
  consolidatedOpenLandscapeAnalysis: string;
  primaryDistinguishingFeatures: string[];
  keyConceptDevelopmentGuidance: string;
};

/* ------------------------------------------------------------------ *
 * Module-4 ledger vocabulary
 * ------------------------------------------------------------------ */

export type LedgerEntryType =
  // Inventor as source — verbatim required:
  | "inventor_note" // free-text note in the composer
  | "novelty_statement" // the inventor's verbatim statement of what's new vs the art
  | "inventor_edit" // a correction to the differentiation text
  | "certification_answer" // verbatim answer to a Proof-of-Human-Conception factor
  // Inventor decisions:
  | "differentiation_action" // approve / discard / request_edit on the differentiation
  | "key_concept_action" // anchor / drop on a Key Concept
  // Machine events:
  | "differentiation_started"
  | "key_concept_decomposed" // a carried Concept was split into N distinct Key Concepts
  | "agent_whitespace" // V1 open-landscape / Match-Level analysis of a Key Concept vs its prior art
  | "agent_framed_gap"
  | "agent_formalized"
  | "agent_classified"
  | "key_concept_anchored"
  | "disclosure_compiled"
  | "inventorship_certified" // a signed Proof-of-Human-Conception certification
  | "module_completed";

/** The Module-4 entry types where the inventor is the source (verbatim required). */
export const DIFFERENTIATION_HUMAN_SOURCE_TYPES: ReadonlySet<string> =
  new Set<LedgerEntryType>([
    "inventor_note",
    "novelty_statement",
    "inventor_edit",
    "certification_answer",
  ]);

/* ------------------------------------------------------------------ *
 * Cards (data contracts — the Helper renders them)
 * ------------------------------------------------------------------ */

export type ReviewAction = "approve" | "discard" | "request_edit";

/**
 * Gap card — the factual frame for one Concept. Lays out plainly what the art
 * already covers and the Concept's own mechanism, then names the specific points
 * where the inventor's input is needed. It teaches up to the edge and STOPS — it
 * asserts no novelty and proposes no answer (the Boundary guarantees this).
 */
export type GapCard = {
  id: string;
  type: "gap";
  conceptId: string;
  title: string;
  /** What the closest existing art already covers, plainly stated. */
  artSummary: string;
  /** The Concept's own mechanism, pulled from the inventor's material. */
  mechanism: string;
  /** The specific open points where only the inventor can say what's new. */
  openPoints: string[];
};

/**
 * Novelty-capture card — the highest-value capture in the product. The inventor
 * states, in their OWN words, what their Concept does that the art does not. The
 * system never supplies this; it offers no options. Captured verbatim.
 */
export type NoveltyCaptureCard = {
  id: string;
  type: "novelty_capture";
  conceptId: string;
  title: string;
  /** The framed gap, restated as the thing only they can answer. No proposed answer. */
  context: string;
};

/**
 * Differentiation-review card — the inventor's novelty statement, formalized into
 * clean differentiation text built only from their words, for approve/edit/discard.
 */
export type DifferentiationReviewCard = {
  id: string;
  type: "differentiation_review";
  conceptId: string;
  body: string;
  actions: ReviewAction[];
};

/**
 * Key-concept card — anchor selection. A differentiated Concept the inventor
 * chooses to anchor the disclosure becomes a Key Concept (never a "claim").
 */
export type KeyConceptCard = {
  id: string;
  type: "key_concept";
  conceptId: string;
  statement: string;
  actions: ("anchor" | "drop")[];
};

/**
 * Certification card — a Proof-of-Human-Conception factor the ambient capture
 * couldn't cover for a Key Concept. Asks the inventor for it in their own words.
 */
export type CertificationCard = {
  id: string;
  type: "certification";
  conceptId: string;
  title: string;
  factor: "conception" | "quality" | "known_concepts";
  question: string;
};

/**
 * Whitespace card — the full "open landscape" analysis for one concept: per-
 * reference extracted mechanisms, the Match Level, distinguishing features, the
 * open-landscape paragraph, and development guidance. Read-only context (the
 * clarification questions feed the novelty capture).
 */
export type WhitespaceCard = {
  id: string;
  type: "whitespace";
  conceptId: string;
  title: string;
  analysis: WhitespaceAnalysis;
};

export type Module4Card =
  | GapCard
  | WhitespaceCard
  | NoveltyCaptureCard
  | DifferentiationReviewCard
  | KeyConceptCard
  | CertificationCard;

/* ------------------------------------------------------------------ *
 * Inventor action inputs
 * ------------------------------------------------------------------ */

/** The inventor's verbatim statement of what is new against the art. */
export type NoveltyInput = { statement: string };

export type ReviewActionInput =
  | { action: "approve" }
  | { action: "discard" }
  | { action: "request_edit"; correction: string };

export type KeyConceptInput = { action: "anchor" } | { action: "drop" };

/** The inventor's verbatim answer to a Proof-of-Human-Conception factor. */
export type CertificationInput = { answer: string };

export type CardActionInput =
  | NoveltyInput
  | ReviewActionInput
  | KeyConceptInput
  | CertificationInput;

/* ------------------------------------------------------------------ *
 * Working state + the view the engine returns
 * ------------------------------------------------------------------ */

/** One Concept as it moves through Differentiation. */
export type DifferentiatedConcept = ConceptObject & {
  landscape: ConceptLandscape;
  /** The full V1 whitespace analysis for this concept, once generated. */
  whitespace?: WhitespaceAnalysis;
  /** The factual gap frame, once generated (derived from the whitespace). */
  gap?: { artSummary: string; mechanism: string; openPoints: string[] };
  /** The inventor's verbatim novelty statement + its Ledger id. inventor_conceived. */
  novelty?: { verbatim: string; ledgerId: string };
  /** The formalized differentiation text, once approved. system_formalized. */
  differentiation_statement?: string;
  /** Whether the inventor anchored this as a Key Concept. */
  isKeyConcept?: boolean;
  /** The signed Proof-of-Human-Conception certification, once certified. */
  certification?: Certification;
};

/** One section of the compiled Invention Disclosure. */
export type DisclosureSection = { key: string; label: string; body: string };

/** The nine-section Invention Disclosure compiled from the Key Concepts. */
export type InventionDisclosure = { sections: DisclosureSection[] };

/** Canonical section order + labels for the Invention Disclosure. */
export const DISCLOSURE_SECTION_ORDER: { key: string; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "background", label: "Background" },
  { key: "summary", label: "Summary" },
  { key: "abstract", label: "Abstract" },
  { key: "architecture", label: "System Architecture" },
  { key: "data_structures", label: "Data Structures" },
  { key: "operations", label: "Operations" },
  { key: "alternatives", label: "Alternatives" },
  { key: "ramifications", label: "Ramifications" },
];

/** One Proof-of-Human-Conception factor for a Key Concept. */
export type CertFactor = {
  /** 0..1. Under engagement-presumption, a real on-topic answer scores ≥ 0.7. */
  score: number;
  /** Quote-anchored record of what the inventor said for this factor. */
  record: string;
  /** True when the factor is genuinely uncovered (needs a fresh ask). */
  weak: boolean;
};

/** The signed Proof-of-Human-Conception certification for a Key Concept. */
export type Certification = {
  conceptId: string;
  /** Who conceived it. */
  conception: CertFactor;
  /** The contribution beyond AI assistance. */
  quality: CertFactor;
  /** How it exceeds what was already known. */
  known_concepts: CertFactor;
  /** Weighted sum (0.33 / 0.33 / 0.34). */
  confidence: number;
  status: "certified" | "needs_clarification" | "rejected";
};

export type Module4Phase =
  | "framing" // generating the factual gap frames
  | "capturing" // collecting the inventor's verbatim novelty per Concept
  | "anchoring" // selecting Key Concepts
  | "compiling" // assembling the Invention Disclosure
  | "certifying" // certifying inventorship (Proof of Human Conception) per Key Concept
  | "complete";

export type Module4View = {
  phase: Module4Phase;
  cards: Module4Card[];
  /** Each Concept with its landscape, gap, novelty, and differentiation. */
  concepts: DifferentiatedConcept[];
  /** The compiled Invention Disclosure, once anchoring is done. */
  disclosure?: InventionDisclosure;
  /** The Helper conversation — its replies/teaching and the inventor's messages. */
  conversation: HelperTurn[];
  ledger: LedgerEntry[];
  /** True once the disclosure is compiled from at least one Key Concept. */
  complete: boolean;
};

/* ------------------------------------------------------------------ *
 * Sub-agents + the deps the Helper injects
 * ------------------------------------------------------------------ */

/** The sub-agents Module 4 calls. Never user-facing. */
export type AgentName =
  | "helper" // the user-facing Helper: answers, teaches, brainstorms (every module has one)
  | "key-concept-decomposer" // splits a carried Concept into its distinct novel elements (N Key Concepts)
  | "whitespace" // V1's prior-art mechanism surfacer + strategic synthesis per Key Concept
  | "gap-framer" // frames what the art covers + the open points (factual, no novelty)
  | "differentiation-formalizer" // cleans the inventor's novelty into differentiation text
  | "pohc-scorer" // scores the three Proof-of-Human-Conception factors per Key Concept
  | "verifier" // cross-checks each piece (a different agent than the creator)
  // The nine per-section disclosure drafters (each its own specialist prompt):
  | "sec-title"
  | "sec-background"
  | "sec-summary"
  | "sec-abstract"
  | "sec-architecture"
  | "sec-data-structures"
  | "sec-operations"
  | "sec-alternatives"
  | "sec-ramifications";

/** Just the per-section disclosure drafters. */
export type SectionAgent =
  | "sec-title"
  | "sec-background"
  | "sec-summary"
  | "sec-abstract"
  | "sec-architecture"
  | "sec-data-structures"
  | "sec-operations"
  | "sec-alternatives"
  | "sec-ramifications";

export type DifferentiationDeps = {
  runAgent: AgentRunner;
  /** The carried-forward, owned Concepts from Maturation. */
  concepts: ConceptObject[];
  /** Each Concept's prior-art landscape from Module 3, keyed/aligned by conceptId. */
  landscape: ConceptLandscape[];
  /** Representative code from Conception — concrete implementation the section
   *  drafters mine for architecture/data-structures/operations depth. */
  representativeCode?: { language: string; code: string } | null;
  /** Optional shared ledger to thread the proof trail across modules. */
  ledger?: EvidenceLedger;
  /** Optional Shared Consciousness — the cross-module draft memory. */
  consciousness?: SharedConsciousness;
  now?: () => string;
  genId?: () => string;
};
