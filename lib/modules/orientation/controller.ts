import "server-only";
import { EvidenceLedger } from "@/lib/modules/shared";
import type { HelperTurn } from "@/lib/modules/shared";
import {
  runBriefWriter,
  runOrientationHelper,
  runRouter,
  runStructurer,
  type StructurerResult,
} from "./agents";
import { EMPTY_MATURITY, ORIENTATION_HUMAN_SOURCE_TYPES } from "./types";
import type {
  Clause,
  ClauseOrigin,
  DiscoveryPhase,
  MaturityScore,
  Module0Phase,
  Module0View,
  OrientationDeps,
  OrientationSession,
} from "./types";

/**
 * Module 0 — the Orientation engine (guided mechanism discovery).
 *
 * On ingest a ROUTER classifies the raw idea (forward vs discovery). Discovery
 * runs a PHASE STATE MACHINE — the HELPER drives one turn at a time (objective →
 * process → baseline → limitation → conflict → mechanism → synthesis → [states →
 * flow → interaction] → effect → choose); at each synthesis checkpoint the
 * STRUCTURER reads the whole conversation into a structured, provenance-tagged
 * session with a maturity score. Orientation is the ORIGIN of the ledger chain.
 */

/**
 * A choose-phase ACTION the inventor tapped — must deterministically drive the
 * phase machine into the named phase and make the Helper DO that phase's work
 * this turn (never acknowledge-then-loop back to the choose menu). Returns null
 * for ordinary answers, which flow through the Helper's own phase judgement.
 */
function matchDiscoveryCommand(
  message: string,
): { phase: DiscoveryPhase; directive: string } | null {
  const t = message.trim().toLowerCase();
  // Only treat SHORT action taps as commands — a long free-text answer that merely
  // mentions "interaction" is not a menu choice.
  if (t.length > 60) return null;

  if (/\binteraction\b/.test(t) && /\b(develop|order|sequence|lay ?out|build)\b/.test(t)) {
    return {
      phase: "interaction",
      directive:
        "The inventor chose to develop the ORDERED INTERACTION. In THIS reply you MUST: (1) list, as tap options, the concrete causal events of the mechanism you have already gathered from the conversation and the mechanism summary — the real steps, in your best-guess order; (2) ask the inventor to put those events in the order they actually occur; (3) then ask whether changing that order would break the behavior. Set phase to \"interaction\". Do NOT return to the choose menu, do NOT set can_write_brief, and do NOT merely re-summarize the mechanism.",
    };
  }
  if (/\barchitecture\b/.test(t) && /\b(develop|build|design|keep)\b/.test(t)) {
    return {
      phase: "states",
      directive:
        "The inventor chose to develop the ARCHITECTURE. Begin with the machine STATES. In THIS reply you MUST enter phase \"states\": draw out the states the mechanism moves through and which transition controls later behavior, and ask ONE concrete tap question about a state change (options are state categories, never a designed architecture). Do NOT return to the choose menu and do NOT merely re-summarize.",
    };
  }
  if (/\bflow\b/.test(t) && /\b(develop|information|data|build)\b/.test(t)) {
    return {
      phase: "flow",
      directive:
        "The inventor chose to develop the INFORMATION FLOW. In THIS reply you MUST enter phase \"flow\": ask which component decides or commits the key value and what crosses a boundary — ONE concrete tap question (options are data categories / boundary questions, never a designed architecture). Do NOT return to the choose menu and do NOT merely re-summarize.",
    };
  }
  if (/\b(states?|state behavior)\b/.test(t) && /\b(develop|define|build)\b/.test(t)) {
    return {
      phase: "states",
      directive:
        "The inventor chose to develop the machine STATES. In THIS reply you MUST enter phase \"states\": draw out the states the mechanism moves through and which transition controls later behavior; ask ONE concrete tap question about a state change. Do NOT return to the choose menu and do NOT merely re-summarize.",
    };
  }
  if (/\b(another|other)\b/.test(t) && /\b(weakness|failure|problem|angle|conflict)\b/.test(t)) {
    return {
      phase: "baseline",
      directive:
        "The inventor chose to EXPLORE ANOTHER WEAKNESS. In THIS reply you MUST enter phase \"baseline\": surface 2–3 realistic, DIFFERENT ways the baseline could be unreliable (as tap options + \"something else\") and ask which one matters — do not repeat the failure already developed. Do NOT return to the choose menu and do NOT merely re-summarize.",
    };
  }
  if (/\bedit\b/.test(t) && /\bmechanism\b/.test(t)) {
    return {
      phase: "mechanism",
      directive:
        "The inventor chose to EDIT the mechanism. In THIS reply you MUST enter phase \"mechanism\": show the current mechanism in one line and ask the inventor, in their own words, what they want to change or add. Do NOT return to the choose menu and do NOT invent a change for them.",
    };
  }
  return null;
}

function emptySession(originalInput: string): OrientationSession {
  return {
    originalInput,
    route: null,
    phase: "empty",
    discoveryPhase: "objective",
    maturity: { ...EMPTY_MATURITY },
    commercialObjective: null,
    informationProcess: [],
    ordinaryImplementation: null,
    failureCases: [],
    machineLimitations: [],
    requirements: [],
    requirementConflicts: [],
    mechanismDirections: [],
    approvedMechanism: [],
    machineStates: [],
    stateTransitions: [],
    components: [],
    informationFlows: [],
    orderedInteractions: [],
    technicalEffects: [],
    humanPerformanceFindings: [],
    unresolvedGaps: [],
  };
}

export type OrientationSnapshot = {
  phase: Module0Phase;
  started: boolean;
  route: "forward" | "discovery" | null;
  discoveryPhase: DiscoveryPhase;
  mechanism: string;
  canWriteBrief: boolean;
  maturity: MaturityScore;
  session: OrientationSession;
  brief: string;
  conversation: HelperTurn[];
  ledger: import("@/lib/modules/shared").LedgerEntry[];
};

export class OrientationModule {
  private readonly runAgent;
  private readonly now: () => string;
  private readonly genId: () => string;
  private readonly ledger: EvidenceLedger;

  private phase: Module0Phase = "empty";
  private started = false;
  private route: "forward" | "discovery" | null = null;
  private discoveryPhase: DiscoveryPhase = "objective";
  private mechanism = "";
  private canWriteBrief = false;
  private maturity: MaturityScore = { ...EMPTY_MATURITY };
  private session: OrientationSession = emptySession("");
  private brief = "";
  private conversation: HelperTurn[] = [];

  constructor(deps: OrientationDeps) {
    this.runAgent = deps.runAgent;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.genId = deps.genId ?? (() => crypto.randomUUID());
    this.ledger =
      deps.ledger ?? new EvidenceLedger(ORIENTATION_HUMAN_SOURCE_TYPES, this.now, this.genId);
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  async ingest(rawInput: string): Promise<Module0View> {
    const text = rawInput.trim();
    if (!text) return this.view();
    if (!this.started) {
      this.started = true;
      this.session = emptySession(text);
      this.ledger.recordMachineEvent("orientation_started", ["module0"], {});
    }
    this.ledger.recordInventorSource("inventor_input", text, ["orientation", "raw_idea"]);
    this.pushTurn({ role: "inventor", text });

    let route: "forward" | "discovery" = "discovery";
    let missing = "";
    try {
      const r = await runRouter(this.runAgent, { rawIdea: text });
      route = r.route;
      missing = r.missing.trim();
      this.ledger.recordMachineEvent("orientation_routed", ["orientation"], { route });
    } catch (err) {
      console.error("[orientation] router failed — defaulting to discovery", err);
    }
    this.route = route;
    this.session.route = route;

    if (route === "forward") {
      this.phase = "forward";
      this.session.phase = "forward";
      this.canWriteBrief = true;
      this.pushTurn({
        role: "helper",
        text: missing
          ? `Your idea already describes a clear system mechanism — nice. One thing to pin down before we write it up: ${missing}`
          : "Your idea already describes a clear system mechanism — no need to draw it out. When you're ready, I'll write it up as a detailed brief.",
        intent: "forward",
      });
      return this.view();
    }

    this.phase = "discovery";
    this.session.phase = "discovery";
    await this.replyHelper(text);
    return this.view();
  }

  async tell(text: string): Promise<Module0View> {
    const t = text.trim();
    if (!t) return this.view();
    if (this.phase === "empty") return this.ingest(t);
    this.ledger.recordInventorSource("inventor_note", t, ["orientation", "note"]);
    this.pushTurn({ role: "inventor", text: t });
    if (this.phase === "discovery") await this.replyHelper(t);
    return this.view();
  }

  /** One discovery turn: the Helper drives; a synthesis checkpoint refreshes the
   *  structured session via the Structurer. */
  private async replyHelper(message: string): Promise<void> {
    const exchangeCount = this.conversation.filter((t) => t.role === "inventor").length;
    let synthesize = false;
    // A choose-phase action ("develop the interaction", etc.) must deterministically
    // drive the phase machine — never loop back to the choose menu. Force the target
    // phase and hand the Helper a mandatory directive so it DOES that phase's work.
    const cmd = matchDiscoveryCommand(message);
    try {
      const helper = await runOrientationHelper(this.runAgent, {
        message,
        inventorMaterial: this.inventorMaterial(),
        conversation: this.conversation.slice(-12).map((t) => ({ role: t.role, text: t.text })),
        mechanism: this.mechanism,
        exchangeCount,
        phase: cmd ? cmd.phase : this.discoveryPhase,
        ...(cmd ? { directive: cmd.directive } : {}),
      });
      // If a command was issued but the Helper regressed to "choose" anyway, keep the
      // forced target phase so the machine still advances.
      const nextPhase = cmd && helper.phase === "choose" ? cmd.phase : helper.phase;
      this.discoveryPhase = nextPhase;
      this.session.discoveryPhase = nextPhase;
      if (helper.mechanism.trim()) this.mechanism = helper.mechanism.trim();
      if (helper.can_write_brief) this.canWriteBrief = true;
      synthesize = helper.synthesize;
      this.ledger.recordMachineEvent("orientation_helper", ["orientation", nextPhase], {});
      this.pushTurn({
        role: "helper",
        text: helper.reply || "Tell me a bit more about how it actually works.",
        ...(helper.question?.ask ? { question: helper.question } : {}),
        intent: nextPhase,
      });
    } catch (err) {
      console.error("[orientation] helper failed", err);
      this.pushTurn({ role: "helper", text: "I hit a snag there — try saying that another way?" });
    }
    // At a synthesis checkpoint, refresh the structured session from the whole
    // conversation. (Also refreshed lazily before the brief.)
    if (synthesize) await this.refreshSession();
  }

  /** Re-read the whole conversation into the structured, provenance-tagged session. */
  private async refreshSession(): Promise<void> {
    try {
      const s = await runStructurer(this.runAgent, {
        rawIdea: this.session.originalInput,
        conversation: this.conversation.map((t) => ({ role: t.role, text: t.text })),
      });
      this.applyStructure(s);
      this.ledger.recordMachineEvent("orientation_synthesis", ["orientation"], {
        maturity: this.maturityTotal(),
      });
    } catch (err) {
      console.error("[orientation] structurer failed", err);
    }
  }

  async buildBrief(): Promise<Module0View> {
    if (!this.started) return this.view();
    // Make sure the structured session (and mechanism) is current before writing.
    if (this.phase === "discovery") await this.refreshSession();
    try {
      const s = this.session;
      // Build the four pillars from the extracted, provenance-checked clauses —
      // the writer organizes substance, never re-reads raw chat.
      const orderedBehavior = [
        ...s.approvedMechanism.map((c) => c.text),
        ...s.orderedInteractions.map((step) => step.text),
        ...s.stateTransitions.map((t) => `then ${t.from} → ${t.to}`),
      ];
      const stateFlowChange = [
        ...s.informationFlows.map((c) => c.text),
        ...s.machineStates.map((m) => m.name),
      ];
      const carryForward = s.unresolvedGaps.map((c) => c.text);
      const result = await runBriefWriter(this.runAgent, {
        rawIdea: s.originalInput,
        mechanism: this.mechanism,
        machineLimitation: s.machineLimitations.map((c) => c.text),
        orderedBehavior,
        stateFlowChange,
        technicalEffect: [
          ...s.technicalEffects.map((c) => c.text),
          ...s.humanPerformanceFindings.map((c) => c.text),
        ],
        requirementConflict: s.requirementConflicts.map((c) => `${c.sideA} vs ${c.sideB}`),
        carryForward,
      });
      // The brief is always clean prose — no doubt, no open-questions block ever appended.
      this.brief = result.brief.trim();
      this.phase = "brief_ready";
      this.session.phase = "brief_ready";
      // Non-blocking details are carried forward INTERNALLY (into the chained ledger)
      // so Conception can probe them later — they never touch the brief.
      this.ledger.recordMachineEvent("brief_built", ["orientation"], {
        traceable: result.traceable,
        carryForward: [...new Set([...result.carry_forward, ...carryForward])],
      });
    } catch (err) {
      console.error("[orientation] brief-writer failed", err);
    }
    return this.view();
  }

  editBrief(text: string): Module0View {
    this.brief = text;
    if (text.trim()) {
      this.phase = "brief_ready";
      this.session.phase = "brief_ready";
    }
    return this.view();
  }

  finish(): Module0View {
    this.ledger.recordMachineEvent("orientation_completed", ["module0"], {});
    return this.view();
  }

  view(): Module0View {
    return {
      phase: this.phase,
      route: this.route,
      discoveryPhase: this.discoveryPhase,
      conversation: this.conversation.map((t) => ({ ...t })),
      session: this.cloneSession(),
      mechanism: this.mechanism,
      canWriteBrief: this.canWriteBrief,
      brief: this.brief,
      ledger: this.ledger.serialize(),
    };
  }

  ledgerEntries() {
    return this.ledger.serialize();
  }

  /* ------------------------------------------------------------------ *
   * Structure application (structurer output → typed session + provenance)
   * ------------------------------------------------------------------ */

  private applyStructure(s: StructurerResult): void {
    const toClause = (c: { text: string; origin: ClauseOrigin } | null): Clause | null =>
      c && c.text.trim()
        ? { id: this.genId(), text: c.text.trim(), origin: c.origin, approved: c.origin !== "system_inferred" }
        : null;
    const toClauses = (arr: { text: string; origin: ClauseOrigin }[]): Clause[] =>
      arr.filter((c) => c.text.trim()).map((c) => toClause(c)!);

    this.session.commercialObjective = toClause(s.commercial_objective);
    this.session.informationProcess = toClauses(s.information_process);
    this.session.ordinaryImplementation = toClause(s.ordinary_implementation);
    this.session.failureCases = toClauses(s.failure_cases);
    this.session.machineLimitations = toClauses(s.machine_limitations);
    this.session.requirements = toClauses(s.requirements);
    this.session.requirementConflicts = s.requirement_conflicts
      .filter((c) => c.sideA.trim() || c.sideB.trim())
      .map((c) => ({
        id: this.genId(),
        sideA: c.sideA.trim(),
        sideB: c.sideB.trim(),
        origin: c.origin,
        approved: c.origin !== "system_inferred",
      }));
    this.session.mechanismDirections = toClauses(s.mechanism_directions);
    this.session.approvedMechanism = toClauses(s.approved_mechanism);
    this.session.machineStates = toClauses(s.machine_states).map((c) => ({
      id: c.id,
      name: c.text,
      origin: c.origin,
    }));
    this.session.stateTransitions = s.state_transitions
      .filter((t) => t.from.trim() && t.to.trim())
      .map((t) => ({ id: this.genId(), from: t.from.trim(), to: t.to.trim(), origin: t.origin }));
    this.session.components = s.components
      .filter((c) => c.name.trim())
      .map((c) => ({ id: this.genId(), ...c, name: c.name.trim() }));
    this.session.informationFlows = toClauses(s.information_flows);
    this.session.orderedInteractions = toClauses(s.ordered_interactions).map((c) => ({
      id: c.id,
      text: c.text,
      origin: c.origin,
    }));
    this.session.technicalEffects = toClauses(s.technical_effects);
    this.session.humanPerformanceFindings = toClauses(s.human_performance);
    this.session.unresolvedGaps = toClauses(s.unresolved_gaps);

    this.maturity = {
      machineLimitation: s.maturity.machine_limitation,
      machineMechanism: s.maturity.machine_mechanism,
      informationFlowChange: s.maturity.information_flow_change,
      stateBehavior: s.maturity.state_behavior,
      machineOnlyBehavior: s.maturity.machine_only_behavior,
      technicalCausation: s.maturity.technical_causation,
      measurableEffect: s.maturity.measurable_effect,
    };
    this.session.maturity = { ...this.maturity };
  }

  private maturityTotal(): number {
    const m = this.maturity;
    return (
      m.machineLimitation +
      m.machineMechanism +
      m.informationFlowChange +
      m.stateBehavior +
      m.machineOnlyBehavior +
      m.technicalCausation +
      m.measurableEffect
    );
  }

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  private pushTurn(turn: Omit<HelperTurn, "timestamp">): void {
    this.conversation.push({ ...turn, timestamp: this.now() });
  }

  private inventorMaterial(): string {
    return this.ledger
      .humanVerbatim()
      .map((e) => e.verbatim_text)
      .filter(Boolean)
      .join("\n");
  }

  private cloneSession(): OrientationSession {
    return JSON.parse(JSON.stringify(this.session)) as OrientationSession;
  }

  /* ------------------------------------------------------------------ *
   * Persistence
   * ------------------------------------------------------------------ */

  toSnapshot(): OrientationSnapshot {
    return {
      phase: this.phase,
      started: this.started,
      route: this.route,
      discoveryPhase: this.discoveryPhase,
      mechanism: this.mechanism,
      canWriteBrief: this.canWriteBrief,
      maturity: { ...this.maturity },
      session: this.cloneSession(),
      brief: this.brief,
      conversation: this.conversation.map((t) => ({ ...t })),
      ledger: this.ledger.serialize(),
    };
  }

  static fromSnapshot(snap: OrientationSnapshot, deps: OrientationDeps): OrientationModule {
    const now = deps.now ?? (() => new Date().toISOString());
    const genId = deps.genId ?? (() => crypto.randomUUID());
    const ledger = EvidenceLedger.fromEntries(
      snap.ledger,
      ORIENTATION_HUMAN_SOURCE_TYPES,
      now,
      genId,
    );
    const m = new OrientationModule({ ...deps, ledger });
    m.phase = snap.phase;
    m.started = snap.started;
    m.route = snap.route ?? null;
    m.discoveryPhase = snap.discoveryPhase ?? "objective";
    m.mechanism = snap.mechanism ?? "";
    m.canWriteBrief = snap.canWriteBrief ?? false;
    m.maturity = snap.maturity ?? { ...EMPTY_MATURITY };
    m.session = snap.session ?? emptySession("");
    m.brief = snap.brief ?? "";
    m.conversation = (snap.conversation ?? []).map((t) => ({ ...t }));
    return m;
  }
}
