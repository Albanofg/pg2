import "server-only";
import { EvidenceLedger, SharedConsciousness } from "@/lib/modules/shared";
import { renderScreenCards } from "@/lib/modules/shared/helper-agent";
import { hasCheckpoint, sealCheckpoint } from "@/lib/modules/shared/checkpoint";
import {
  runAbstractRewriter,
  runBackgroundExtender,
  runDetailDescriptionExtender,
  runFigurePlanner,
  runGenusExtractor,
  runHelper,
  runKeyConceptAppender,
  runBaselineBuilder,
  runBreadthAssessor,
  runCriterionFragmenter,
  runEnumerator,
  runFormalizer,
  runGrader,
  runKeyConceptBroadener,
  runKCHygieneVerify,
  runConstraintMiner,
  runGenusVerify,
  runDeltaMiner,
  runKCIndependent,
  runKCDependent,
  runExitEvaluator,
  runForestExpander,
  runSectionPolisher,
  runSummaryExtender,
  runVerifier,
  type ConceptAspect,
  type SectionPolishMode,
} from "./agents";
import { SHOWCASE_CONFIG } from "./config";
import { checkRenderingContract } from "./contract";
import { runChain, type Finding, type Receipt } from "./chain";
import { findNearDuplicates, lintKC } from "./hygiene";
import { REQUIRED_CONSTRAINT_KINDS, type ConstraintKind } from "./coverage";
import { SHOWCASE_HUMAN_SOURCE_TYPES } from "./types";
import type {
  ChoiceInput,
  DeclaredGap,
  DisclosureSection,
  ExpansionArtifact,
  ExpansionReviewInput,
  FigureRenderer,
  Gap,
  GapLocus,
  GapOrigin,
  Genus,
  HelperTurn,
  Module5Card,
  Module5Phase,
  Module5View,
  ShowcaseDeps,
  ShowcaseDrawing,
  ShowcaseKeyConcept,
  Species,
  SpeciesType,
  VariationInput,
  WidenedActionInput,
  CandidateGrade,
  Criterion,
  CriterionFragmentOption,
  CriterionInput,
  GradedCandidate,
  SweepCard,
  SweepGroup,
  SweepInput,
  SweepItem,
  KCHygieneCard,
  KCHygieneDuplicate,
  KCHygieneFlag,
  KCHygieneInput,
  MinedConstraintItem,
  ConstraintReviewInput,
  GenusReviewInput,
  DeltaCandidate,
  DeltaRegion,
  DeltaReviewInput,
  ForestCard,
  ForestTree,
  ForestInput,
  TreeOrigin,
} from "./types";

/**
 * Module 5 — the Showcase flow engine (broadening slice; figures deferred).
 *
 * Broadening is optional and gated. Choose to broaden → extract a paradigm-neutral
 * genus → synthesize alternative species → keep which variations (Gate 1) →
 * broaden each Key Concept to cover them, meaning-preserving (Gate 2). The
 * verifier is the Boundary's guard at both gates: anything that would invent new
 * substance is withheld, never surfaced.
 */

const SPECIES_TYPES: SpeciesType[] = ["ai_assisted", "ai_native", "agentic"];

type Intent =
  | { kind: "choice" }
  | { kind: "variation"; speciesType: SpeciesType }
  | { kind: "widened"; conceptId: string }
  | { kind: "expansion_review" }
  | { kind: "criterion" }
  | { kind: "sweep" }
  | { kind: "kc_hygiene" }
  | { kind: "constraint_review" }
  | { kind: "genus_review" }
  | { kind: "delta_review" }
  | { kind: "forest" };

/** A graded candidate (region) plus its sweep bookkeeping (controller-internal). */
type StoredCandidate = GradedCandidate & {
  // "shown" = surfaced on the sweep; "rejected" = a duplicate or failure, deleted.
  bucket: "shown" | "rejected";
  surfaced: boolean;
  /** The Phase-C region decision (spec §5): keep=disclosure, protect=claim grade. */
  decision?: "kept" | "protected" | "excluded" | "parked";
  /** A mandatory standard build-style — always present, never graded or dropped. */
  mandatory?: boolean;
  /** The build-style tag for a mandatory card (provenance only; never shown). */
  speciesType?: SpeciesType;
  /** The axis this region sits on (spec §4/§5); "automation" for the mandatory three. */
  axisId?: string;
  /** Delta mining (spec §6): mined deltas + the claim-grade outcome for a protected region. */
  deltas?: DeltaCandidate[];
  /** The mechanism is unchanged in this setting (invariance path). */
  sameAsPrimary?: boolean;
  /** After delta review: does this protected region actually reach claim grade? */
  claimConfirmed?: boolean;
  /** Forest: where this tree came onto the map (yours / gap / design_around / future). */
  origin?: TreeOrigin;
  /** Forest: the strategic reason a steered tree belongs (gap filled / design-around / future). */
  note?: string;
  /** Forest: the inventor's one-line +1 in their own words — the human-conception anchor. */
  humanDetail?: string;
};

/** The automation-axis header (spec §5): the three mandatory build-styles group here, first. */
const AUTOMATION_AXIS_LABEL = "How much the AI does the work";

/**
 * The three mandatory build-styles, in the order they're always shown first. They
 * are the positions of the automation axis (spec §4 B1) — grouped under it, first.
 * The text here is only a fallback for when the Baseline Builder omits a style or
 * fails — the agent's plain, invention-specific card overrides it whenever present.
 */
const BASELINE_STYLES: {
  type: SpeciesType;
  family: string;
  label: string;
  source: string;
  mapping: string;
  tradeoff: string;
}[] = [
  {
    type: "ai_assisted",
    family: "a person with an AI helping",
    label: "An AI that helps a person do it",
    source: "A person does the work while an AI suggests, drafts, or checks alongside them.",
    mapping: "Your invention runs with a person in charge and an AI helping at each step.",
    tradeoff: "Quickest to get going and easy to trust, but a person has to stay involved.",
  },
  {
    type: "ai_native",
    family: "an AI doing it directly",
    label: "An AI that does it directly",
    source: "An AI takes the input and produces the result itself, without a person doing each step.",
    mapping: "Your invention's core work is done by an AI directly, from input to result.",
    tradeoff: "Hands-off once it works, but it takes more care to get it reliable.",
  },
  {
    type: "agentic",
    family: "a self-running helper",
    label: "An autonomous helper that works in steps",
    source: "A self-directed helper breaks the job into steps, decides what to do next, and carries them out.",
    mapping: "Your invention is carried out by a self-directed helper that works through it step by step.",
    tradeoff: "Can handle messier jobs on its own, but is the most involved to build and oversee.",
  },
];

/** Deterministic, position-independent hash for stable KC-derived statement ids. */
function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export type ShowcaseSnapshot = {
  phase: Module5Phase;
  started: boolean;
  keyConcepts: ShowcaseKeyConcept[];
  genus: Genus | null;
  species: Species[];
  broadened: boolean;
  disclosure: DisclosureSection[] | null;
  openCards: Module5Card[];
  intents: [string, Intent][];
  conversation: HelperTurn[];
  ledger: import("@/lib/modules/shared").LedgerEntry[];
  drawings: ShowcaseDrawing[];
  // Gaps are NOT stored here — the Ledger (above) is their system of record; the
  // engine derives them from its gap events on read.
  // Layer 4/5 (redesign) state.
  criterion?: Criterion | null;
  criterionEntryId?: string | null;
  candidates?: StoredCandidate[];
  /** A3 (rebuild): inventor-confirmed, anchored constraints flowing downstream. */
  confirmedConstraints?: string[];
};

export class ShowcaseModule {
  private readonly runAgent;
  private readonly now: () => string;
  private readonly genId: () => string;
  private readonly ledger: EvidenceLedger;
  private readonly consciousness: SharedConsciousness;

  private phase: Module5Phase = "choosing";
  private started = false;
  private keyConcepts = new Map<string, ShowcaseKeyConcept>();
  private genus: Genus | null = null;
  private species: Species[] = [];
  private broadened = false;
  private disclosure: DisclosureSection[] | null = null;
  private openCards = new Map<string, Module5Card>();
  private intents = new Map<string, Intent>();
  private conversation: HelperTurn[] = [];
  private drawings: ShowcaseDrawing[] = [];
  // Layer 4/5 (redesign) state — populated only on the flag-on path.
  private criterion: Criterion | null = null;
  private criterionEntryId: string | null = null;
  private candidates: StoredCandidate[] = [];
  // A3 (rebuild): the inventor-confirmed, anchored, type-classified constraints that
  // flow through the enumerator / grader / formalizer signatures. Was an empty array.
  private confirmedConstraints: string[] = [];

  constructor(deps: ShowcaseDeps) {
    this.runAgent = deps.runAgent;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.genId = deps.genId ?? defaultGenId;
    this.ledger =
      deps.ledger ??
      new EvidenceLedger(SHOWCASE_HUMAN_SOURCE_TYPES, this.now, this.genId);
    this.consciousness =
      deps.consciousness ?? new SharedConsciousness(this.now, this.genId);
    this.disclosure = deps.disclosure ?? null;
    for (const k of deps.keyConcepts) {
      this.keyConcepts.set(k.id, { ...k, verbatim: [...k.verbatim] });
    }
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  async start(): Promise<Module5View> {
    if (this.started) return this.view();
    this.started = true;
    this.phase = "choosing";
    this.ledger.recordMachineEvent("showcase_started", ["module5"], {
      keyConcepts: this.keyConcepts.size,
    });
    const id = this.genId();
    this.openCards.set(id, {
      id,
      type: "choice",
      question:
        "Next, we'll explore the different ways your invention could be built, so it's protected no matter how someone makes it. Tap below to start.",
    });
    this.intents.set(id, { kind: "choice" });
    return this.view();
  }

  async act(
    cardId: string,
    input:
      | ChoiceInput
      | VariationInput
      | WidenedActionInput
      | ExpansionReviewInput
      | CriterionInput
      | SweepInput
      | KCHygieneInput
      | ConstraintReviewInput
      | GenusReviewInput
      | DeltaReviewInput
      | ForestInput,
  ): Promise<Module5View> {
    const card = this.openCards.get(cardId);
    const intent = this.intents.get(cardId);
    if (!card || !intent) return this.view();

    switch (card.type) {
      case "kc_hygiene":
        await this.handleKCHygiene(cardId, input as KCHygieneInput);
        break;
      case "constraint_review":
        await this.handleConstraintReview(cardId, input as ConstraintReviewInput);
        break;
      case "genus_review":
        await this.handleGenusReview(cardId, input as GenusReviewInput);
        break;
      case "delta_review":
        await this.handleDeltaReview(cardId, input as DeltaReviewInput);
        break;
      case "forest":
        await this.handleForest(cardId, input as ForestInput);
        break;
      case "choice":
        await this.handleChoice(cardId, input as ChoiceInput);
        break;
      case "variation":
        await this.handleVariation(cardId, intent, input as VariationInput);
        break;
      case "widened_review":
        await this.handleWidened(cardId, intent, input as WidenedActionInput);
        break;
      case "expansion_review":
        await this.handleExpansionReview(cardId, input as ExpansionReviewInput);
        break;
      case "criterion":
        await this.handleCriterion(cardId, input as CriterionInput);
        break;
      case "candidate_sweep":
        await this.handleSweep(cardId, input as SweepInput);
        break;
    }
    this.maybeCheckpoint();
    return this.view();
  }

  async tell(text: string): Promise<Module5View> {
    const t = text.trim();
    if (!t) return this.view();
    this.ledger.recordInventorSource("inventor_note", t, ["showcase", "note"]);
    this.pushTurn({ role: "inventor", text: t });
    try {
      const helper = await runHelper(this.runAgent, {
        message: t,
        context: this.helperContext(),
        inventorMaterial: this.inventorMaterial(),
        conversation: this.conversation.slice(-6).map((tn) => ({ role: tn.role, text: tn.text })),
        consciousness: this.consciousness.renderForAgent(),
      });
      this.pushTurn({
        role: "helper",
        text: helper.reply || "Ask away — I can explain broadening or how this fits together.",
        ...(helper.question?.ask ? { question: helper.question } : {}),
        intent: helper.intent,
      });
    } catch (err) {
      console.error("[showcase] helper failed", err);
      this.pushTurn({ role: "helper", text: "I hit a snag answering that — try rephrasing?" });
    }
    return this.view();
  }

  private pushTurn(turn: Omit<HelperTurn, "timestamp">): void {
    this.conversation.push({ ...turn, timestamp: this.now() });
  }

  /**
   * The live Showcase state for the Helper. Includes the ACTUAL draft (the
   * Invention Concept Blueprint sections) and the full Key Concept text, so
   * "check my draft / what would you polish?" can be answered against the real
   * words — not a status summary. Without the draft here, the Helper has nothing
   * to review and can only guess.
   */
  private helperContext(): string {
    const kept = this.species.filter((s) => s.kept).map((s) => s.species_type);
    const concepts = [...this.keyConcepts.values()];
    const status = [
      `Phase: ${this.phase}. Broadening ${this.broadened ? "applied" : "not yet applied"}.`,
      this.genus ? `Paradigm-neutral genus: ${this.genus.genus_name}.` : "",
      kept.length ? `Kept implementations: ${kept.join(", ")}.` : "",
      this.openCards.size ? `${this.openCards.size} card(s) open for the inventor's decision.` : "",
    ].filter(Boolean);

    const conceptBlock = concepts.length
      ? [
          "KEY CONCEPTS (the anchors; 'broadened' is the widened wording when present):",
          ...concepts.map((k, i) =>
            [
              `(${i + 1}) ${k.title}`,
              `    original: ${k.statement}`,
              ...(k.broadened ? [`    broadened: ${k.broadened}`] : []),
            ].join("\n"),
          ),
        ]
      : ["KEY CONCEPTS: (none)"];

    const draftBlock =
      this.disclosure && this.disclosure.length
        ? [
            "THE CURRENT DRAFT — the Invention Concept Blueprint, section by section",
            "(this IS the draft; quote from it when asked to review or polish it):",
            ...this.disclosure.map((s) => `### ${s.label}\n${s.body || "(empty)"}`),
          ]
        : ["THE CURRENT DRAFT: not compiled yet — there is no draft text to review."];

    const screenBlock = [
      "THE INVENTOR'S SCREEN RIGHT NOW (the cards they are looking at / deciding on):",
      renderScreenCards([...this.openCards.values()]),
    ];

    return [
      status.join("\n"),
      screenBlock.join("\n"),
      conceptBlock.join("\n"),
      draftBlock.join("\n\n"),
    ].join("\n\n");
  }

  /** Everything the inventor has stated in their own words (the verbatim trail). */
  private inventorMaterial(): string {
    return this.ledger
      .humanVerbatim()
      .map((e) => e.verbatim_text)
      .filter(Boolean)
      .join("\n");
  }

  view(): Module5View {
    return {
      phase: this.phase,
      cards: [...this.openCards.values()],
      keyConcepts: [...this.keyConcepts.values()].map(cloneKC),
      disclosure: this.disclosure ? this.disclosure.map(normalizeDisclosureSection) : [],
      ...(this.genus ? { genus: { ...this.genus } } : {}),
      species: this.species.map((s) => ({ ...s, key_components: [...s.key_components], technical_improvements: [...s.technical_improvements] })),
      broadened: this.broadened,
      conversation: this.conversation.map((t) => ({ ...t })),
      ledger: this.ledger.serialize(),
      complete: this.isComplete(),
      drawings: this.drawings.map((d) => ({ ...d, numerals: [...d.numerals] })),
      gaps: this.deriveGaps(),
    };
  }

  /**
   * Edit one section of the ICB draft in place — the inventor's own final polish.
   * Recorded verbatim as an inventor edit (their words are the record), persisted
   * so it survives reload and flows into the export.
   */
  editSection(key: string, body: string): Module5View {
    const section = this.disclosure?.find((s) => s.key === key);
    const next = body.trim();
    if (section && next && next !== section.body) {
      section.body = next;
      this.ledger.recordInventorSource("inventor_edit", next, ["showcase", "section-edit", key]);
    }
    return this.view();
  }

  /**
   * Edit one figure's Brief + Detailed Description of the Drawings in place — the
   * same inventor final-polish path as {@link editSection}, but the drawings text
   * lives on the figure (not the disclosure sections). The rendered diagram itself
   * is NOT editable here — it can only change by re-generating. Recorded verbatim
   * as an inventor edit and persisted, so it survives reload and flows into export.
   */
  editDrawing(figNumber: number, briefDescription: string, detailedDescription: string): Module5View {
    const drawing = this.drawings.find((d) => d.figNumber === figNumber);
    if (!drawing) return this.view();
    const nextBrief = briefDescription.trim();
    const nextDetailed = detailedDescription.trim();
    let changed = false;
    if (nextBrief && nextBrief !== drawing.briefDescription) {
      drawing.briefDescription = nextBrief;
      changed = true;
    }
    if (nextDetailed && nextDetailed !== drawing.detailedDescription) {
      drawing.detailedDescription = nextDetailed;
      changed = true;
    }
    if (changed) {
      this.ledger.recordInventorSource(
        "inventor_edit",
        `${drawing.briefDescription}\n${drawing.detailedDescription}`.trim(),
        ["showcase", "drawing-edit", `fig-${figNumber}`],
      );
    }
    return this.view();
  }

  /**
   * Edit one Key Concept in place — same inventor final-polish path as
   * {@link editSection}. The draft shows the broadened form when present, so an
   * edit writes back to whichever field is being shown (broadened, else the
   * statement). Recorded verbatim as an inventor edit and persisted, so it
   * survives reload and flows into the export.
   */
  editKeyConcept(id: string, title: string, text: string): Module5View {
    const kc = this.keyConcepts.get(id);
    if (!kc) return this.view();
    const nextTitle = title.trim();
    const nextText = text.trim();
    let changed = false;
    if (nextTitle && nextTitle !== kc.title) {
      kc.title = nextTitle;
      changed = true;
    }
    if (nextText) {
      if (kc.broadened) {
        if (nextText !== kc.broadened) {
          kc.broadened = nextText;
          changed = true;
        }
      } else if (nextText !== kc.statement) {
        kc.statement = nextText;
        changed = true;
      }
    }
    if (changed) {
      this.ledger.recordInventorSource("inventor_edit", `${kc.title}: ${kc.broadened || kc.statement}`, [
        "showcase",
        "key-concept-edit",
        id,
      ]);
    }
    return this.view();
  }

  /** The narrative sections the on-demand AI drafter/reviser is offered on. */
  private static readonly NARRATIVE_SECTIONS = new Set(["background", "summary", "abstract"]);

  static isNarrativeSection(key: string): boolean {
    return ShowcaseModule.NARRATIVE_SECTIONS.has(key);
  }

  /**
   * Draft or revise ONE narrative section with AI, on demand from the editor.
   * Returns a PROPOSAL only — it does NOT mutate the draft. The inventor reviews
   * it in the editor and Saves (via editSection) if they want it, so authorship
   * still attaches to their acceptance. "revise" keeps their current text and
   * only improves it; "draft" rebuilds from the established material. Both modes
   * preserve every substantive point (enforced in the prompt), so a revise can't
   * silently delete content. Null if the section isn't a narrative one.
   */
  async polishSection(
    key: string,
    mode: SectionPolishMode,
  ): Promise<{ proposed: string; changeSummary: string; preserved: string[] } | null> {
    const section = this.disclosure?.find((s) => s.key === key);
    if (!section || !ShowcaseModule.isNarrativeSection(key)) return null;
    const keptSpecies = this.species.filter((s) => s.kept);
    const result = await runSectionPolisher(this.runAgent, {
      sectionLabel: section.label,
      mode,
      currentBody: section.body,
      genus: this.genus,
      species: keptSpecies.length ? keptSpecies : this.species,
      keyConcepts: [...this.keyConcepts.values()].map((k) => ({
        title: k.title,
        statement: k.statement,
        ...(k.broadened ? { broadened: k.broadened } : {}),
      })),
      otherSections: (this.disclosure ?? [])
        .filter((s) => s.key !== key)
        .map((s) => ({ label: s.label, body: s.body })),
    });
    // Gap parity with the extractor: substance the section needs but the inputs
    // don't supply is flagged, not filled. polishSection is on-demand and may run
    // repeatedly on one section, so supersede this section's prior open polisher
    // gaps before recording the fresh set (append-only: dismiss, don't delete).
    for (const g of this.openGapsFrom("section_polisher")) {
      if (g.locus.kind === "section" && g.locus.ref === section.label) {
        this.closeGap(g, "dismissed");
      }
    }
    // Force the locus to this section (don't trust the model to echo the label).
    this.recordGaps(
      "section_polisher",
      result.gaps.map((g) => ({ ...g, field: section.label })),
    );
    return {
      proposed: result.body.trim(),
      changeSummary: result.change_summary.trim(),
      preserved: result.preserved_points,
    };
  }

  /* ------------------------------------------------------------------ *
   * The pipeline gap object — a layer flags missing substance instead of
   * authoring it. The shared Ledger is the SYSTEM OF RECORD: a gap is a
   * `gap_opened` event carrying the full gap in `meta.gap`; status changes are
   * `gap_resolved` / `gap_dismissed` events (append-only, never a mutation).
   * Current gap state is DERIVED by folding those events (see `deriveGaps`).
   * ------------------------------------------------------------------ */

  private static gapLocus(origin: GapOrigin, field: string): GapLocus {
    if (origin === "formalizer" || origin === "section_polisher") {
      return { kind: "section", ref: field };
    }
    if (origin === "enumerator") return { kind: "species", ref: field };
    return { kind: "genus_field", ref: field };
  }

  /** Record an agent's declared gaps as `gap_opened` Ledger events (source of record). */
  private recordGaps(
    origin: GapOrigin,
    declared: DeclaredGap[],
    sourceLedgerIds: string[] = [],
  ): void {
    for (const d of declared) {
      const note = d.note?.trim();
      if (!note) continue; // a gap with no stated absence is not a gap
      const gap: Gap = {
        id: this.genId(),
        gapClass: d.gap_class,
        origin,
        locus: ShowcaseModule.gapLocus(origin, d.field),
        description: note,
        sourceLedgerIds,
        status: "open",
        createdAt: this.now(),
      };
      this.ledger.recordMachineEvent("gap_opened", ["showcase", origin, gap.gapClass], {
        gap,
        field: d.field,
      });
    }
  }

  /** Emit a status-change event for a gap (append-only; state is re-derived). */
  private closeGap(gap: Gap, status: "resolved" | "dismissed"): void {
    this.ledger.recordMachineEvent(
      status === "resolved" ? "gap_resolved" : "gap_dismissed",
      ["showcase", gap.origin],
      { gapId: gap.id },
    );
  }

  /** Current gaps, folded from the Ledger's gap events. */
  private deriveGaps(): Gap[] {
    const byId = new Map<string, Gap>();
    for (const e of this.ledger.all()) {
      if (e.type === "gap_opened") {
        const g = e.meta?.gap as Gap | undefined;
        if (g?.id) {
          byId.set(g.id, { ...g, sourceLedgerIds: [...(g.sourceLedgerIds ?? [])] });
        }
      } else if (e.type === "gap_resolved" || e.type === "gap_dismissed") {
        const id = e.meta?.gapId as string | undefined;
        const g = id ? byId.get(id) : undefined;
        if (g) g.status = e.type === "gap_resolved" ? "resolved" : "dismissed";
      }
    }
    return [...byId.values()];
  }

  /** Open gaps of the given origins (for supersede-on-regeneration). */
  private openGapsFrom(...origins: GapOrigin[]): Gap[] {
    const set = new Set(origins);
    return this.deriveGaps().filter((g) => g.status === "open" && set.has(g.origin));
  }

  /**
   * Start (or re-run) Genus & Species Expansion on demand — the top-bar action.
   * Clears any open broadening cards and regenerates the paradigm-neutral genus +
   * alternative species so the inventor can broaden even after reaching the draft.
   */
  async expand(): Promise<Module5View> {
    // Re-running the stage clears EVERY open card — including a stale card of a type
    // this build no longer knows. Listing types here meant an unrecognized card
    // survived every "Start this part over" and kept the stage blank forever.
    for (const [id] of [...this.openCards]) this.resolveCard(id);
    this.species = [];
    // Reset Layer 4/5 working state so a re-run starts the criterion/sweep clean.
    this.criterion = null;
    this.criterionEntryId = null;
    this.candidates = [];
    this.confirmedConstraints = [];
    // Re-expansion regenerates the genus and species, so supersede the gaps those
    // stages opened (append-only: emit a dismissal, don't delete). Later-stage
    // gaps (e.g. the formalizer) survive.
    for (const g of this.openGapsFrom("genus_extractor", "enumerator")) {
      this.closeGap(g, "dismissed");
    }
    await this.generateVariations();
    return this.view();
  }

  /** The finished Key Concepts (broadened where the inventor accepted it). */
  finish(): ShowcaseKeyConcept[] {
    return [...this.keyConcepts.values()].map(cloneKC);
  }

  /** The Invention Disclosure carried from Module 4 (for export). */
  getDisclosure(): DisclosureSection[] | null {
    return this.disclosure ? this.disclosure.map(normalizeDisclosureSection) : null;
  }

  /** The finished drawings (figure + descriptions) — for the ICB view and export. */
  getDrawings(): ShowcaseDrawing[] {
    return this.drawings.map((d) => ({ ...d, numerals: [...d.numerals] }));
  }

  /**
   * Plan the figure set from the finished draft, hand the plan to the injected
   * renderer (the diagram service, in plan mode), and fuse each rendered figure
   * with its plan-authored descriptions. One plan drives BOTH the drawing and its
   * description, so they can't disagree; each description's numerals are reconciled
   * to what was actually drawn. The renderer is injected so the engine stays free
   * of HTTP/transport.
   */
  async generateDrawings(render: FigureRenderer): Promise<Module5View> {
    const specText = this.assembleSpecForPlanner();
    if (specText.trim().length < 20) return this.view();

    const plan = await runFigurePlanner(this.runAgent, { specText });
    const figures = plan.figures.filter((f) => f.outline.trim() || f.numerals.length);
    if (!figures.length) {
      this.ledger.recordMachineEvent("drawings_plan_empty", ["showcase", "drawings"], {});
      return this.view();
    }

    const rendered = await render({ figures, numerals: plan.numerals, gaps: plan.gaps });
    const byNum = new Map(rendered.map((r) => [r.figNumber, r]));

    const drawings: ShowcaseDrawing[] = [];
    for (const f of figures) {
      const r = byNum.get(f.figNumber);
      if (!r) continue; // figure the service couldn't draw — drop it (no orphan text)
      // Reconcile the description's numerals to what was actually rendered.
      const drawn = new Set(r.numerals.length ? r.numerals : f.numerals);
      drawings.push({
        figNumber: f.figNumber,
        figType: f.figType,
        title: (f.title || r.title || `Figure ${f.figNumber}`).trim(),
        briefDescription: f.briefDescription.trim(),
        detailedDescription: f.detailedDescription.trim(),
        numerals: f.numerals.filter((n) => drawn.has(n)),
        svgData: r.svgData,
        pdfBase64: r.pdfBase64,
      });
    }
    drawings.sort((a, b) => a.figNumber - b.figNumber);
    this.drawings = drawings;
    this.ledger.recordMachineEvent("drawings_generated", ["showcase", "drawings"], {
      figures: drawings.length,
    });
    return this.view();
  }

  /** Assemble the draft (sections + Key Concepts) as the planner's input text. */
  private assembleSpecForPlanner(): string {
    const lines: string[] = [];
    const disc = this.disclosure ? this.disclosure.map(normalizeDisclosureSection) : [];
    for (const s of disc) {
      lines.push(`## ${s.label}`, s.body.trim(), "");
    }
    const kcs = [...this.keyConcepts.values()];
    if (kcs.length) {
      lines.push("## Key Concepts", "");
      kcs.forEach((k, i) =>
        lines.push(`${i + 1}. ${k.title} — ${(k.broadened || k.statement).trim()}`),
      );
    }
    return lines.join("\n").trim();
  }

  ledgerEntries() {
    return this.ledger.serialize();
  }

  consciousnessInstance(): SharedConsciousness {
    return this.consciousness;
  }

  /* ------------------------------------------------------------------ *
   * Flow
   * ------------------------------------------------------------------ */

  private async handleChoice(cardId: string, input: ChoiceInput): Promise<void> {
    this.ledger.recordDecision("broaden_choice", ["showcase", input.choice]);
    this.resolveCard(cardId);
    if (input.choice === "skip") {
      this.broadened = false;
      this.complete();
      return;
    }
    await this.generateVariations();
  }

  /**
   * A1 — Key Concept overlap SIGNAL (spec §3 A1, revised for this module's purpose).
   *
   * This module BROADENS and never removes a Key Concept, so hygiene no longer
   * surfaces ANY keep-one / delete choice. A broadening step must make narrowing
   * impossible, not merely discouraged — any button that removes a concept lets an
   * inventor click their way down to the narrowest idea, which is the exact opposite
   * of the job. Where two concepts overlap, that shared core is the raw material the
   * genus lifts UP into the broad position; it flows upward, never deletes sideways.
   *
   * So this runs the deterministic checks only to RECORD a signal (for provenance /
   * the genus), surfaces nothing, and always proceeds. No concept is ever removed.
   */
  private async runKCHygiene(): Promise<boolean> {
    const kcs = [...this.keyConcepts.values()];
    const lintKCs = kcs.map((k) => ({ id: k.id, title: k.title, statement: k.statement }));
    // A low bar here just senses where a shared core lives, for the genus to lift up.
    const overlaps = findNearDuplicates(lintKCs, 0.5);
    const textFlags = lintKCs.reduce((n, kc) => n + lintKC(kc).length, 0);
    if (overlaps.length || textFlags) {
      this.ledger.recordMachineEvent("kc_overlap_signal", ["showcase"], {
        overlaps: overlaps.map((p) => ({ a: p.a.id, b: p.b.id, similarity: p.similarity })),
        textFlags,
      });
    }
    this.recordReceipt({ chain: "kc_hygiene", outcome: "verified_clean", findings: [] });
    return true; // never surface a narrowing choice — straight to the broadening
  }

  /** Resolve one A1 hygiene decision; when the set is clean, continue to genus. */
  private async handleKCHygiene(cardId: string, input: KCHygieneInput): Promise<void> {
    const card = this.openCards.get(cardId);
    if (!card || card.type !== "kc_hygiene") return;

    if (input.action === "keep_one") {
      const pair = card.duplicates.find((d) => d.pairId === input.pairId);
      if (!pair) return;
      const dropId = input.keepId === pair.aId ? pair.bId : pair.aId;
      this.keyConcepts.delete(dropId);
      this.ledger.recordDecision("kc_hygiene", ["showcase", "duplicate_removed"], {
        removed: dropId,
        kept: input.keepId,
      });
      pair.resolved = true;
      this.markResolvedFor(card, dropId);
    } else if (input.action === "keep_both") {
      const pair = card.duplicates.find((d) => d.pairId === input.pairId);
      if (pair) pair.resolved = true;
    } else if (input.action === "keep_flag") {
      const flag = card.flags.find((f) => f.flagId === input.flagId);
      if (flag) flag.resolved = true;
    } else if (input.action === "remove_flag") {
      const flag = card.flags.find((f) => f.flagId === input.flagId);
      if (flag) {
        this.keyConcepts.delete(flag.kcId);
        this.ledger.recordDecision("kc_hygiene", ["showcase", "flagged_removed"], {
          removed: flag.kcId,
        });
        this.markResolvedFor(card, flag.kcId);
      }
    }

    if (card.duplicates.every((d) => d.resolved) && card.flags.every((f) => f.resolved)) {
      this.resolveCard(cardId);
      await this.runGenusAndCandidates();
    }
  }

  /** Mark every hygiene finding touching a removed Key Concept as resolved. */
  private markResolvedFor(card: KCHygieneCard, removedKcId: string): void {
    for (const f of card.flags) if (f.kcId === removedKcId) f.resolved = true;
    for (const d of card.duplicates) {
      if (d.aId === removedKcId || d.bId === removedKcId) d.resolved = true;
    }
  }

  private async generateVariations(): Promise<void> {
    // A (re-)run means the broadening has NOT been applied yet, so reset the flag.
    // Without this, restarting the stage after a prior completion left `broadened`
    // true, and the client auto-advanced to the draft the moment the sweep resolved —
    // jumping past the broadening review (part 2) and stranding it on this page.
    this.broadened = false;
    // A1 hygiene first — the CLEAN Key Concept set gates everything downstream
    // (spec §3 A1). If it surfaces cards, pause here and resume from the card.
    const clean = await this.runKCHygiene();
    if (!clean) return;
    await this.runGenusAndCandidates();
  }

  /** Genus detection → confirm → constraints → breadth → sweep. */
  private async runGenusAndCandidates(): Promise<void> {
    await this.runGenusChain();
  }

  /**
   * A2 — genus detection as a chain (spec §3 A2). Produce: extract the genus with
   * verbatim anchors. Verify: a deterministic ≥8-char anchor check + a second-model
   * OVERBREADTH review against the anchors. Repair/fallback: narrow to the anchored
   * portion (never invent an anchor). Then surface the genus for Keep/Edit. On
   * genus-extraction failure the stage completes (can't go on without a genus).
   */
  private async runGenusChain(): Promise<void> {
    const kcs = [...this.keyConcepts.values()];
    const record = kcs.flatMap((k) => k.verbatim).join("\n");
    const anchored = (q: string) => q.trim().length >= 8 && record.includes(q.trim());
    const narrow = (g: Genus): Genus => ({ ...g, anchors: (g.anchors ?? []).filter(anchored) });

    let failed = false;
    const { value: genus, findings } = await runChain<Genus>({
      name: "genus_detection",
      produce: async () => {
        try {
          const { gaps, ...g } = await runGenusExtractor(this.runAgent, {
            keyConcepts: kcs.map((k) => ({ title: k.title, statement: k.statement })),
            verbatim: kcs.flatMap((k) => k.verbatim),
          });
          void gaps;
          return g as Genus;
        } catch (err) {
          console.error("[showcase] genus extraction failed", err);
          failed = true;
          return {
            genus_name: "",
            genus_description: "",
            input_pattern: "",
            transformation_pattern: "",
            output_pattern: "",
            anchors: [],
          } as Genus;
        }
      },
      verify: async (g) => {
        if (failed) return { pass: true, findings: [] };
        const findings: Finding[] = [];
        const real = (g.anchors ?? []).filter(anchored);
        if (!real.length) {
          findings.push({
            quote: g.genus_name || "(genus)",
            citation: "A2.anchor",
            rule: "genus carries no verbatim anchor ≥8 chars from the inputs",
          });
        }
        try {
          const v = await runGenusVerify(this.runAgent, { genus: g, anchors: real });
          for (const o of v.overbroad) {
            if (o.quote.trim()) {
              findings.push({
                quote: o.quote,
                citation: "MPEP 2161.01",
                rule: `overbroad: ${o.reason || "claims more than the anchors support"}`,
              });
            }
          }
        } catch (err) {
          console.error("[showcase] genus verify failed", err);
        }
        return { pass: findings.length === 0, findings };
      },
      // Repair/fallback narrow to the anchored portion — a quote is never invented.
      repair: async (g) => narrow(g),
      fallback: (g) => narrow(g),
      onReceipt: (r) => this.recordReceipt(r),
    });

    if (failed || !genus.genus_name) {
      this.complete();
      return;
    }

    this.genus = genus;
    this.ledger.recordMachineEvent("agent_genus", ["showcase"], {});

    // Surface the genus for confirmation / edit (spec §3 A2). Overbreadth findings
    // that survived to fallback are shown so the inventor can narrow the wording.
    const overbroad = findings
      .filter((f) => f.citation.startsWith("MPEP"))
      .map((f) => ({ quote: f.quote, reason: f.rule.replace(/^overbroad:\s*/, "") }));
    const id = this.genId();
    this.openCards.set(id, { id, type: "genus_review", genus, overbroad });
    this.intents.set(id, { kind: "genus_review" });
  }

  /** Resolve the A2 genus confirmation; Keep continues to A3, Edit revises the statement. */
  private async handleGenusReview(cardId: string, input: GenusReviewInput): Promise<void> {
    const card = this.openCards.get(cardId);
    if (!card || card.type !== "genus_review" || !this.genus) return;

    if (input.action === "edit") {
      const desc = input.description.trim();
      if (desc) {
        this.genus = { ...this.genus, genus_description: desc };
        card.genus = this.genus;
        // Editing the genus statement (a machine abstraction) is the inventor's — R2.
        this.ledger.recordDecision("genus_edit", ["showcase", "inventor_conceived"], {});
      }
      return;
    }

    // keep — confirm the genus and continue to A3, then breadth + sweep.
    this.resolveCard(cardId);
    if (!(await this.runConstraintMining())) return;
    await this.runBreadthAndSweep();
  }

  /** Breadth sizing → the ways-to-build-it sweep (post-constraint-confirmation). */
  private async runBreadthAndSweep(): Promise<void> {
    // Size the invention: how many genuinely distinct build-directions ("trees")
    // does this genus ("forest") warrant? Narrow → a few; broad → many. The count
    // is assessed per ICB case, not fixed at three.
    let band: "narrow" | "moderate" | "broad" = "moderate";
    try {
      const b = await runBreadthAssessor(this.runAgent, {
        genus: this.genus!,
        keyConcepts: [...this.keyConcepts.values()].map((k) => ({
          title: k.title,
          statement: k.statement,
        })),
      });
      band = b.band;
      this.ledger.recordMachineEvent("agent_breadth", ["showcase", band], { reason: b.reason });
    } catch (err) {
      console.error("[showcase] breadth assessor failed (defaulting to moderate)", err);
    }

    // The flow: genus → enumerate → grade → sweep → formalize. No opening
    // question — candidates come first, and keep/dismiss IS the signal.
    await this.generateCandidates(band);
  }

  /**
   * A3 — constraint mining (spec §3 A3). Produce: mine the verbatim record for
   * anchored, classified candidates. Verify: a deterministic anchor check (every
   * quote must be a verbatim substring of the record). Fallback: drop the
   * unanchored — never rewrite one into existence. Surfaces a Keep/Remove/Edit
   * confirmation card; the confirmed set populates confirmedConstraints. Returns
   * true when there is nothing to confirm (proceed), false when a card was surfaced.
   */
  private async runConstraintMining(): Promise<boolean> {
    const record = [...this.keyConcepts.values()]
      .flatMap((k) => k.verbatim)
      .join("\n")
      .trim();
    if (!record) {
      this.confirmedConstraints = [];
      return true;
    }

    const anchored = (c: { quote: string }) =>
      c.quote.trim().length > 0 && record.includes(c.quote.trim());

    const { value: candidates } = await runChain<{ kind: ConstraintKind; quote: string }[]>({
      name: "constraint_mining",
      produce: async () => (await runConstraintMiner(this.runAgent, { record })).candidates,
      verify: async (cands) => {
        const findings: Finding[] = cands
          .filter((c) => !anchored(c))
          .map((c) => ({
            quote: c.quote || "(empty)",
            citation: "A3.anchor",
            rule: "constraint quote is not a verbatim substring of the record",
          }));
        return { pass: findings.length === 0, findings };
      },
      // No repair — a quote is never rewritten into existence; drop the unanchored.
      fallback: (cands) => cands.filter(anchored),
      onReceipt: (r) => this.recordReceipt(r),
    });

    // Deduplicate by (kind, normalized quote).
    const seen = new Set<string>();
    const deduped = candidates.filter((c) => {
      const key = `${c.kind}:${c.quote.trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (!deduped.length) {
      // Nothing minable — confirmedConstraints stays empty. Missing required classes
      // are recorded as gaps (routed to Phase C), never asked as questions here.
      this.confirmedConstraints = [];
      this.recordMissingConstraintGaps(new Set());
      return true;
    }

    const items: MinedConstraintItem[] = deduped.map((c) => ({
      id: this.genId(),
      kind: c.kind,
      quote: c.quote.trim(),
      kept: true,
    }));
    const id = this.genId();
    this.openCards.set(id, { id, type: "constraint_review", items });
    this.intents.set(id, { kind: "constraint_review" });
    return false;
  }

  /** Resolve the A3 confirmation; populate confirmedConstraints, then continue. */
  private async handleConstraintReview(
    cardId: string,
    input: ConstraintReviewInput,
  ): Promise<void> {
    const card = this.openCards.get(cardId);
    if (!card || card.type !== "constraint_review") return;

    if (input.action === "toggle") {
      const item = card.items.find((i) => i.id === input.itemId);
      if (item) item.kept = !item.kept;
      return;
    }
    if (input.action === "edit") {
      const item = card.items.find((i) => i.id === input.itemId);
      const q = input.quote.trim();
      // Edit only ever TRIMS the inventor's own words — the result must still be a
      // verbatim substring of the record (R2 / R3: never machine-authored content).
      const record = [...this.keyConcepts.values()].flatMap((k) => k.verbatim).join("\n");
      if (item && q && record.includes(q)) {
        item.quote = q;
        this.ledger.recordDecision("constraint_edit", ["showcase", "inventor_conceived"], {
          kind: item.kind,
        });
      }
      return;
    }

    // confirm
    const kept = card.items.filter((i) => i.kept);
    this.confirmedConstraints = kept.map((i) => i.quote);
    for (const i of kept) {
      this.ledger.recordDecision("constraint_confirmed", ["showcase", "inventor_confirmed"], {
        kind: i.kind,
      });
    }
    this.recordMissingConstraintGaps(new Set(kept.map((i) => i.kind)));
    this.resolveCard(cardId);
    await this.runBreadthAndSweep();
  }

  /** Open a gap for each required constraint class with no confirmed candidate. */
  private recordMissingConstraintGaps(present: Set<ConstraintKind>): void {
    const classFor: Record<ConstraintKind, DeclaredGap["gap_class"]> = {
      constraint: "missing_constraint",
      invariant: "missing_invariant",
      operation_step: "missing_step",
      data_structure: "missing_data_structure",
    };
    const declared: DeclaredGap[] = REQUIRED_CONSTRAINT_KINDS.filter((k) => !present.has(k)).map(
      (k) => ({
        gap_class: classFor[k],
        field: k,
        note: `the record states no ${k.replace(/_/g, " ")} for the invention yet`,
      }),
    );
    if (declared.length) this.recordGaps("constraint_miner", declared);
  }

  /* ------------------------------------------------------------------ *
   * Layer 4/5 (redesign) flow — criterion → enumerate → grade → sweep →
   * formalize. Runs only when SHOWCASE_CONFIG.layer4.live is true.
   * ------------------------------------------------------------------ */

  /** The inventor's upstream statements, with deterministic KC-derived ids. */
  private criterionStatements(): { id: string; text: string }[] {
    const out: { id: string; text: string }[] = [];
    for (const kc of this.keyConcepts.values()) {
      for (const v of kc.verbatim) {
        const text = v.trim();
        // Id keyed on stable KC identity + content (NOT array position), so the
        // pointer survives re-seeds and still resolves after the humanVerbatim fix.
        if (text) out.push({ id: `kc:${kc.id}:${stableHash(text)}`, text });
      }
    }
    return out;
  }

  /**
   * Lift tap-able criterion options from the inventor's OWN words, then ask.
   * Tap-only cascade — never a compose surface:
   *   1. fragments from the Key Concept verbatim;
   *   2. empty → widen to all upstream inventor verbatim, re-run once;
   *   3. still empty → offer the whole statements themselves as taps;
   *   4. no upstream material at all → open a gap and block.
   */
  private async beginCriterion(): Promise<void> {
    const kcStatements = this.criterionStatements();
    if (!kcStatements.length) {
      this.recordGaps("genus_extractor", [
        {
          gap_class: "missing_criterion_source",
          field: "criterion",
          note: "there is no earlier inventor material to lift a criterion from; the earlier stages must be completed first",
        },
      ]);
      this.pushTurn({
        role: "helper",
        text: "There's nothing from the earlier steps to build on yet — finish those first, then come back to add more ways to build it.",
      });
      this.broadened = false;
      this.complete();
      return;
    }

    let statements = kcStatements;
    let fragments = await this.fragmentCriterion(statements);
    if (!fragments.length) {
      const widened = this.widenedCriterionStatements();
      if (widened.length > kcStatements.length) {
        statements = widened;
        fragments = await this.fragmentCriterion(widened);
      }
    }
    if (!fragments.length) {
      // Offer the whole statements as taps — still the inventor's own words.
      const seen = new Set<string>();
      for (const s of statements) {
        const text = s.text.trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        fragments.push({ id: this.genId(), text, sourceId: s.id });
      }
    }

    const id = this.genId();
    this.openCards.set(id, {
      id,
      type: "criterion",
      question:
        "What's the one thing your invention has to get right, no matter how it's built? Tap the one that's true.",
      fragments,
    });
    this.intents.set(id, { kind: "criterion" });
    this.phase = "awaiting_criterion";
  }

  /** Run the fragmenter; keep only verbatim-lifted phrases (source derived by match). */
  private async fragmentCriterion(
    statements: { id: string; text: string }[],
  ): Promise<CriterionFragmentOption[]> {
    if (!statements.length) return [];
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const out: CriterionFragmentOption[] = [];
    try {
      const r = await runCriterionFragmenter(this.runAgent, { statements });
      this.ledger.recordMachineEvent("agent_criterion_fragments", ["showcase"], {
        count: r.fragments.length,
      });
      const seen = new Set<string>();
      for (const f of r.fragments) {
        const text = f.text.trim();
        if (!text || seen.has(text)) continue;
        // Verbatim guard: must be a real substring of some statement. Derive the
        // source from the match — do NOT trust the model's echoed id.
        const match = statements.find((s) => norm(s.text).includes(norm(text)));
        if (!match) continue;
        seen.add(text);
        out.push({ id: this.genId(), text, sourceId: match.id });
      }
    } catch (err) {
      console.error("[showcase] criterion fragmenter failed", err);
    }
    return out;
  }

  /** All upstream inventor verbatim: KC verbatim + any human-origin ledger entries. */
  private widenedCriterionStatements(): { id: string; text: string }[] {
    const out = [...this.criterionStatements()];
    const seen = new Set(out.map((s) => s.text.trim()));
    for (const e of this.ledger.all()) {
      if (e.origin === "human" && typeof e.verbatim_text === "string") {
        const text = e.verbatim_text.trim();
        if (text && !seen.has(text)) {
          seen.add(text);
          out.push({ id: `led:${e.id}`, text });
        }
      }
    }
    return out;
  }

  private async handleCriterion(cardId: string, input: CriterionInput): Promise<void> {
    const card = this.openCards.get(cardId);
    if (!card || card.type !== "criterion") return;
    const frag = card.fragments.find((f) => f.id === input.fragmentId);
    if (!frag) return;
    // Tap-only, single provenance: the inventor CONFIRMED their own lifted words as
    // the criterion — inventor_confirmed, with a pointer to the source statement.
    const entry = this.ledger.recordInventorSource(
      "criterion_set",
      frag.text,
      ["showcase", "inventor_confirmed"],
      { kind: "tapped", sourceStatementId: frag.sourceId },
    );
    this.criterion = { text: frag.text, sourceId: frag.sourceId };
    this.criterionEntryId = entry.id;
    this.resolveCard(cardId);
    await this.generateCandidates("moderate");
  }

  /**
   * The ways to build the invention: the THREE mandatory standard build-styles
   * (always present, shown first) PLUS a breadth-sized emergent forest of genuinely
   * distinct techniques (graded, deduped, floored at one). The inventor always lands
   * on all three standard ways and at least one more. Emergent groups come from the
   * enumerator's own "family" tags — however many the invention warrants.
   */
  private async generateCandidates(band: "narrow" | "moderate" | "broad"): Promise<void> {
    const genus = this.genus;
    if (!genus) {
      this.broadened = false;
      this.complete();
      return;
    }
    const { generationCap, targetByBreadth } = SHOWCASE_CONFIG.layer4;
    const target = targetByBreadth[band]; // EMERGENT extras beyond the three standard ways
    const confirmedConstraints = this.confirmedConstraints; // A3: inventor-confirmed, anchored

    // (1) The three MANDATORY build-styles — always present, shown first, never graded.
    const mandatory = await this.buildMandatoryCards(genus, confirmedConstraints);

    // (2) The EMERGENT forest — enumerate genuinely distinct techniques, grade, dedup.
    let graded: GradedCandidate[] = [];
    try {
      const enr = await runEnumerator(this.runAgent, { genus, confirmedConstraints, target });
      this.ledger.recordMachineEvent("agent_enumerated", ["showcase"], {
        count: enr.candidates.length,
      });
      // A dropped candidate has no consequence for the inventor, so we do NOT
      // surface enumerator gaps — they'd be noise on screen. `enr.gaps` dropped.
      void enr.gaps;
      const capped = enr.candidates.filter((c) => c.label.trim()).slice(0, generationCap);
      if (capped.length) {
        const grd = await runGrader(this.runAgent, { candidates: capped, genus, confirmedConstraints });
        this.ledger.recordMachineEvent("agent_graded", ["showcase"], { count: grd.grades.length });
        const gradeByLabel = new Map(grd.grades.map((g) => [g.label, g]));
        graded = capped.map((c) => {
          const g = gradeByLabel.get(c.label);
          const grade: CandidateGrade = g
            ? {
                traceability: g.traceability,
                fidelity: g.fidelity,
                specificity: g.specificity,
                distinctness: g.distinctness,
                verdict: g.verdict,
                reason: g.reason,
              }
            : {
                traceability: 0,
                fidelity: 0,
                specificity: 0,
                distinctness: 0,
                verdict: "reject",
                reason: "ungraded",
              };
          return {
            id: this.genId(),
            family: c.family.trim() || "Other ways to build it",
            label: c.label,
            source: c.source,
            mapping: c.mapping,
            tradeoff: c.tradeoff,
            grade,
            axisId: "approach", // emergent vehicles sit on the approaches axis
          };
        });
      }
    } catch (err) {
      console.error("[showcase] enumerate/grade failed", err);
    }

    // The grader deletes duplicates and failures (reject); everything else is SHOWN —
    // no hidden reserve, no count cap. If there's more, the inventor sees all of it.
    const emergent: StoredCandidate[] = graded.map((c) => ({
      ...c,
      bucket: c.grade.verdict === "reject" ? "rejected" : "shown",
      surfaced: c.grade.verdict !== "reject",
    }));

    // Floor: the inventor must always land on the three standard ways PLUS at least one
    // more. If grading rejected every emergent candidate, keep the best-ranked one
    // anyway (highest total score) so there's always at least one extra.
    if (!emergent.some((c) => c.bucket === "shown") && emergent.length) {
      const gradeTotal = (c: StoredCandidate) =>
        c.grade.traceability + c.grade.fidelity + c.grade.specificity + c.grade.distinctness;
      const best = [...emergent].sort((a, b) => gradeTotal(b) - gradeTotal(a))[0];
      best.bucket = "shown";
      best.surfaced = true;
    }

    // Merge: the three mandatory build-styles first, then the emergent forest. These
    // are the inventor's STARTING trees ("yours"); the forest grows from here as the
    // inventor steers ("what am I missing?" / "design-arounds" / "the future version").
    this.candidates = [...mandatory, ...emergent];
    for (const c of this.candidates) if (!c.origin) c.origin = "yours";
    const id = this.genId();
    this.openCards.set(id, this.buildForestCard(id));
    this.intents.set(id, { kind: "forest" });
    this.phase = "sweeping";
  }

  /**
   * The three mandatory build-styles (AI-assisted / AI-native / agentic), mapped
   * onto the invention by the Baseline Builder and always returned in fixed order.
   * Every slot is guaranteed filled: if the agent omits a style or fails outright,
   * a plain fallback card takes the slot. These are never graded and never dropped —
   * they always survive and surface, and sit first in their own group.
   */
  private async buildMandatoryCards(
    genus: Genus,
    confirmedConstraints: string[],
  ): Promise<StoredCandidate[]> {
    const byType = new Map<SpeciesType, { label: string; source: string; mapping: string; tradeoff: string }>();
    try {
      const res = await runBaselineBuilder(this.runAgent, { genus, confirmedConstraints });
      this.ledger.recordMachineEvent("agent_baseline", ["showcase"], { count: res.builds.length });
      for (const b of res.builds) {
        byType.set(b.species_type, {
          label: b.label,
          source: b.source,
          mapping: b.mapping,
          tradeoff: b.tradeoff,
        });
      }
    } catch (err) {
      console.error("[showcase] baseline builder failed", err);
    }
    // A standard build always fits (the genus was distilled to guarantee it), so it
    // is scored full marks and never routed through the skeptic Grader.
    const grade: CandidateGrade = {
      traceability: 3,
      fidelity: 3,
      specificity: 3,
      distinctness: 3,
      verdict: "survive",
      reason: "standard build — always included",
    };
    return BASELINE_STYLES.map((style) => {
      const got = byType.get(style.type);
      return {
        id: this.genId(),
        // The three mandatory build-styles are the automation axis, shown first (§5).
        family: AUTOMATION_AXIS_LABEL,
        label: (got?.label ?? "").trim() || style.label,
        source: (got?.source ?? "").trim() || style.source,
        mapping: (got?.mapping ?? "").trim() || style.mapping,
        tradeoff: (got?.tradeoff ?? "").trim() || style.tradeoff,
        grade,
        bucket: "shown" as const,
        surfaced: true,
        mandatory: true,
        speciesType: style.type,
        axisId: "automation",
      };
    });
  }

  /** Build the Phase-C sweep card grouped by axis (automation axis first). */
  private buildSweepCard(id: string): SweepCard {
    const order: string[] = [];
    const byFamily = new Map<string, StoredCandidate[]>();
    for (const c of this.candidates) {
      if (!byFamily.has(c.family)) {
        byFamily.set(c.family, []);
        order.push(c.family);
      }
      byFamily.get(c.family)!.push(c);
    }
    const statusFor = (d: StoredCandidate["decision"]): SweepItem["status"] =>
      d === "kept" || d === "protected" || d === "excluded" || d === "parked" ? d : "pending";
    const groups: SweepGroup[] = [];
    for (const family of order) {
      const items: SweepItem[] = byFamily
        .get(family)!
        .filter((c) => c.surfaced)
        .map((c) => ({
          candidateId: c.id,
          family,
          label: c.label,
          source: c.source,
          mapping: c.mapping,
          tradeoff: c.tradeoff,
          status: statusFor(c.decision),
          grade:
            c.decision === "protected"
              ? ("claim" as const)
              : c.decision === "kept"
                ? ("disclosure" as const)
                : undefined,
        }));
      if (items.length > 0) groups.push({ family, items });
    }
    return { id, type: "candidate_sweep", groups };
  }

  private refreshSweep(cardId: string): void {
    this.openCards.set(cardId, this.buildSweepCard(cardId));
  }

  /* ------------------------------------------------------------------ *
   * The conversational FOREST — the inventor steers, the AI fills, the
   * inventor claims the trees worth owning in their own words.
   * ------------------------------------------------------------------ */

  /** Build the forest card from the current trees (candidates), genus at the top. */
  private buildForestCard(id: string): ForestCard {
    const trees: ForestTree[] = this.candidates
      .filter((c) => c.bucket !== "rejected")
      .map((c) => ({
        id: c.id,
        label: c.label,
        source: c.source,
        mapping: c.mapping,
        tradeoff: c.tradeoff,
        origin: c.origin ?? "yours",
        note: c.note,
        status:
          c.decision === "protected"
            ? ("claimed" as const)
            : c.decision === "kept"
              ? ("kept" as const)
              : c.decision === "excluded"
                ? ("dropped" as const)
                : ("pending" as const),
        detail: c.humanDetail,
      }));
    return {
      id,
      type: "forest",
      genusName: this.genus?.genus_name ?? "",
      genusDescription: this.genus?.genus_description ?? "",
      trees,
    };
  }

  private refreshForest(cardId: string): void {
    this.openCards.set(cardId, this.buildForestCard(cardId));
  }

  /** Fill the forest in the direction the inventor steered — appends new trees. */
  private async expandForest(direction: "missing" | "design_around" | "future"): Promise<void> {
    const genus = this.genus;
    if (!genus) return;
    const existing = this.candidates.filter((c) => c.bucket !== "rejected").map((c) => c.label);
    const originFor: Record<typeof direction, TreeOrigin> = {
      missing: "gap",
      design_around: "design_around",
      future: "future",
    };
    try {
      const res = await runForestExpander(this.runAgent, { genus, existing, direction, target: 4 });
      this.ledger.recordMachineEvent("agent_forest_expanded", ["showcase", direction], {
        count: res.trees.length,
      });
      const seen = new Set(existing.map((e) => e.toLowerCase()));
      for (const t of res.trees) {
        const label = t.label.trim();
        if (!label || seen.has(label.toLowerCase())) continue;
        seen.add(label.toLowerCase());
        this.candidates.push({
          id: this.genId(),
          family: label,
          label,
          source: t.source,
          mapping: t.mapping,
          tradeoff: t.tradeoff,
          grade: {
            traceability: 3,
            fidelity: 3,
            specificity: 3,
            distinctness: 3,
            verdict: "survive",
            reason: "forest-expanded",
          },
          bucket: "shown",
          surfaced: true,
          origin: originFor[direction],
          note: t.note.trim() || undefined,
        });
      }
    } catch (err) {
      console.error("[showcase] forest expander failed", err);
    }
  }

  /** Steer / keep / claim / drop / finalize the forest. */
  private async handleForest(cardId: string, input: ForestInput): Promise<void> {
    const card = this.openCards.get(cardId);
    if (!card || card.type !== "forest") return;

    if (input.action === "steer") {
      await this.expandForest(input.direction);
      this.refreshForest(cardId);
      return;
    }
    if (input.action === "finalize") {
      this.resolveCard(cardId);
      await this.formalizeKept(
        this.candidates.filter((c) => c.decision === "kept" || c.decision === "protected"),
      );
      return;
    }

    const cand = this.candidates.find((c) => c.id === input.treeId);
    if (!cand) return;

    if (input.action === "keep") {
      cand.decision = cand.decision === "kept" ? undefined : "kept";
      if (cand.decision === "kept") {
        this.ledger.recordDecision("tree_kept", ["showcase", "inventor_confirmed"], {
          candidateId: cand.id,
          grade: "disclosure",
        });
      }
    } else if (input.action === "claim") {
      const detail = input.detail.trim();
      cand.decision = "protected";
      cand.claimConfirmed = true;
      cand.humanDetail = detail;
      // The +1 in the inventor's OWN WORDS is the human-conception anchor — captured
      // verbatim as inventor material, tagged inventor_conceived (the Cognitive Delta).
      if (detail) {
        this.ledger.recordInventorSource("inventor_note", detail, [
          "showcase",
          "tree_claim",
          "inventor_conceived",
        ]);
      }
      this.ledger.recordDecision("tree_claimed", ["showcase", "inventor_conceived"], {
        candidateId: cand.id,
        grade: "claim",
      });
    } else if (input.action === "unclaim") {
      cand.decision = undefined;
      cand.claimConfirmed = false;
      cand.humanDetail = undefined;
    } else if (input.action === "drop") {
      cand.decision = cand.decision === "excluded" ? undefined : "excluded";
    }
    this.refreshForest(cardId);
  }

  private async handleSweep(cardId: string, input: SweepInput): Promise<void> {
    const card = this.openCards.get(cardId);
    if (!card || card.type !== "candidate_sweep") return;

    if (input.action === "finalize") {
      // Parked regions leave a gap; excluded regions are dropped as scope honesty.
      for (const c of this.candidates) {
        if (c.decision === "parked") {
          this.recordGaps("enumerator", [
            {
              gap_class: "missing_mechanism",
              field: c.label,
              note: "the inventor parked this region; its mechanism is not settled yet",
            },
          ]);
        }
      }
      this.resolveCard(cardId);
      // Protect opens delta mining (spec §6) — harvest the inventor's own statements of
      // how the mechanism differs in each protected setting, then review. If any
      // protected regions exist, pause on the delta review; otherwise formalize now.
      const protectedRegions = this.candidates.filter((c) => c.decision === "protected");
      if (protectedRegions.length) {
        await this.mineDeltasForProtected(protectedRegions);
        return;
      }
      await this.formalizeKept(
        this.candidates.filter((c) => c.decision === "kept" || c.decision === "protected"),
      );
      return;
    }

    const cand = this.candidates.find((c) => c.id === input.candidateId);
    if (!cand) return;

    // Tap toggles: tapping the current decision clears it back to pending.
    const target =
      input.action === "keep"
        ? "kept"
        : input.action === "protect"
          ? "protected"
          : input.action === "remove"
            ? "excluded"
            : "parked";
    cand.decision = cand.decision === target ? undefined : (target as StoredCandidate["decision"]);

    if (cand.decision === "kept") {
      // Disclosure grade: the inventor confirmed the retrieved region FITS — it does
      // NOT claim they conceived it (R3). Spelled out for the provenance walk.
      this.ledger.recordDecision("region_kept", ["showcase", "inventor_confirmed"], {
        candidateId: cand.id,
        grade: "disclosure",
      });
    } else if (cand.decision === "protected") {
      this.ledger.recordDecision("region_protected", ["showcase", "inventor_confirmed"], {
        candidateId: cand.id,
        grade: "claim",
      });
    } else if (cand.decision === "excluded") {
      this.ledger.recordDecision("region_excluded", ["showcase"], { candidateId: cand.id });
    } else if (cand.decision === "parked") {
      this.ledger.recordDecision("region_parked", ["showcase"], { candidateId: cand.id });
    }
    this.refreshSweep(cardId);
  }

  /**
   * Delta mining (spec §6). For each protected region, a chain harvests the
   * inventor's own statements of how the mechanism differs in that setting (produce
   * → deterministic anchor verify → drop-unanchored). Deltas surface pre-confirmed
   * on a delta review card; the inventor keeps/removes them or marks a region
   * same-as-primary / does-not-apply. Never solicits new conception — only harvests.
   */
  private async mineDeltasForProtected(regions: StoredCandidate[]): Promise<void> {
    const record = [...this.keyConcepts.values()].flatMap((k) => k.verbatim).join("\n");
    const anchored = (q: string) => q.trim().length > 0 && record.includes(q.trim());

    const deltaRegions: DeltaRegion[] = [];
    for (const region of regions) {
      const setting = `${region.label}: ${region.mapping}`;
      const { value: mined } = await runChain<{ quote: string }[]>({
        name: "delta_mining",
        produce: async () => (await runDeltaMiner(this.runAgent, { region: setting, record })).deltas,
        verify: async (ds) => {
          const findings: Finding[] = ds
            .filter((d) => !anchored(d.quote))
            .map((d) => ({
              quote: d.quote || "(empty)",
              citation: "DELTA.anchor",
              rule: "delta quote is not a verbatim substring of the record",
            }));
          return { pass: findings.length === 0, findings };
        },
        fallback: (ds) => ds.filter((d) => anchored(d.quote)),
        onReceipt: (r) => this.recordReceipt(r),
      });

      const seen = new Set<string>();
      const deltas: DeltaCandidate[] = mined
        .filter((d) => {
          const k = d.quote.trim().toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .map((d) => ({
          id: this.genId(),
          regionId: region.id,
          quote: d.quote.trim(),
          decision: "kept" as const, // pre-confirmed; the inventor removes what's wrong
        }));
      region.deltas = deltas;
      deltaRegions.push({ regionId: region.id, regionLabel: region.label, deltas });
    }

    const id = this.genId();
    this.openCards.set(id, { id, type: "delta_review", regions: deltaRegions });
    this.intents.set(id, { kind: "delta_review" });
  }

  /**
   * Resolve the delta review. Per-delta Keep/Edit/Remove; per-region same-as-primary
   * / does-not-apply. On confirm, each protected region reaches CLAIM grade only with
   * ≥1 kept delta; otherwise it drops to disclosure grade with a gap. Then formalize.
   */
  private async handleDeltaReview(cardId: string, input: DeltaReviewInput): Promise<void> {
    const card = this.openCards.get(cardId);
    if (!card || card.type !== "delta_review") return;

    const findDelta = (deltaId: string) => {
      for (const r of card.regions) {
        const d = r.deltas.find((x) => x.id === deltaId);
        if (d) return d;
      }
      return null;
    };

    if (input.action === "keep") {
      const d = findDelta(input.deltaId);
      if (d) d.decision = "kept";
      return;
    }
    if (input.action === "remove") {
      const d = findDelta(input.deltaId);
      if (d) d.decision = "removed";
      return;
    }
    if (input.action === "edit") {
      const d = findDelta(input.deltaId);
      const q = input.quote.trim();
      const record = [...this.keyConcepts.values()].flatMap((k) => k.verbatim).join("\n");
      if (d && q && record.includes(q)) {
        d.quote = q;
        d.decision = "kept";
        this.ledger.recordDecision("delta_edit", ["showcase", "inventor_conceived"], {});
      }
      return;
    }
    if (input.action === "same_as_primary") {
      const r = card.regions.find((x) => x.regionId === input.regionId);
      if (r) {
        r.sameAsPrimary = true;
        r.doesNotApply = false;
      }
      return;
    }
    if (input.action === "does_not_apply") {
      const r = card.regions.find((x) => x.regionId === input.regionId);
      if (r) {
        r.doesNotApply = true;
        r.sameAsPrimary = false;
      }
      return;
    }

    // confirm — settle claim vs disclosure grade per protected region.
    for (const r of card.regions) {
      const cand = this.candidates.find((c) => c.id === r.regionId);
      if (!cand) continue;
      if (r.doesNotApply) {
        cand.decision = "excluded";
        this.ledger.recordDecision("region_excluded", ["showcase"], {
          candidateId: cand.id,
          via: "delta_does_not_apply",
        });
        continue;
      }
      const keptDeltas = r.deltas.filter((d) => d.decision === "kept");
      cand.deltas = keptDeltas;
      cand.sameAsPrimary = !!r.sameAsPrimary;
      // Claim grade requires ≥1 kept delta (region-specific-constraint path is Phase-4
      // depth). Otherwise the protected region rests at disclosure grade + a gap.
      cand.claimConfirmed = keptDeltas.length > 0;
      if (cand.claimConfirmed) {
        this.ledger.recordDecision("region_claim_confirmed", ["showcase"], {
          candidateId: cand.id,
          deltas: keptDeltas.length,
        });
      } else {
        cand.decision = "kept"; // demote protected → disclosure grade
        this.recordGaps("enumerator", [
          {
            gap_class: "missing_mechanism",
            field: cand.label,
            note: "no confirmed delta for this protected region; it rests at disclosure grade",
          },
        ]);
      }
    }

    this.resolveCard(cardId);
    await this.formalizeKept(
      this.candidates.filter((c) => c.decision === "kept" || c.decision === "protected"),
    );
  }

  /** Write each kept candidate into the "Across Implementations" section. */
  private async formalizeKept(kept: StoredCandidate[]): Promise<void> {
    if (!kept.length) {
      this.broadened = true;
      this.complete();
      return;
    }
    const inventorMaterial = [...this.keyConcepts.values()]
      .flatMap((k) => k.verbatim)
      .join("\n");
    const confirmedConstraints = this.confirmedConstraints; // A3: inventor-confirmed, anchored
    const subsections: { title: string; body: string }[] = [];
    for (const c of kept) {
      try {
        const r = await runFormalizer(this.runAgent, {
          card: { label: c.label, source: c.source, mapping: c.mapping, tradeoff: c.tradeoff },
          inventorMaterial,
          confirmedConstraints,
        });
        // Missing substance is a gap the inventor must fill, never authored prose.
        this.recordGaps(
          "formalizer",
          r.gaps.map((g) => ({ ...g, field: c.label })),
        );
        this.ledger.recordMachineEvent("agent_formalized", ["showcase"], { candidateId: c.id });
        if (r.body.trim()) subsections.push({ title: r.title.trim() || c.label, body: r.body.trim() });
      } catch (err) {
        console.error("[showcase] formalizer failed for", c.id, err);
      }
    }
    if (subsections.length) this.appendAcrossImplementations(subsections);
    // The expansion's real work: flow the genus + the chosen ways into every existing
    // artifact — broaden each Key Concept, add the new genus-level Key Concepts, and
    // extend the Abstract / Summary / Background — surfaced on one review screen.
    // (`broadened` stays false until that review is applied, so the stage doesn't
    // auto-advance past it.)
    await this.generateArtifacts(this.keptWaysAsSpecies());
  }

  /** The kept "ways to build it" as implementation context for the broadening pass. */
  private keptWaysAsSpecies(): Species[] {
    return this.candidates
      .filter((c) => c.decision === "kept" || c.decision === "protected")
      .map((c) => ({
        species_type: c.speciesType ?? "ai_native",
        species_name: c.label,
        architectural_description: c.mapping,
        data_flow: "",
        key_components: [],
        technical_improvements: [],
        differentiation_from_siblings: "",
        kept: true,
      }));
  }

  /** Append formalized passages into the Across-Implementations (detail_across) section. */
  private appendAcrossImplementations(subs: { title: string; body: string }[]): void {
    const sections = this.disclosure;
    if (!sections) return;
    const body = subs.map((s) => `${s.title}\n\n${s.body}`).join("\n\n");
    const prior = sections.findIndex((s) => s.key === "detail_across");
    if (prior >= 0) {
      sections[prior] = { ...sections[prior], body: `${sections[prior].body}\n\n${body}`.trim() };
    } else {
      const sec: DisclosureSection = { key: "detail_across", label: DETAIL_ACROSS_LABEL, body };
      const opsIdx = sections.findIndex((s) => s.key === "operations");
      if (opsIdx >= 0) sections.splice(opsIdx + 1, 0, sec);
      else sections.push(sec);
    }
    this.ledger.recordMachineEvent("disclosure_extended", ["showcase", "formalizer"], {
      subsections: subs.length,
    });
  }

  /* ------------------------------------------------------------------ *
   * The broadening pass — the heart of Genus & Species. The genus + the chosen
   * ways flow into every existing artifact so the draft is widened to the genus,
   * not locked to the specific implementation. Runs after the sweep.
   * ------------------------------------------------------------------ */

  /**
   * Generate EVERY expansion artifact (nothing applied yet): a broadened rewrite
   * per Key Concept, the three new Key Concepts, and the Background + Summary +
   * Abstract rewrites — all surfaced on ONE review screen with Regenerate/Keep/
   * Edit/Remove. (The "Across Implementations" detail body is written separately by
   * formalizeKept, so it is not regenerated here.)
   */
  private async generateArtifacts(kept: Species[]): Promise<void> {
    const genus = this.genus;
    if (!genus) return;
    const artifacts: ExpansionArtifact[] = [];
    const sections = this.disclosure;
    const find = (key: string) => sections?.find((s) => s.key === key);

    // D-phase Key Concept generation (spec §7). The original embodiment-level Key
    // Concepts are RETAINED UNCHANGED (deepest retreat positions); broadening only
    // ADDS above and around them — the independent position and the dependent ladder.
    // No per-KC rewrite, no template categories (conceptAspects deleted).

    // D1 — the independent Key Concept for the genus, in three framings.
    try {
      const ind = await runKCIndependent(this.runAgent, {
        genus,
        confirmedConstraints: this.confirmedConstraints,
      });
      const text = [
        ind.method_of_steps.trim() && `As a method of steps:\n${ind.method_of_steps.trim()}`,
        ind.system_of_parts.trim() && `As a system of parts:\n${ind.system_of_parts.trim()}`,
        ind.instructions_on_medium.trim() &&
          `As instructions on a medium:\n${ind.instructions_on_medium.trim()}`,
      ]
        .filter(Boolean)
        .join("\n\n");
      if (text.trim()) {
        artifacts.push({
          id: this.genId(),
          kind: "independent_kc",
          label: `Independent Key Concept — ${ind.label.trim() || genus.genus_name}`,
          text,
          kept: true,
          meta: { title: ind.label.trim() || genus.genus_name },
        });
        this.ledger.recordMachineEvent("agent_kc_independent", ["showcase"], {});
      }
    } catch (err) {
      console.error("[showcase] kc-independent failed", err);
    }

    // D2 — one dependent Key Concept per CLAIM-GRADE region, ordered as a retreat
    // ladder (broadest → narrowest). Claim grade = protected with a confirmed delta.
    const claimRegions = this.candidates.filter(
      (c) => c.decision === "protected" && c.claimConfirmed,
    );
    let ladder = 0;
    for (const region of claimRegions) {
      try {
        // The inventor's own +1 (humanDetail) is the distinguishing limitation of
        // this claim — it leads the material, ahead of any mined deltas/constraints.
        const material = [
          region.humanDetail,
          ...(region.deltas ?? []).map((d) => d.quote),
          ...this.confirmedConstraints,
        ].filter((m): m is string => !!m && m.trim().length > 0);
        const dep = await runKCDependent(this.runAgent, {
          genus,
          regionLabel: region.label,
          regionMaterial: material,
        });
        if (dep.text.trim()) {
          artifacts.push({
            id: this.genId(),
            kind: "dependent_kc",
            label: `Dependent Key Concept — ${dep.label.trim() || region.label}`,
            text: dep.text.trim(),
            kept: true,
            meta: { title: dep.label.trim() || region.label, ladder, regionId: region.id },
          });
          ladder++;
          this.ledger.recordMachineEvent("agent_kc_dependent", ["showcase"], {
            regionId: region.id,
          });
        }
      } catch (err) {
        console.error("[showcase] kc-dependent failed for", region.id, err);
      }
    }

    // Background + Summary extensions.
    const bg = find("background");
    if (bg) {
      try {
        const r = await runBackgroundExtender(this.runAgent, { genus, species: kept, existing: bg.body });
        if (r.additional.trim()) {
          artifacts.push({
            id: this.genId(),
            kind: "background_ext",
            label: "Background Extension",
            text: r.additional.trim(),
            kept: true,
          });
        }
      } catch (err) {
        console.error("[showcase] background-extender failed", err);
      }
    }
    const sum = find("summary");
    if (sum) {
      try {
        const r = await runSummaryExtender(this.runAgent, { genus, species: kept, existing: sum.body });
        if (r.additional.trim()) {
          artifacts.push({
            id: this.genId(),
            kind: "summary_ext",
            label: "Summary Extension",
            text: r.additional.trim(),
            kept: true,
          });
        }
      } catch (err) {
        console.error("[showcase] summary-extender failed", err);
      }
    }

    // The Abstract rewrite (word-counted).
    const abs = find("abstract");
    if (abs) {
      try {
        const r = await runAbstractRewriter(this.runAgent, { genus, species: kept, existing: abs.body });
        if (r.abstract.trim()) {
          const words = r.word_count || r.abstract.trim().split(/\s+/).length;
          artifacts.push({
            id: this.genId(),
            kind: "abstract_rewrite",
            label: `Abstract Rewrite (${words} words)`,
            text: r.abstract.trim(),
            kept: true,
            meta: { wordCount: words },
          });
        }
      } catch (err) {
        console.error("[showcase] abstract-rewriter failed", err);
      }
    }

    if (!artifacts.length) {
      // Nothing to broaden, but the Across-Implementations write already happened —
      // the stage did its work, so mark it done rather than looping.
      this.broadened = true;
      this.complete();
      return;
    }
    // Module exit evaluation (spec §8): score the rendered set from four perspectives
    // and apply one refinement pass BEFORE the final review. Non-blocking — it
    // refines; the deterministic checks and traceability verifies are what gate.
    await this.runExitEvaluation(artifacts);
    const id = this.genId();
    this.openCards.set(id, { id, type: "expansion_review", artifacts });
    this.intents.set(id, { kind: "expansion_review" });
    this.phase = "reviewing_artifacts";
  }

  /**
   * The four-perspective exit evaluation (spec §8). Scores the rendered artifact set +
   * Key Concepts (mathematician / engineer / philosopher / artist). Any perspective
   * below 7 triggers exactly ONE refinement pass — regenerating the Key Concept
   * artifacts — then a rescore. Scores persist either way. This refines; it never
   * blocks (blocking belongs to the deterministic checks and traceability verifies).
   */
  private async runExitEvaluation(artifacts: ExpansionArtifact[]): Promise<void> {
    const kcs = [...this.keyConcepts.values()].map((k) => ({
      title: k.title,
      statement: k.broadened || k.statement,
    }));
    const payload = () => artifacts.map((a) => ({ label: a.label, text: a.text }));
    try {
      const first = await runExitEvaluator(this.runAgent, { keyConcepts: kcs, artifacts: payload() });
      this.ledger.recordMachineEvent("exit_evaluation", ["showcase"], {
        scores: first.perspectives.map((p) => ({ name: p.name, score: p.score })),
      });
      const below7 = first.perspectives.filter((p) => p.score < 7);
      if (below7.length) {
        // One targeted refinement: regenerate the Key Concept artifacts, then rescore.
        for (const a of artifacts) {
          if (a.kind === "independent_kc" || a.kind === "dependent_kc") {
            await this.regenerateArtifact(a);
          }
        }
        const second = await runExitEvaluator(this.runAgent, {
          keyConcepts: kcs,
          artifacts: payload(),
        });
        this.ledger.recordMachineEvent("exit_evaluation_rescore", ["showcase"], {
          scores: second.perspectives.map((p) => ({ name: p.name, score: p.score })),
        });
      }
      this.recordReceipt({
        chain: "exit_evaluation",
        outcome: below7.length ? "repaired" : "verified_clean",
        findings: first.perspectives.flatMap((p) =>
          p.findings
            .filter((f) => f.quote.trim())
            .map((f) => ({
              quote: f.quote,
              citation: `EXIT.${p.name}.${p.score}`,
              rule: f.note || `${p.name} shortfall`,
            })),
        ),
      });
    } catch (err) {
      console.error("[showcase] exit evaluation failed", err);
    }
  }

  /** GATE 2 actions: per-artifact review; Finalize applies the kept ones. */
  private async handleExpansionReview(cardId: string, input: ExpansionReviewInput): Promise<void> {
    const card = this.openCards.get(cardId);
    if (!card || card.type !== "expansion_review") return;

    if (input.action === "keep" || input.action === "remove") {
      const a = card.artifacts.find((x) => x.id === input.artifactId);
      if (a) a.kept = input.action === "keep";
      return;
    }
    if (input.action === "edit") {
      const a = card.artifacts.find((x) => x.id === input.artifactId);
      const text = input.text.trim();
      if (a && text) {
        a.text = text;
        a.kept = true;
        this.ledger.recordInventorSource("inventor_edit", text, ["showcase", "artifact-edit", a.kind]);
      }
      return;
    }
    if (input.action === "regenerate") {
      const a = card.artifacts.find((x) => x.id === input.artifactId);
      if (a) await this.regenerateArtifact(a);
      return;
    }
    // finalize — weave every kept artifact into the Key Concepts + the draft.
    const applied = await this.finalizeExpansion(card.artifacts.filter((a) => a.kept));
    if (!applied) {
      // The rendering contract blocked the write; nothing was applied. Keep the
      // review open and surface the block rather than advancing silently.
      this.pushTurn({
        role: "helper",
        text: "The draft couldn't be applied — a rendering check failed (an enumeration or cross-reference didn't hold), so nothing was written. The review is still here to adjust.",
      });
      return;
    }
    this.resolveCard(cardId);
    this.complete();
  }

  /** Re-run the one generator behind an artifact; keep the old text on failure. */
  private async regenerateArtifact(a: ExpansionArtifact): Promise<void> {
    const genus = this.genus;
    const kept = this.keptWaysAsSpecies();
    if (!genus || !kept.length) return;
    const sections = this.disclosure;
    const find = (key: string) => sections?.find((s) => s.key === key);
    try {
      if (a.kind === "broadened_kc" && a.meta?.conceptId) {
        const kc = this.keyConcepts.get(a.meta.conceptId);
        if (!kc) return;
        const b = await runKeyConceptBroadener(this.runAgent, {
          original: kc.statement,
          genus,
          approvedSpecies: kept,
          consciousness: this.consciousness.renderForAgent({ part: `differentiation:${kc.id}` }),
        });
        if (b.broadened_concept_text.trim()) a.text = b.broadened_concept_text.trim();
      } else if (a.kind === "new_kc" && a.meta?.aspect) {
        const existing = [...this.keyConcepts.values()].map((k) => ({
          title: k.title,
          statement: k.statement,
        }));
        const r = await runKeyConceptAppender(this.runAgent, {
          genus,
          species: kept,
          existing,
          aspect: a.meta.aspect as ConceptAspect,
        });
        if (r.key_concept_text.trim()) {
          a.text = r.key_concept_text.trim();
          a.meta = { ...a.meta, title: r.title.trim() || a.meta.title };
        }
      } else if (a.kind === "background_ext") {
        const bg = find("background");
        if (!bg) return;
        const r = await runBackgroundExtender(this.runAgent, { genus, species: kept, existing: bg.body });
        if (r.additional.trim()) a.text = r.additional.trim();
      } else if (a.kind === "summary_ext") {
        const sum = find("summary");
        if (!sum) return;
        const r = await runSummaryExtender(this.runAgent, { genus, species: kept, existing: sum.body });
        if (r.additional.trim()) a.text = r.additional.trim();
      } else if (a.kind === "detail_ext") {
        const existingDetail = ["architecture", "data_structures", "operations"]
          .map((k) => find(k)?.body ?? "")
          .filter(Boolean)
          .join("\n\n");
        const dd = await runDetailDescriptionExtender(this.runAgent, {
          genus,
          species: kept,
          existing: existingDetail,
        });
        const body = dd.subsections
          .filter((s) => s.subsection_content.trim())
          .map((s) =>
            s.subsection_title.trim()
              ? `${s.subsection_title.trim()}\n\n${s.subsection_content.trim()}`
              : s.subsection_content.trim(),
          )
          .join("\n\n");
        if (body.trim()) a.text = body.trim();
      } else if (a.kind === "abstract_rewrite") {
        const abs = find("abstract");
        if (!abs) return;
        const r = await runAbstractRewriter(this.runAgent, { genus, species: kept, existing: abs.body });
        if (r.abstract.trim()) {
          const words = r.word_count || r.abstract.trim().split(/\s+/).length;
          a.text = r.abstract.trim();
          a.label = `Abstract Rewrite (${words} words)`;
          a.meta = { ...a.meta, wordCount: words };
        }
      } else if (a.kind === "independent_kc") {
        const ind = await runKCIndependent(this.runAgent, {
          genus,
          confirmedConstraints: this.confirmedConstraints,
        });
        const text = [
          ind.method_of_steps.trim() && `As a method of steps:\n${ind.method_of_steps.trim()}`,
          ind.system_of_parts.trim() && `As a system of parts:\n${ind.system_of_parts.trim()}`,
          ind.instructions_on_medium.trim() &&
            `As instructions on a medium:\n${ind.instructions_on_medium.trim()}`,
        ]
          .filter(Boolean)
          .join("\n\n");
        if (text.trim()) {
          a.text = text;
          a.label = `Independent Key Concept — ${ind.label.trim() || genus.genus_name}`;
        }
      } else if (a.kind === "dependent_kc") {
        const region = this.candidates.find((c) => c.id === a.meta?.regionId);
        if (region) {
          const material = [
            ...(region.deltas ?? []).map((d) => d.quote),
            ...this.confirmedConstraints,
          ].filter(Boolean);
          const dep = await runKCDependent(this.runAgent, {
            genus,
            regionLabel: region.label,
            regionMaterial: material,
          });
          if (dep.text.trim()) {
            a.text = dep.text.trim();
            a.label = `Dependent Key Concept — ${dep.label.trim() || region.label}`;
          }
        }
      }
      a.kept = true;
    } catch (err) {
      console.error("[showcase] regenerate failed for", a.kind, err);
    }
  }

  /** Apply the kept artifacts: broadened + new Key Concepts, section weaves. */
  /** Write a chain receipt to the quality ledger (R1 — every chain leaves one). */
  private recordReceipt(r: Receipt): void {
    this.ledger.recordMachineEvent("quality_receipt", ["showcase", r.chain, r.outcome], {
      receipt: r,
    });
  }

  /**
   * The Coverage Ledger (spec §8): per genus, per axis, every region with its
   * status, decision, grade, and anchors. Shows a reviewer in minutes that scope was
   * walked and where every fallback sits; it is the evidence spine the Proof of Human
   * Conception certifies against. Recorded to the Ledger at apply.
   */
  private recordCoverageLedger(): void {
    const byAxis = new Map<string, unknown[]>();
    for (const c of this.candidates) {
      const axis = c.axisId ?? "approach";
      if (!byAxis.has(axis)) byAxis.set(axis, []);
      const grade =
        c.decision === "protected" && c.claimConfirmed
          ? "claim"
          : c.decision === "kept" || c.decision === "protected"
            ? "disclosure"
            : undefined;
      byAxis.get(axis)!.push({
        region: c.label,
        status: c.decision ?? "pending",
        grade,
        anchors: (c.deltas ?? []).map((d) => d.quote),
      });
    }
    this.ledger.recordMachineEvent("coverage_ledger", ["showcase"], {
      genus: this.genus?.genus_name ?? "",
      axes: [...byAxis.entries()].map(([axis, regions]) => ({ axis, regions })),
    });
  }

  /**
   * Apply the kept artifacts. Snapshots the disclosure + Key Concepts BEFORE the
   * write (the undo point), mutates in place, then runs the deterministic rendering
   * contract over the assembled result. A contract failure reverts to the snapshot
   * and returns false so the caller keeps the review open and surfaces the block
   * (spec §8). Returns true when the write committed.
   */
  private async finalizeExpansion(kept: ExpansionArtifact[]): Promise<boolean> {
    const sections = this.disclosure;
    const find = (key: string) => sections?.find((s) => s.key === key);

    // Snapshot before apply (spec §8) — deep-copy sections + Key Concepts so a
    // contract failure can revert cleanly.
    const snapDisclosure = sections ? sections.map((s) => ({ ...s })) : null;
    const snapKCs = [...this.keyConcepts.entries()].map(
      ([id, kc]) =>
        [id, { ...kc, verbatim: [...kc.verbatim] }] as [string, ShowcaseKeyConcept],
    );

    for (const a of kept) {
      if (a.kind === "broadened_kc" && a.meta?.conceptId) {
        const kc = this.keyConcepts.get(a.meta.conceptId);
        if (kc) {
          kc.broadened = a.text;
          await this.recordBroadenedToConsciousness(kc, a.text);
        }
      } else if (a.kind === "new_kc" && a.meta?.aspect) {
        const id = `appended:${a.meta.aspect}`;
        this.keyConcepts.set(id, {
          id,
          title: a.meta.title || a.label,
          statement: a.text,
          verbatim: [],
        });
      } else if (a.kind === "independent_kc") {
        // D1 — the three-framing independent position, added ABOVE the originals
        // (which are retained unchanged as the deepest retreat positions).
        this.keyConcepts.set(a.id, {
          id: a.id,
          title: a.meta?.title || a.label,
          statement: a.text,
          verbatim: [],
        });
      } else if (a.kind === "dependent_kc") {
        // D2 — a dependent position on the retreat ladder.
        this.keyConcepts.set(a.id, {
          id: a.id,
          title: a.meta?.title || a.label,
          statement: a.text,
          verbatim: [],
        });
      } else if (a.kind === "background_ext") {
        const bg = find("background");
        if (bg) bg.body = `${bg.body}\n\n${a.text}`;
      } else if (a.kind === "summary_ext") {
        const sum = find("summary");
        if (sum) sum.body = `${sum.body}\n\n${a.text}`;
      } else if (a.kind === "detail_ext" && sections) {
        const prior = sections.findIndex((s) => s.key === "detail_across");
        if (prior >= 0) sections.splice(prior, 1);
        const sec: DisclosureSection = {
          key: "detail_across",
          label: DETAIL_ACROSS_LABEL,
          body: a.text,
        };
        const opsIdx = sections.findIndex((s) => s.key === "operations");
        if (opsIdx >= 0) sections.splice(opsIdx + 1, 0, sec);
        else sections.push(sec);
      } else if (a.kind === "abstract_rewrite") {
        const abs = find("abstract");
        if (abs) abs.body = a.text;
      }
    }

    // Rendering contract gate (spec §8). Dormant on today's prose; load-bearing
    // once §112 enumerations render. A failure reverts to the snapshot and blocks.
    const findings = sections ? checkRenderingContract(sections) : [];
    if (findings.length) {
      if (snapDisclosure && this.disclosure) {
        this.disclosure.splice(0, this.disclosure.length, ...snapDisclosure);
      }
      this.keyConcepts = new Map(snapKCs);
      this.recordReceipt({ chain: "apply", outcome: "fell_back", findings });
      return false;
    }

    this.recordReceipt({ chain: "apply", outcome: "verified_clean", findings: [] });
    // The Coverage Ledger — the evidence spine, recorded at apply (spec §8).
    this.recordCoverageLedger();
    // The stage is done regardless of how many broadenings the inventor kept — the
    // Across-Implementations write already happened in formalizeKept.
    this.broadened = true;
    this.ledger.recordMachineEvent("disclosure_extended", ["showcase"], {
      applied: kept.length,
      sections: sections?.length ?? 0,
    });
    return true;
  }

  private async handleVariation(cardId: string, intent: Intent, input: VariationInput): Promise<void> {
    if (intent.kind !== "variation") return;
    const sp = this.species.find((s) => s.species_type === intent.speciesType);
    if (sp) sp.kept = input.action === "keep";
    this.ledger.recordDecision("variation_action", ["showcase", input.action], {
      speciesType: intent.speciesType,
    });
    this.resolveCard(cardId);
    if (![...this.openCards.values()].some((c) => c.type === "variation")) {
      await this.applyBroadening();
    }
  }

  private async applyBroadening(): Promise<void> {
    const kept = this.species.filter((s) => s.kept);
    if (kept.length === 0 || !this.genus) {
      this.broadened = false;
      this.complete();
      return;
    }
    const inventorMaterial = (kc: ShowcaseKeyConcept) => kc.verbatim.join("\n");
    for (const kc of this.keyConcepts.values()) {
      try {
        const b = await runKeyConceptBroadener(this.runAgent, {
          original: kc.statement,
          genus: this.genus,
          approvedSpecies: kept,
          consciousness: this.consciousness.renderForAgent({ part: `differentiation:${kc.id}` }),
        });
        const verdict = await runVerifier(this.runAgent, {
          piece: b.broadened_concept_text,
          inventorMaterial: inventorMaterial(kc),
          consciousness: this.consciousness.renderForAgent({ part: `differentiation:${kc.id}` }),
        });
        this.ledger.recordMachineEvent("agent_broadened", ["showcase"], { conceptId: kc.id });
        if (verdict.verdict === "pass" && b.broadened_concept_text.trim()) {
          this.emitWidenedReview(kc, b.broadened_concept_text);
        } else {
          this.ledger.recordMachineEvent("broadening_withheld", ["showcase", "concept"], {
            conceptId: kc.id,
            reason: verdict.note,
          });
        }
      } catch (err) {
        console.error("[showcase] broadening failed for", kc.id, err);
      }
    }
    // The 5c second pass: enrich the disclosure prose across the kept
    // implementations and append the genus/species/hardware Key Concepts. This is
    // the multi-paradigm depth — it applies once species are kept, independent of
    // whether individual per-concept broadenings survive the Boundary.
    await this.enrichDisclosure(kept);
    this.broadened = true;

    if (![...this.openCards.values()].some((c) => c.type === "widened_review")) {
      this.complete();
      return;
    }
    this.phase = "approving_widened";
  }

  /**
   * The 5c "extender" pass — enrich the carried Invention Disclosure across the
   * approved implementations, mutating it in place so export + reload carry the
   * richer document, and append the genus/species/hardware Key Concepts.
   */
  private async enrichDisclosure(kept: Species[]): Promise<void> {
    if (!this.genus || kept.length === 0) return;
    const genus = this.genus;

    // Append the genus / species-spectrum / hardware Key Concepts (2–3 of V1's 7).
    await this.appendKeyConcepts(genus, kept);

    const sections = this.disclosure;
    if (!sections) return;
    const find = (key: string) => sections.find((s) => s.key === key);
    const bg = find("background");
    const sum = find("summary");
    const abs = find("abstract");
    // Re-run guard: a detail_across section means enrichment already ran once.
    // Appending background/summary again would duplicate prose — skip those;
    // the abstract REWRITE and the detail_across REPLACE below stay safe.
    const alreadyEnriched = sections.some((s) => s.key === "detail_across");

    // Append to background + summary, replace the abstract — each mutates a
    // different section object, so they run in parallel.
    await Promise.all([
      (async () => {
        if (!bg || alreadyEnriched) return;
        try {
          const r = await runBackgroundExtender(this.runAgent, { genus, species: kept, existing: bg.body });
          if (r.additional.trim()) bg.body = `${bg.body}\n\n${r.additional.trim()}`;
        } catch (err) {
          console.error("[showcase] background-extender failed", err);
        }
      })(),
      (async () => {
        if (!sum || alreadyEnriched) return;
        try {
          const r = await runSummaryExtender(this.runAgent, { genus, species: kept, existing: sum.body });
          if (r.additional.trim()) sum.body = `${sum.body}\n\n${r.additional.trim()}`;
        } catch (err) {
          console.error("[showcase] summary-extender failed", err);
        }
      })(),
      (async () => {
        if (!abs) return;
        try {
          const r = await runAbstractRewriter(this.runAgent, { genus, species: kept, existing: abs.body });
          if (r.abstract.trim()) abs.body = r.abstract.trim();
        } catch (err) {
          console.error("[showcase] abstract-rewriter failed", err);
        }
      })(),
    ]);

    // Add the new "Detailed Description" (across-implementations) section after
    // Operations (sequential — it splices the sections array). V1 shape: a fixed
    // order of subsections (mechanism → one per species → improvements → hardware),
    // assembled here into one section body with inline subsection titles.
    try {
      const existingDetail = ["architecture", "data_structures", "operations"]
        .map((k) => find(k)?.body ?? "")
        .filter(Boolean)
        .join("\n\n");
      const dd = await runDetailDescriptionExtender(this.runAgent, {
        genus,
        species: kept,
        existing: existingDetail,
      });
      const body = dd.subsections
        .filter((s) => s.subsection_content.trim())
        .map((s) =>
          s.subsection_title.trim()
            ? `${s.subsection_title.trim()}\n\n${s.subsection_content.trim()}`
            : s.subsection_content.trim(),
        )
        .join("\n\n");
      if (body.trim()) {
        // REPLACE any prior detail_across (re-runs must not duplicate the section).
        const prior = sections.findIndex((s) => s.key === "detail_across");
        if (prior >= 0) sections.splice(prior, 1);
        const sec: DisclosureSection = {
          key: "detail_across",
          label: DETAIL_ACROSS_LABEL,
          body: body.trim(),
        };
        const opsIdx = sections.findIndex((s) => s.key === "operations");
        if (opsIdx >= 0) sections.splice(opsIdx + 1, 0, sec);
        else sections.push(sec);
      }
    } catch (err) {
      console.error("[showcase] detail-description-extender failed", err);
    }

    this.ledger.recordMachineEvent("disclosure_extended", ["showcase"], {
      sections: sections.length,
    });
  }

  /** Append the genus_mechanism / species_spectrum / hardware_optimization concepts. */
  private async appendKeyConcepts(genus: Genus, kept: Species[]): Promise<void> {
    const aspects: ConceptAspect[] = [
      "genus_mechanism",
      "species_spectrum",
      "hardware_optimization",
    ];
    for (const aspect of aspects) {
      try {
        const existing = [...this.keyConcepts.values()].map((k) => ({
          title: k.title,
          statement: k.broadened || k.statement,
        }));
        const r = await runKeyConceptAppender(this.runAgent, {
          genus,
          species: kept,
          existing,
          aspect,
        });
        if (r.key_concept_text.trim()) {
          const id = `appended:${aspect}`;
          this.keyConcepts.set(id, {
            id,
            title: r.title.trim() || aspect.replace(/_/g, " "),
            statement: r.key_concept_text.trim(),
            verbatim: [],
          });
          this.ledger.recordMachineEvent("agent_appended_concept", ["showcase", aspect], {});
        }
      } catch (err) {
        console.error("[showcase] key-concept-appender failed for", aspect, err);
      }
    }
  }

  private async handleWidened(cardId: string, intent: Intent, input: WidenedActionInput): Promise<void> {
    if (intent.kind !== "widened") return;
    const card = this.openCards.get(cardId);
    const kc = this.keyConcepts.get(intent.conceptId);
    this.ledger.recordDecision("widened_action", ["showcase", input.action], {
      conceptId: intent.conceptId,
    });
    if (kc && card && card.type === "widened_review") {
      if (input.action === "approve") {
        kc.broadened = card.broadened;
        await this.recordBroadenedToConsciousness(kc, card.broadened);
      } else if (input.action === "request_edit") {
        const correction = input.correction.trim();
        if (correction) {
          const e = this.ledger.recordInventorSource("inventor_edit", correction, [
            "showcase",
            "broadened-correction",
          ]);
          kc.broadened = correction;
          await this.recordBroadenedToConsciousness(kc, correction, e.id);
        }
      }
      // discard → leave the Key Concept unbroadened.
    }
    this.resolveCard(cardId);
    if (![...this.openCards.values()].some((c) => c.type === "widened_review")) {
      // The disclosure was already enriched across implementations in
      // applyBroadening, so the broadening path stays marked applied.
      this.broadened = true;
      this.complete();
    }
  }

  /** Record an accepted broadened Key Concept to the Shared Consciousness. */
  private async recordBroadenedToConsciousness(
    kc: ShowcaseKeyConcept,
    text: string,
    inventorLedgerId?: string,
  ): Promise<void> {
    const prior = this.consciousness.current(`differentiation:${kc.id}`);
    const entry = this.consciousness.record({
      part: `broadened:${kc.id}`,
      content: text,
      why: `broadened, meaning-preserving form of Key Concept "${kc.title}"`,
      agent: "key-concept-broadener",
      derivedFrom: prior ? [prior.id] : [],
      ...(inventorLedgerId ? { tracesTo: [inventorLedgerId] } : {}),
    });
    try {
      const verdict = await runVerifier(this.runAgent, {
        piece: text,
        inventorMaterial: kc.verbatim.join("\n"),
        consciousness: this.consciousness.renderForAgent({ part: `broadened:${kc.id}` }),
      });
      this.consciousness.verify(entry.id, {
        by: "verifier",
        verdict: verdict.verdict,
        ...(verdict.note ? { note: verdict.note } : {}),
      });
    } catch (err) {
      console.error("[showcase] broadened verify failed for", kc.id, err);
    }
  }

  private complete(): void {
    this.phase = "ready";
    this.ledger.recordMachineEvent("module_completed", ["module5"], {
      broadened: this.broadened,
    });
  }

  private maybeCheckpoint(): void {
    if (this.isComplete() && !hasCheckpoint(this.ledger, "module5")) {
      sealCheckpoint(this.ledger, "module5");
    }
  }

  private isComplete(): boolean {
    return this.phase === "ready";
  }

  /* ------------------------------------------------------------------ *
   * Card emitters
   * ------------------------------------------------------------------ */

  private emitVariation(sp: Species): void {
    const id = this.genId();
    this.openCards.set(id, {
      id,
      type: "variation",
      speciesType: sp.species_type,
      name: sp.species_name,
      description: sp.architectural_description,
      improvements: sp.technical_improvements,
      actions: ["keep", "drop"],
    });
    this.intents.set(id, { kind: "variation", speciesType: sp.species_type });
  }

  private emitWidenedReview(kc: ShowcaseKeyConcept, broadened: string): void {
    const id = this.genId();
    this.openCards.set(id, {
      id,
      type: "widened_review",
      conceptId: kc.id,
      title: kc.title,
      original: kc.statement,
      broadened,
      actions: ["approve", "discard", "request_edit"],
    });
    this.intents.set(id, { kind: "widened", conceptId: kc.id });
  }

  private resolveCard(cardId: string): void {
    this.openCards.delete(cardId);
    this.intents.delete(cardId);
  }

  /* ------------------------------------------------------------------ *
   * Persistence
   * ------------------------------------------------------------------ */

  toSnapshot(): ShowcaseSnapshot {
    return {
      phase: this.phase,
      started: this.started,
      keyConcepts: [...this.keyConcepts.values()].map(cloneKC),
      genus: this.genus ? { ...this.genus } : null,
      species: this.species.map((s) => ({ ...s })),
      broadened: this.broadened,
      disclosure: this.disclosure ? this.disclosure.map((s) => ({ ...s })) : null,
      openCards: [...this.openCards.values()],
      intents: [...this.intents.entries()],
      conversation: this.conversation.map((t) => ({ ...t })),
      ledger: this.ledger.serialize(),
      drawings: this.drawings.map((d) => ({ ...d, numerals: [...d.numerals] })),
      // Gaps live in the Ledger (serialized above), not as a separate array.
      criterion: this.criterion ? { ...this.criterion } : null,
      criterionEntryId: this.criterionEntryId,
      candidates: this.candidates.map((c) => ({ ...c, grade: { ...c.grade } })),
      confirmedConstraints: [...this.confirmedConstraints],
    };
  }

  static fromSnapshot(snap: ShowcaseSnapshot, deps: ShowcaseDeps): ShowcaseModule {
    const now = deps.now ?? (() => new Date().toISOString());
    const genId = deps.genId ?? defaultGenId;
    const ledger = EvidenceLedger.fromEntries(snap.ledger, SHOWCASE_HUMAN_SOURCE_TYPES, now, genId);
    const m = new ShowcaseModule({ ...deps, keyConcepts: [], disclosure: snap.disclosure ?? undefined, ledger });
    m.phase = snap.phase;
    m.started = snap.started;
    m.keyConcepts = new Map(snap.keyConcepts.map((k) => [k.id, cloneKC(k)]));
    m.genus = snap.genus;
    m.species = snap.species.map((s) => ({ ...s }));
    m.broadened = snap.broadened;
    m.disclosure = snap.disclosure;
    m.openCards = new Map(snap.openCards.map((c) => [c.id, c]));
    m.intents = new Map(snap.intents);
    m.conversation = (snap.conversation ?? []).map((t) => ({ ...t }));
    m.drawings = (snap.drawings ?? []).map((d) => ({ ...d, numerals: [...d.numerals] }));
    // Gaps are re-derived from the restored Ledger; nothing to assign here.
    m.criterion = snap.criterion ?? null;
    m.criterionEntryId = snap.criterionEntryId ?? null;
    m.candidates = (snap.candidates ?? []).map((c) => ({ ...c, grade: { ...c.grade } }));
    m.confirmedConstraints = [...(snap.confirmedConstraints ?? [])];
    return m;
  }
}

/* ------------------------------------------------------------------ */

function cloneKC(k: ShowcaseKeyConcept): ShowcaseKeyConcept {
  return { ...k, verbatim: [...k.verbatim] };
}

/**
 * Heal a section body that was compiled + saved as a leaked `{"body":"…"}` JSON
 * envelope (from before the disclosure guard existed), so the draft shows prose.
 */
function unwrapBody(raw: string): string {
  const t = (raw ?? "").trim();
  if (!t.startsWith("{") || !t.includes('"body"')) return raw;
  try {
    const o = JSON.parse(t);
    if (o && typeof o.body === "string") return o.body.trim();
  } catch {
    // Not valid JSON (truncated / unescaped quotes) — strip the envelope by hand.
  }
  const m = t.match(/^\{\s*"body"\s*:\s*"([\s\S]*)$/);
  if (m) {
    return m[1]
      .replace(/"\s*\}\s*$/, "") // drop a trailing "}
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .trim();
  }
  return raw;
}

/** Single source of truth for the broadening-added section's tab label. */
const DETAIL_ACROSS_LABEL = "Detailed Description";

/**
 * Normalize a disclosure section for display/export: unwrap any JSON body
 * envelope and force the across-implementations section's label. This keeps it
 * reading "Detailed Description" no matter what's persisted — projects whose
 * saved state predates the rename, or an enrichment re-run whose extender failed
 * and left an older label, all render correctly here.
 */
function normalizeDisclosureSection(s: DisclosureSection): DisclosureSection {
  return {
    ...s,
    label: s.key === "detail_across" ? DETAIL_ACROSS_LABEL : s.label,
    body: unwrapBody(s.body),
  };
}

function defaultGenId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `s_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}
