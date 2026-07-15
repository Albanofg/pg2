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
  runSectionPolisher,
  runSummaryExtender,
  runVerifier,
  type ConceptAspect,
  type SectionPolishMode,
} from "./agents";
import { SHOWCASE_CONFIG } from "./config";
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
  | { kind: "sweep" };

/** A graded candidate plus its sweep bookkeeping (controller-internal). */
type StoredCandidate = GradedCandidate & {
  // "shown" = surfaced on the sweep; "rejected" = a duplicate or failure, deleted.
  bucket: "shown" | "rejected";
  surfaced: boolean;
  decision?: "kept" | "dismissed";
  /** A mandatory standard build-style — always present, never graded or dropped. */
  mandatory?: boolean;
  /** The build-style tag for a mandatory card (provenance only; never shown). */
  speciesType?: SpeciesType;
};

/**
 * The three mandatory build-styles, in the order they're always shown first. Each
 * carries its OWN family so they sit among the emergent ways as equals — never
 * clustered under a "standard ways" umbrella. The text here is only a fallback for
 * when the Baseline Builder omits a style or fails — the agent's plain,
 * invention-specific card overrides it whenever present.
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
      | SweepInput,
  ): Promise<Module5View> {
    const card = this.openCards.get(cardId);
    const intent = this.intents.get(cardId);
    if (!card || !intent) return this.view();

    switch (card.type) {
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
    for (const [id, c] of [...this.openCards]) {
      if (
        c.type === "choice" ||
        c.type === "variation" ||
        c.type === "widened_review" ||
        c.type === "expansion_review" ||
        c.type === "criterion" ||
        c.type === "candidate_sweep"
      ) {
        this.resolveCard(id);
      }
    }
    this.species = [];
    // Reset Layer 4/5 working state so a re-run starts the criterion/sweep clean.
    this.criterion = null;
    this.criterionEntryId = null;
    this.candidates = [];
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

  private async generateVariations(): Promise<void> {
    // A (re-)run means the broadening has NOT been applied yet, so reset the flag.
    // Without this, restarting the stage after a prior completion left `broadened`
    // true, and the client auto-advanced to the draft the moment the sweep resolved —
    // jumping past the broadening review (part 2) and stranding it on this page.
    this.broadened = false;
    // Genus — the paradigm-neutral mechanism beneath the Key Concepts.
    const kcs = [...this.keyConcepts.values()];
    try {
      const { gaps: genusGaps, ...genus } = await runGenusExtractor(this.runAgent, {
        keyConcepts: kcs.map((k) => ({ title: k.title, statement: k.statement })),
        verbatim: kcs.flatMap((k) => k.verbatim),
      });
      this.genus = genus;
      this.ledger.recordMachineEvent("agent_genus", ["showcase"], {});
      // Constraints/invariants the inputs didn't supply are simply left empty — a
      // thin genus still yields the forest. We do NOT surface these as gaps: they
      // concern an internal distillation step the inventor never sees, so a card
      // about them is noise. (Genus stays POHC-safe by never AUTHORING the missing
      // substance — see the extractor prompt.) `genusGaps` is intentionally dropped.
      void genusGaps;
    } catch (err) {
      console.error("[showcase] genus extraction failed", err);
      this.complete(); // can't go on without a genus
      return;
    }

    // Size the invention: how many genuinely distinct build-directions ("trees")
    // does this genus ("forest") warrant? Narrow → a few; broad → many. The count
    // is assessed per ICB case, not fixed at three.
    let band: "narrow" | "moderate" | "broad" = "moderate";
    try {
      const b = await runBreadthAssessor(this.runAgent, {
        genus: this.genus,
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
    const confirmedConstraints: string[] = []; // Layer 1 (constraint discovery) is Phase 2.

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

    // Merge: the three mandatory build-styles first (shown first), then the emergent forest.
    this.candidates = [...mandatory, ...emergent];
    const id = this.genId();
    this.openCards.set(id, this.buildSweepCard(id));
    this.intents.set(id, { kind: "sweep" });
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
        family: style.family,
        label: (got?.label ?? "").trim() || style.label,
        source: (got?.source ?? "").trim() || style.source,
        mapping: (got?.mapping ?? "").trim() || style.mapping,
        tradeoff: (got?.tradeoff ?? "").trim() || style.tradeoff,
        grade,
        bucket: "shown" as const,
        surfaced: true,
        mandatory: true,
        speciesType: style.type,
      };
    });
  }

  /** Build the sweep card grouped by the emergent families (in ranked order). */
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
          status: c.decision === "kept" ? ("kept" as const) : ("pending" as const),
        }));
      if (items.length > 0) groups.push({ family, items });
    }
    return { id, type: "candidate_sweep", groups };
  }

  private refreshSweep(cardId: string): void {
    this.openCards.set(cardId, this.buildSweepCard(cardId));
  }

  private async handleSweep(cardId: string, input: SweepInput): Promise<void> {
    const card = this.openCards.get(cardId);
    if (!card || card.type !== "candidate_sweep") return;

    if (input.action === "keep") {
      const cand = this.candidates.find((c) => c.id === input.candidateId);
      if (!cand) return;
      if (cand.decision === "kept") {
        cand.decision = undefined; // toggle off
      } else {
        // Keep-many: a broad invention wants lots of trees, so the inventor keeps
        // as many as fit (duplicates are already deleted by the grader). The keep
        // confirms the candidate FITS the invention — it does NOT claim the inventor
        // conceived it (it was retrieved). Spelled out for the provenance walk.
        cand.decision = "kept";
        this.ledger.recordDecision("candidate_kept", ["showcase", "inventor_confirmed"], {
          candidateId: cand.id,
          meaning:
            "inventor confirmed this enumerated candidate fits their invention; the candidate was retrieved, not conceived by the inventor",
        });
      }
      this.refreshSweep(cardId);
      return;
    }
    // finalize — write up the one picked per group.
    this.resolveCard(cardId);
    await this.formalizeKept(this.candidates.filter((c) => c.decision === "kept"));
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
    const confirmedConstraints: string[] = [];
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
      .filter((c) => c.decision === "kept")
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

    // Broadened rewrite per Key Concept (verifier-gated).
    const kcs = [...this.keyConcepts.values()];
    for (let i = 0; i < kcs.length; i++) {
      const kc = kcs[i];
      try {
        const b = await runKeyConceptBroadener(this.runAgent, {
          original: kc.statement,
          genus,
          approvedSpecies: kept,
          consciousness: this.consciousness.renderForAgent({ part: `differentiation:${kc.id}` }),
        });
        const verdict = await runVerifier(this.runAgent, {
          piece: b.broadened_concept_text,
          inventorMaterial: kc.verbatim.join("\n"),
          consciousness: this.consciousness.renderForAgent({ part: `differentiation:${kc.id}` }),
        });
        this.ledger.recordMachineEvent("agent_broadened", ["showcase"], { conceptId: kc.id });
        if (verdict.verdict === "pass" && b.broadened_concept_text.trim()) {
          artifacts.push({
            id: this.genId(),
            kind: "broadened_kc",
            label: `Broadened Key Concept ${i + 1}`,
            original: kc.statement,
            text: b.broadened_concept_text.trim(),
            kept: true,
            meta: { conceptId: kc.id },
          });
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

    // The three new Key Concepts (genus / species-spectrum / hardware).
    const aspectLabels: Record<ConceptAspect, string> = {
      genus_mechanism: "New Key Concept — Core Mechanism",
      species_spectrum: "New Key Concept — Architectural Spectrum",
      hardware_optimization: "New Key Concept — Hardware Optimization",
    };
    for (const aspect of Object.keys(aspectLabels) as ConceptAspect[]) {
      try {
        const existing = kcs.map((k) => ({ title: k.title, statement: k.statement }));
        const r = await runKeyConceptAppender(this.runAgent, { genus, species: kept, existing, aspect });
        if (r.key_concept_text.trim()) {
          artifacts.push({
            id: this.genId(),
            kind: "new_kc",
            label: aspectLabels[aspect],
            text: r.key_concept_text.trim(),
            kept: true,
            meta: { aspect, title: r.title.trim() || aspect.replace(/_/g, " ") },
          });
          this.ledger.recordMachineEvent("agent_appended_concept", ["showcase", aspect], {});
        }
      } catch (err) {
        console.error("[showcase] key-concept-appender failed for", aspect, err);
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
    const id = this.genId();
    this.openCards.set(id, { id, type: "expansion_review", artifacts });
    this.intents.set(id, { kind: "expansion_review" });
    this.phase = "reviewing_artifacts";
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
    await this.finalizeExpansion(card.artifacts.filter((a) => a.kept));
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
      }
      a.kept = true;
    } catch (err) {
      console.error("[showcase] regenerate failed for", a.kind, err);
    }
  }

  /** Apply the kept artifacts: broadened + new Key Concepts, section weaves. */
  private async finalizeExpansion(kept: ExpansionArtifact[]): Promise<void> {
    const sections = this.disclosure;
    const find = (key: string) => sections?.find((s) => s.key === key);

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

    // The stage is done regardless of how many broadenings the inventor kept — the
    // Across-Implementations write already happened in formalizeKept.
    this.broadened = true;
    this.ledger.recordMachineEvent("disclosure_extended", ["showcase"], {
      applied: kept.length,
      sections: sections?.length ?? 0,
    });
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
