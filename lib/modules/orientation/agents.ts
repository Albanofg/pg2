import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { withBackpack, type AgentRunner, type BackpackSection } from "@/lib/modules/shared";
import type { AgentName } from "./types";

/**
 * Module 0 (Orientation) agents. The module owns the prompts + I/O contract; the
 * Helper owns the model call via the injected AgentRunner. Prompts are read FRESH
 * each call (not cached) so this discovery-heavy stage iterates without a restart.
 *
 *  router      — one call at ingest: forward (already a mechanism) vs discovery.
 *  helper      — drives the phased discovery conversation, one turn at a time.
 *  structurer  — reads the whole conversation → the structured session + maturity.
 *  brief-writer— assembles the detailed brief from the inventor's material only.
 */

const MODULE_0_DIR = "module-0-orientation";

const PROMPT_FILES: Record<AgentName, string> = {
  helper: `${MODULE_0_DIR}/00-helper.md`,
  "brief-writer": `${MODULE_0_DIR}/01-brief-writer.md`,
  router: `${MODULE_0_DIR}/02-router.md`,
  structurer: `${MODULE_0_DIR}/03-structurer.md`,
};

const AGENT_SECTIONS: Record<AgentName, BackpackSection[]> = {
  helper: ["helper_doctrine"],
  "brief-writer": [],
  router: [],
  structurer: [],
};

export async function loadAgentPrompt(agent: AgentName): Promise<string> {
  const file = path.join(process.cwd(), "prompts", ...PROMPT_FILES[agent].split("/"));
  const contents = (await readFile(file, "utf8")).trim();
  return withBackpack(contents, AGENT_SECTIONS[agent]);
}

/* ------------------------------------------------------------------ *
 * Router
 * ------------------------------------------------------------------ */

export const RouterOutput = z.object({
  route: z.enum(["forward", "improve", "discovery"]),
  missing: z.string().default(""),
  reason: z.string().default(""),
});
export type RouterResult = z.infer<typeof RouterOutput>;

export async function runRouter(
  runAgent: AgentRunner,
  input: { rawIdea: string },
): Promise<RouterResult> {
  const system = await loadAgentPrompt("router");
  const prompt = ["THE INVENTOR'S RAW IDEA (route it):", input.rawIdea].join("\n");
  return runAgent({
    agent: "router",
    system,
    prompt,
    schema: RouterOutput,
    temperature: 0,
    subject: input.rawIdea,
  });
}

/* ------------------------------------------------------------------ *
 * Discovery Helper — drives the conversation, phase by phase.
 * ------------------------------------------------------------------ */

export const DiscoveryPhaseEnum = z.enum([
  "objective",
  "process",
  "baseline",
  "limitation",
  "conflict",
  "mechanism",
  "synthesis",
  "states",
  "flow",
  "interaction",
  "effect",
  "choose",
]);

export const OrientationHelperOutput = z.object({
  reply: z.string(),
  phase: DiscoveryPhaseEnum.default("process"),
  synthesize: z.boolean().default(false),
  mechanism: z.string().default(""),
  question: z
    .object({
      ask: z.string().default(""),
      why: z.string().default(""),
      options: z.array(z.string()).default([]),
    })
    .default({ ask: "", why: "", options: [] }),
  can_write_brief: z.boolean().default(false),
});
export type OrientationHelperResult = z.infer<typeof OrientationHelperOutput>;

export async function runOrientationHelper(
  runAgent: AgentRunner,
  input: {
    message: string;
    inventorMaterial: string;
    conversation: { role: string; text: string }[];
    mechanism: string;
    exchangeCount: number;
    phase: string;
    /** A forced instruction (e.g. the inventor picked a develop-X action) the Helper
     *  must obey THIS turn — enter the named phase and do its work, never re-offer choose. */
    directive?: string;
  },
): Promise<OrientationHelperResult> {
  const system = await loadAgentPrompt("helper");
  const prompt = [
    ...(input.directive
      ? [
          "MANDATORY DIRECTIVE FOR THIS TURN (overrides your default choose behavior — obey it exactly):",
          input.directive,
          "",
        ]
      : []),
    "THE INVENTOR JUST SAID (read what they mean, then reply for the right PHASE):",
    input.message,
    "",
    `CURRENT PHASE: ${input.phase}. Advance only when this phase's artifact exists; never drill parameters.`,
    "",
    "MECHANISM SO FAR (your running summary; keep it current):",
    input.mechanism || "(nothing discovered yet — you are early: objective / process)",
    "",
    `EXCHANGE_COUNT: ${input.exchangeCount} inventor answers. Enforce the anti-loop rules; after limitation + conflict + mechanism + effect, move to "choose".`,
    "",
    "THE CONVERSATION (oldest first):",
    input.conversation.length
      ? input.conversation
          .map((t) => `${t.role === "helper" ? "HELPER" : "INVENTOR"}: ${t.text}`)
          .join("\n")
      : "(none yet)",
    "",
    "THE INVENTOR'S OWN MATERIAL SO FAR (the ONLY source of technical substance — never supply a mechanism they didn't state):",
    input.inventorMaterial || "(none yet)",
  ].join("\n");
  return runAgent({
    agent: "helper",
    system,
    prompt,
    schema: OrientationHelperOutput,
    temperature: 0.5,
  });
}

/* ------------------------------------------------------------------ *
 * Structurer — the whole conversation → structured session + maturity.
 * ------------------------------------------------------------------ */

const originEnum = z.enum(["user_stated", "user_selected", "system_inferred"]).default("system_inferred");
const clause = z.object({ text: z.string(), origin: originEnum });
const clauseArr = z.array(clause).default([]);

export const StructurerOutput = z.object({
  commercial_objective: clause.nullable().default(null),
  information_process: clauseArr,
  ordinary_implementation: clause.nullable().default(null),
  failure_cases: clauseArr,
  machine_limitations: clauseArr,
  requirements: clauseArr,
  requirement_conflicts: z
    .array(z.object({ sideA: z.string(), sideB: z.string(), origin: originEnum }))
    .default([]),
  mechanism_directions: clauseArr,
  approved_mechanism: clauseArr,
  machine_states: clauseArr,
  state_transitions: z
    .array(z.object({ from: z.string(), to: z.string(), origin: originEnum }))
    .default([]),
  components: z
    .array(
      z.object({
        name: z.string(),
        receives: z.string().default(""),
        mayAccess: z.string().default(""),
        changes: z.string().default(""),
        outputs: z.string().default(""),
        cannotDo: z.string().default(""),
        communicatesWith: z.string().default(""),
        origin: originEnum,
      }),
    )
    .default([]),
  information_flows: clauseArr,
  ordered_interactions: clauseArr,
  technical_effects: clauseArr,
  human_performance: clauseArr,
  unresolved_gaps: clauseArr,
  maturity: z
    .object({
      machine_limitation: z.number().default(0),
      machine_mechanism: z.number().default(0),
      information_flow_change: z.number().default(0),
      state_behavior: z.number().default(0),
      machine_only_behavior: z.number().default(0),
      technical_causation: z.number().default(0),
      measurable_effect: z.number().default(0),
    })
    .default({
      machine_limitation: 0,
      machine_mechanism: 0,
      information_flow_change: 0,
      state_behavior: 0,
      machine_only_behavior: 0,
      technical_causation: 0,
      measurable_effect: 0,
    }),
});
export type StructurerResult = z.infer<typeof StructurerOutput>;

export async function runStructurer(
  runAgent: AgentRunner,
  input: { rawIdea: string; conversation: { role: string; text: string }[] },
): Promise<StructurerResult> {
  const system = await loadAgentPrompt("structurer");
  const prompt = [
    "THE INVENTOR'S ORIGINAL IDEA:",
    input.rawIdea || "(none)",
    "",
    "THE DISCOVERY CONVERSATION (oldest first) — INVENTOR messages are the ONLY source of substance:",
    input.conversation.length
      ? input.conversation
          .map((t) => `${t.role === "helper" ? "HELPER" : "INVENTOR"}: ${t.text}`)
          .join("\n")
      : "(no conversation)",
    "",
    "Structure the machine idea from the INVENTOR's material only. Empty fields where they haven't reached that artifact. Never invent.",
  ].join("\n");
  return runAgent({
    agent: "structurer",
    system,
    prompt,
    schema: StructurerOutput,
    temperature: 0.1,
    subject: input.rawIdea,
  });
}

/* ------------------------------------------------------------------ *
 * Brief writer
 * ------------------------------------------------------------------ */

export const BriefWriterOutput = z.object({
  brief: z.string(),
  /** Non-blocking implementation details deliberately kept OUT of the brief and
   *  carried forward internally (into the ledger) — never shown to the inventor here. */
  carry_forward: z.array(z.string()).default([]),
  traceable: z.boolean().default(true),
});
export type BriefWriterResult = z.infer<typeof BriefWriterOutput>;

/** The structured pillars fed to the brief-writer — already extracted from the
 *  inventor's messages and provenance-checked by the structurer. Flattened to
 *  strings so the writer only organizes substance, never re-reads raw chat. */
export type BriefWriterInput = {
  rawIdea: string;
  mechanism: string;
  machineLimitation: string[];
  orderedBehavior: string[];
  stateFlowChange: string[];
  technicalEffect: string[];
  requirementConflict: string[];
  carryForward: string[];
};

export async function runBriefWriter(
  runAgent: AgentRunner,
  input: BriefWriterInput,
): Promise<BriefWriterResult> {
  const system = await loadAgentPrompt("brief-writer");
  const block = (label: string, items: string[]) =>
    `${label}:\n${items.length ? items.map((t) => `- ${t}`).join("\n") : "(none)"}`;
  const prompt = [
    "THE INVENTOR'S RAW IDEA (their own words):",
    input.rawIdea || "(none)",
    "",
    "THE MACHINE MECHANISM the inventor surfaced (lead with this):",
    input.mechanism || "(none surfaced)",
    "",
    "The structured pieces below were extracted from the inventor's own messages and provenance-checked. Organize them into the brief — never add anything not present here or in the raw idea.",
    "",
    block("PILLAR 1 — MACHINE LIMITATION", input.machineLimitation),
    "",
    block("PILLAR 2 — ORDERED SYSTEM BEHAVIOR (order matters)", input.orderedBehavior),
    "",
    block("PILLAR 3 — STATE / INFORMATION-FLOW CHANGE", input.stateFlowChange),
    "",
    block("PILLAR 4 — RESULTING TECHNICAL EFFECT", input.technicalEffect),
    "",
    block("REQUIREMENT CONFLICT (context only)", input.requirementConflict),
    "",
    block(
      "INTERNAL — NON-BLOCKING DETAILS (keep OUT of the brief; echo back in carry_forward)",
      input.carryForward,
    ),
    "",
    "Write the brief: concise, mechanism-first, four pillars in order, no doubt, no questions, no narration, no legal language. Only the inventor's substance.",
  ].join("\n");
  return runAgent({
    agent: "brief-writer",
    system,
    prompt,
    schema: BriefWriterOutput,
    temperature: 0.2,
    subject: input.rawIdea,
  });
}
