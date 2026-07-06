import "server-only";
import { EvidenceLedger, SharedConsciousness } from "@/lib/modules/shared";
import { hasCheckpoint, sealCheckpoint } from "@/lib/modules/shared/checkpoint";
import {
  runAbstractRewriter,
  runBackgroundExtender,
  runDetailDescriptionExtender,
  runGenusExtractor,
  runHelper,
  runKeyConceptAppender,
  runKeyConceptBroadener,
  runSpeciesSynthesizer,
  runSummaryExtender,
  runVerifier,
  type ConceptAspect,
} from "./agents";
import { SHOWCASE_HUMAN_SOURCE_TYPES } from "./types";
import type {
  ChoiceInput,
  DisclosureSection,
  ExpansionArtifact,
  ExpansionReviewInput,
  Genus,
  HelperTurn,
  Module5Card,
  Module5Phase,
  Module5View,
  ShowcaseDeps,
  ShowcaseKeyConcept,
  Species,
  SpeciesReviewInput,
  SpeciesType,
  VariationInput,
  WidenedActionInput,
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
  | { kind: "species_review" }
  | { kind: "expansion_review" };

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
        "Want to broaden the disclosure across alternative implementations, so the mechanism is covered however it's built? You can also skip straight to the finished draft.",
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
      | SpeciesReviewInput
      | ExpansionReviewInput,
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
      case "species_review":
        await this.handleSpeciesReview(cardId, input as SpeciesReviewInput);
        break;
      case "expansion_review":
        await this.handleExpansionReview(cardId, input as ExpansionReviewInput);
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

  /** A compact description of the live Showcase state for the Helper. */
  private helperContext(): string {
    const kept = this.species.filter((s) => s.kept).map((s) => s.species_type);
    return [
      `Phase: ${this.phase}. Broadening ${this.broadened ? "applied" : "not yet applied"}.`,
      `Key Concepts: ${[...this.keyConcepts.values()].map((k) => k.title).join("; ") || "(none)"}.`,
      this.genus ? `Paradigm-neutral genus: ${this.genus.genus_name}.` : "",
      kept.length ? `Kept implementations: ${kept.join(", ")}.` : "",
      this.openCards.size ? `${this.openCards.size} card(s) open for the inventor's decision.` : "",
    ]
      .filter(Boolean)
      .join("\n");
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
        c.type === "species_review" ||
        c.type === "expansion_review"
      ) {
        this.resolveCard(id);
      }
    }
    this.species = [];
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
    // Genus — the paradigm-neutral mechanism beneath the Key Concepts.
    const kcs = [...this.keyConcepts.values()];
    try {
      this.genus = await runGenusExtractor(this.runAgent, {
        keyConcepts: kcs.map((k) => ({ title: k.title, statement: k.statement })),
        verbatim: kcs.flatMap((k) => k.verbatim),
      });
      this.ledger.recordMachineEvent("agent_genus", ["showcase"], {});
    } catch (err) {
      console.error("[showcase] genus extraction failed", err);
      this.complete(); // can't broaden without a genus
      return;
    }

    // Synthesize one species per type. NO verifier gate here: a species is BY
    // DESIGN an alternative implementation naming components the inventor never
    // stated (that is its whole purpose), so checking it against the inventor's
    // verbatim rejects every good species — which blanked the screen. V1's gate
    // is the HUMAN one: Gate 1 approve/edit/reject, right below. The synthesis
    // prompt itself enforces no-capability-invention against the genus.
    for (const t of SPECIES_TYPES) {
      try {
        const sp = await runSpeciesSynthesizer(this.runAgent, { genus: this.genus, speciesType: t });
        this.ledger.recordMachineEvent("agent_species", ["showcase", t], {});
        this.species.push(sp);
      } catch (err) {
        console.error("[showcase] species synthesis failed for", t, err);
      }
    }

    if (!this.species.length) {
      // Synthesis itself failed — say so instead of finishing silently.
      this.pushTurn({
        role: "helper",
        text: "The expansion couldn't draft the alternative implementations this time — hit Genus & Species Expansion to try again.",
      });
      this.broadened = false;
      this.complete();
      return;
    }
    // GATE 1 (V1): all species on ONE review screen — approve/edit/reject each,
    // then Confirm & Continue. Nothing is applied yet.
    this.emitSpeciesReview();
    this.phase = "reviewing_species";
  }

  /* ------------------------------------------------------------------ *
   * The V1 two-gate expansion review
   * ------------------------------------------------------------------ */

  private speciesLabel(t: SpeciesType): string {
    return t === "ai_assisted" ? "AI-Assisted" : t === "ai_native" ? "AI-Native" : "Agentic";
  }

  private emitSpeciesReview(): void {
    const id = this.genId();
    this.openCards.set(id, {
      id,
      type: "species_review",
      items: this.species.map((sp) => ({
        speciesType: sp.species_type,
        label: this.speciesLabel(sp.species_type),
        description: sp.architectural_description,
        status: "pending" as const,
      })),
    });
    this.intents.set(id, { kind: "species_review" });
  }

  /** GATE 1 actions: decide each species; Confirm generates the artifacts. */
  private async handleSpeciesReview(cardId: string, input: SpeciesReviewInput): Promise<void> {
    const card = this.openCards.get(cardId);
    if (!card || card.type !== "species_review") return;

    if (input.action === "approve" || input.action === "reject") {
      const item = card.items.find((i) => i.speciesType === input.speciesType);
      if (item) item.status = input.action === "approve" ? "approved" : "rejected";
      this.ledger.recordDecision("variation_action", ["showcase", input.action], {
        speciesType: input.speciesType,
      });
      return;
    }
    if (input.action === "edit") {
      const item = card.items.find((i) => i.speciesType === input.speciesType);
      const sp = this.species.find((s) => s.species_type === input.speciesType);
      const text = input.text.trim();
      if (item && sp && text) {
        item.description = text;
        sp.architectural_description = text;
        this.ledger.recordInventorSource("inventor_edit", text, ["showcase", "species-edit"]);
      }
      return;
    }
    // confirm — every species must be decided; only approved ones continue.
    if (card.items.some((i) => i.status === "pending")) return;
    for (const sp of this.species) {
      const item = card.items.find((i) => i.speciesType === sp.species_type);
      sp.kept = item?.status === "approved";
    }
    this.resolveCard(cardId);
    const kept = this.species.filter((s) => s.kept);
    if (!kept.length || !this.genus) {
      this.broadened = false;
      this.complete();
      return;
    }
    await this.generateArtifacts(kept);
  }

  /**
   * Generate EVERY expansion artifact (nothing applied yet): a broadened rewrite
   * per Key Concept, the three new Key Concepts, the Background + Summary
   * extensions, the "Across Implementations" body, and the Abstract rewrite —
   * all surfaced on ONE Gate-2 review screen with Regenerate/Keep/Edit/Remove.
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

    // The "Across Implementations" detailed body.
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
        artifacts.push({
          id: this.genId(),
          kind: "detail_ext",
          label: "Detailed Description Extension",
          text: body.trim(),
          kept: true,
        });
      }
    } catch (err) {
      console.error("[showcase] detail-description-extender failed", err);
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
      this.broadened = false;
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
    const kept = this.species.filter((s) => s.kept);
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

    this.broadened = kept.length > 0;
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
