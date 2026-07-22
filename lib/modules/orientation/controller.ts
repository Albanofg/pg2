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
        "The inventor chose to EXPLORE ANOTHER WEAKNESS. In THIS reply you MUST enter phase \"baseline\": surface 2–3 realistic, DIFFERENT ways the baseline could be unreliable (concrete tap options only — no escape/hedge option; if none fit they type their own) and ask which one matters — do not repeat the failure already developed. Do NOT return to the choose menu and do NOT merely re-summarize.",
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

/**
 * IMPROVE MODE directive — the inventor already stated a real software mechanism
 * that is just under-specified. Drive the SURGICAL path only; never re-run the
 * business-method excavation. `firstTurn` carries the router's flagged gap.
 */
function buildImproveDirective(gap: string, firstTurn: boolean): string {
  const base =
    "IMPROVE MODE — the inventor ALREADY stated a real software mechanism; it is only under-specified. Do NOT run objective/process/baseline or build a full requirement conflict. Follow this surgical path and let `phase` advance mechanism → limitation → effect → choose: " +
    "(1) reflect their mechanism in ONE line; " +
    "(2) name the ONE missing operation that makes it non-executable or unclear and ask ONE targeted question to get THEM to describe that operation in their own words — never invent it (phase \"mechanism\"); " +
    "(3) once it's described, test the mechanism against ONE realistic failure case — offer 2–3 concrete failures, tap options only, no escape/hedge option (phase \"limitation\"); " +
    "(4) confirm the machine-dependent effect it produces and run the human-performance check (phase \"effect\"); " +
    "(5) then synthesize and go to \"choose\". Keep it to a few turns — do not drill parameters. " +
    "ESCAPE HATCH: if the inventor's answer reveals there is NO real mechanism (the operation dissolves into a wish they can't describe), set `phase` to \"objective\" to fall back to full discovery.";
  return firstTurn && gap
    ? `${base}\n\nThe operation the inventor left under-specified (start here): ${gap}`
    : base;
}

/** A tap/answer that carries no new content — "something else", "not sure", etc.
 *  Repeated re-asking of these is the loop inventors hate. */
const STUCK_SIGNALS = new Set([
  "something else",
  "i don't know",
  "i dont know",
  "idk",
  "not sure",
  "i'm not sure",
  "im not sure",
  "i'm not sure yet",
  "im not sure yet",
  "no idea",
  "dunno",
  "none",
  "none of these",
  "none of those",
  "none of these fit",
  "not really",
  "help",
  "pass",
  "no",
]);

function matchStuckSignal(message: string): boolean {
  return STUCK_SIGNALS.has(message.trim().toLowerCase().replace(/[.!?]+$/, ""));
}

/**
 * NO DEAD BUTTONS AND NO ESCAPE BUTTON. Tap options are ONLY concrete candidate
 * answers. A hedge/escape ("something else", "I'm not sure yet", "none of these fit")
 * is not a real answer — it manufactures doubt and duplicates the always-present
 * "type your own" composer. If nothing fits, the inventor types. So drop every hedge
 * option entirely and de-dupe, regardless of what the Helper emits.
 */
const HEDGE_OPTION =
  /^(something else|i'?m not sure(\s+yet)?|i\s*don'?t\s*know|idk|not sure|none|none of (these|those)( fit)?|no idea|dunno|other|not applicable|n\/?a)$/i;

function sanitizeOptions(options: string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of options ?? []) {
    const t = raw.trim();
    if (!t || HEDGE_OPTION.test(t)) continue; // drop empties + hedge/escape buttons
    if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

/**
 * A non-answer must make the Helper PROPOSE, never re-ask the same question in new
 * words. Phase-aware so POHC holds: it may propose failures/limitations/conflicts
 * (teaching), but NEVER the resolving mechanism (that must stay the inventor's).
 */
function buildStuckDirective(phase: DiscoveryPhase): string {
  const head =
    "ANTI-LOOP — the inventor gave a NON-ANSWER (\"something else\" / not sure). Do NOT re-ask the same question in new words; re-asking is the loop they hate. ";
  if (phase === "process" || phase === "baseline" || phase === "limitation") {
    const artifact = phase === "limitation" ? "machine limitation" : "failure of the basic version";
    return (
      head +
      `You have teaching license in this phase: PROPOSE the single most likely concrete ${artifact} for THEIR specific idea as one plain statement, then ask only whether it fits — offer 2–3 concrete NAMED alternatives, tap options only (no escape/hedge option; if none fit they type). Advance; never ask this phase's question a third way.`
    );
  }
  if (phase === "conflict") {
    return (
      head +
      "PROPOSE the two-sided requirement conflict you infer from their idea (\"must X — but it must also Y\") and ask only whether both sides are required. Do not re-ask an open question."
    );
  }
  if (
    phase === "mechanism" ||
    phase === "synthesis" ||
    phase === "states" ||
    phase === "flow" ||
    phase === "interaction"
  ) {
    return (
      head +
      "POHC: do NOT invent the resolving mechanism. Offer 2–3 conceptual DIRECTIONS (categories, never finished mechanisms) they can pick from, or name the gap plainly and let them decide. Silence beats invention."
    );
  }
  return head + "Either propose a concrete option for them to confirm, or move to the next phase.";
}

/**
 * The inventor handing the decision to the AI ("you decide", "your call"). DISTINCT
 * from a stuck non-answer: on stuck the AI proposes and asks the inventor to confirm;
 * on DEFER the AI decides and PROCEEDS. Crucially, a deferred decision is the SYSTEM's,
 * not the inventor's conception — it must never be recorded in the inventor's notebook.
 */
const DEFER_SIGNALS = new Set([
  "you decide",
  "you choose",
  "you pick",
  "you decide for me",
  "decide for me",
  "choose for me",
  "pick for me",
  "your call",
  "up to you",
  "whatever you think",
  "whatever you decide",
  "whatever works",
  "whatever is best",
  "whatever's best",
  "let the ai decide",
  "let ai decide",
  "ai decide",
  "ai decides",
  "you know best",
  "surprise me",
]);

function matchDeferSignal(message: string): boolean {
  return DEFER_SIGNALS.has(message.trim().toLowerCase().replace(/[.!?]+$/, ""));
}

/**
 * On DEFER the AI decides on the inventor's behalf and moves on. The normal
 * "never supply the answer" restraint is waived for that turn BECAUSE THEY ASKED —
 * but the choice is the system's suggestion, recorded as system-supplied and kept out
 * of the notebook (see `tell`), so it never counts as the inventor's conception.
 */
function buildDeferDirective(_phase: DiscoveryPhase): string {
  return (
    "DEFER — the inventor explicitly asked YOU to decide on their behalf. For THIS turn the normal 'never supply the answer/mechanism' restraint is WAIVED because they asked: pick the single best answer for the current phase, state it in ONE line as the working answer, and PROCEED to the next phase. Do NOT ask them to confirm and do NOT re-offer options. Make clear it is YOUR suggestion — it is recorded as system-supplied, does NOT count as their conception, and they can change it later."
  );
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
  route: "forward" | "improve" | "discovery" | null;
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
  private route: "forward" | "improve" | "discovery" | null = null;
  /** improve route only: the ONE under-specified operation the router flagged. */
  private improveGap = "";
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

    let route: "forward" | "improve" | "discovery" = "discovery";
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

    if (route === "improve") {
      // A clear software mechanism that's just under-specified. Enter the phase
      // machine DEEP — no objective/process/baseline excavation — and drive only at
      // the one flagged operation. Ends in a brief (assembled), like discovery.
      this.phase = "discovery";
      this.session.phase = "discovery";
      this.discoveryPhase = "mechanism";
      this.session.discoveryPhase = "mechanism";
      this.improveGap = missing;
      await this.replyHelper(text);
      return this.view();
    }

    if (route === "forward") {
      this.phase = "forward";
      this.session.phase = "forward";
      // No brief on the forward route — the idea is already detailed, so it goes
      // straight into Conception in the inventor's own words (canWriteBrief stays
      // false; the panel offers "Take this into Patent Geyser" instead).
      this.canWriteBrief = false;
      this.pushTurn({
        role: "helper",
        text: missing
          ? `Your idea already describes a clear system mechanism — nice. One thing worth pinning down first: ${missing}. Add it if you like, then take it straight in.`
          : "Your idea already describes a clear system mechanism — no need to rework it. Take it straight into Patent Geyser in your own words, and we'll build it out there.",
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
    if (matchDeferSignal(t)) {
      // The inventor handed the decision to the AI — this is NOT their conception, so
      // it must never enter the inventor's notebook. Log it as a MACHINE event (origin
      // machine → excluded from the human-verbatim trail), not recordInventorSource.
      this.ledger.recordMachineEvent("deferred_to_ai", ["orientation", "note"], { text: t });
    } else {
      this.ledger.recordInventorSource("inventor_note", t, ["orientation", "note"]);
    }
    this.pushTurn({ role: "inventor", text: t });
    if (this.phase === "discovery") await this.replyHelper(t);
    return this.view();
  }

  /** One discovery turn: the Helper drives; a synthesis checkpoint refreshes the
   *  structured session via the Structurer. */
  private async replyHelper(message: string): Promise<void> {
    const exchangeCount = this.conversation.filter((t) => t.role === "inventor").length;
    let synthesize = false;
    // Two directive seams, mutually exclusive per turn:
    //  • IMPROVE MODE (route "improve", pre-choose): drive the surgical path — reflect
    //    the mechanism, resolve the one gap, one failure test, confirm the effect.
    //  • A choose-phase ACTION ("develop the interaction", …): force that phase and
    //    make the Helper DO its work instead of looping the menu.
    const improveMode = this.route === "improve" && this.discoveryPhase !== "choose";
    const cmd = improveMode ? null : matchDiscoveryCommand(message);
    const forcedPhase = cmd?.phase;
    let directive = improveMode
      ? buildImproveDirective(this.improveGap, exchangeCount <= 1)
      : cmd?.directive;
    // A non-answer ("something else" / not sure) must PROPOSE, never re-ask the same
    // question. Phase-aware (POHC-safe); composes with any base directive.
    if (matchStuckSignal(message)) {
      const stuckDir = buildStuckDirective(forcedPhase ?? this.discoveryPhase);
      directive = directive ? `${stuckDir}\n\n${directive}` : stuckDir;
    }
    // DEFER ("you decide") — the AI decides and proceeds; takes precedence so it
    // dominates any base/stuck directive on the same turn.
    if (matchDeferSignal(message)) {
      const deferDir = buildDeferDirective(forcedPhase ?? this.discoveryPhase);
      directive = directive ? `${deferDir}\n\n${directive}` : deferDir;
    }
    try {
      const helper = await runOrientationHelper(this.runAgent, {
        message,
        inventorMaterial: this.inventorMaterial(),
        conversation: this.conversation.slice(-12).map((t) => ({ role: t.role, text: t.text })),
        mechanism: this.mechanism,
        exchangeCount,
        phase: forcedPhase ?? this.discoveryPhase,
        ...(directive ? { directive } : {}),
      });
      // If a command was issued but the Helper regressed to "choose" anyway, keep the
      // forced target phase so the machine still advances.
      let nextPhase = forcedPhase && helper.phase === "choose" ? forcedPhase : helper.phase;
      // ESCAPE HATCH: if improve mode falls back to an early excavation phase, the
      // stated mechanism didn't hold up — promote to full discovery so the whole
      // process (and full rail) takes over.
      if (
        this.route === "improve" &&
        (nextPhase === "objective" || nextPhase === "process" || nextPhase === "baseline")
      ) {
        this.route = "discovery";
        this.session.route = "discovery";
        this.improveGap = "";
      }
      this.discoveryPhase = nextPhase;
      this.session.discoveryPhase = nextPhase;
      if (helper.mechanism.trim()) this.mechanism = helper.mechanism.trim();
      if (helper.can_write_brief) this.canWriteBrief = true;
      synthesize = helper.synthesize;
      this.ledger.recordMachineEvent("orientation_helper", ["orientation", nextPhase], {});
      const question = helper.question?.ask
        ? { ...helper.question, options: sanitizeOptions(helper.question.options) }
        : undefined;
      this.pushTurn({
        role: "helper",
        text: helper.reply || "Tell me a bit more about how it actually works.",
        ...(question ? { question } : {}),
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
