/**
 * The shared module-Helper: the schema every module's replying Helper returns and
 * the prompt builder they all share. Each module supplies its own thin
 * `00-helper.md` prompt (module-aware, on the shared HELPER_DOCTRINE) and its live
 * context string; this assembles the fuel and validates the reply. Keeps the four
 * card-flow modules (Maturation/Landscape/Differentiation/Showcase) from each
 * re-deriving the same Helper plumbing.
 */
import { z } from "zod";

/**
 * What a module Helper returns: a SHORT reply, and — only when something is
 * genuinely needed — at most ONE question with tap-to-answer options. No walls of
 * text, no five-question interrogations. An empty `question.ask` means no question.
 */
export const HelperOutput = z.object({
  /** A question to answer, a note to acknowledge, or something else. */
  intent: z.enum(["question", "note", "other"]).default("note"),
  /** The plain-language reply shown to the inventor — SHORT (1–3 sentences). Teaches/brainstorms, never invents the substance for them. */
  reply: z.string().default(""),
  /** At most ONE short question. Leave `ask` empty when nothing is needed. */
  question: z
    .object({
      /** The single short question (empty = no question this turn). */
      ask: z.string().default(""),
      /** One short line on why it helps — optional. */
      why: z.string().default(""),
      /** 2–4 short proposed answers the inventor can tap; they can always type their own. */
      options: z.array(z.string()).default([]),
    })
    .default({ ask: "", why: "", options: [] }),
});
export type HelperResult = z.infer<typeof HelperOutput>;

/* ------------------------------------------------------------------ *
 * "What's on screen" — a generic renderer for the cards the inventor is
 * looking at right now. Every module feeds its open cards through this so the
 * Helper is ALWAYS aware of the current screen, not just told "N cards open".
 * Generic over card shape (drops internal ids, caps each field and array) so it
 * keeps working as card types change, without per-card-type maintenance.
 * ------------------------------------------------------------------ */

const SCREEN_DROP_KEYS = new Set(["id", "artifactId", "conceptId", "cardId"]);
const SCREEN_FIELD_CAP = 500;
const SCREEN_ARRAY_CAP = 8;

function renderScreenValue(v: unknown, depth: number): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    return s.length > SCREEN_FIELD_CAP ? `${s.slice(0, SCREEN_FIELD_CAP)}…` : s;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (!v.length) return null;
    const items = v
      .slice(0, SCREEN_ARRAY_CAP)
      .map((x) => renderScreenValue(x, depth + 1))
      .filter(Boolean) as string[];
    if (!items.length) return null;
    const more = v.length > SCREEN_ARRAY_CAP ? ` …(+${v.length - SCREEN_ARRAY_CAP} more)` : "";
    return items.join("; ") + more;
  }
  if (typeof v === "object") {
    if (depth >= 2) return "[…]";
    const parts: string[] = [];
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SCREEN_DROP_KEYS.has(k)) continue;
      const r = renderScreenValue(val, depth + 1);
      if (r) parts.push(`${k}=${r}`);
    }
    return parts.length ? `{ ${parts.join(", ")} }` : null;
  }
  return null;
}

/**
 * Render the cards currently on the inventor's screen to readable text. Pass the
 * module's live open cards (e.g. `[...openCards.values()]`); returns an explicit
 * "nothing on screen" line when there are none, so the Helper never guesses.
 */
export function renderScreenCards(cards: readonly unknown[]): string {
  if (!cards.length) return "Nothing is on the inventor's screen right now (no cards open).";
  const lines: string[] = [];
  cards.forEach((card, i) => {
    const c = (card ?? {}) as Record<string, unknown>;
    const type = typeof c.type === "string" ? c.type : "card";
    lines.push(`On-screen card ${i + 1} — ${type}:`);
    for (const [k, v] of Object.entries(c)) {
      if (k === "type" || SCREEN_DROP_KEYS.has(k)) continue;
      const r = renderScreenValue(v, 1);
      if (r) lines.push(`  ${k}: ${r}`);
    }
  });
  return lines.join("\n");
}

/** Assemble the Helper's user prompt from the module's live context. */
export function buildHelperPrompt(input: {
  /** Exactly what the inventor just typed. */
  message: string;
  /** Where they are, e.g. "Module 2 (Maturation) — deepening your owned concepts for prior-art search". */
  where: string;
  /** Module-specific live state (open cards, the concept under review, prior art, etc.). */
  context: string;
  /** Everything the inventor has stated in their own words — the ONLY source of inventive substance. */
  inventorMaterial: string;
  /** Recent turns, oldest first. */
  conversation: { role: string; text: string }[];
  /** What's already settled for this patent (optional). */
  consciousness?: string;
  /** The `## FAMILY CONTEXT` block (sibling Projects' concepts + family background), optional. */
  familyContext?: string;
}): string {
  return [
    "HOW TO REPLY: keep `reply` to 1–3 sentences. Ask AT MOST ONE short question, and only if you genuinely need it — put it in `question.ask` with 2–4 short tap-to-answer `options`. Accept simple answers; never re-ask the same thing with more questions. If nothing is needed, leave `question.ask` empty.",
    "GROUND EVERYTHING IN WHAT YOU CAN SEE — the LIVE CONTEXT and the inventor's material are your ONLY sources. If they ask you to review, quote, or polish something that isn't in the context (e.g. a draft that wasn't provided), say so plainly THIS turn — never invent specifics, quote lines you can't see, or promise to produce them in a later turn. When the context already lets you answer, DELIVER the answer now instead of ending on a question.",
    "",
    "THE INVENTOR JUST SAID (read what they mean, then reply — if it's a question, ANSWER it):",
    input.message,
    "",
    `WHERE THEY ARE: ${input.where}`,
    "",
    "THE LIVE CONTEXT (what's on screen / under review right now):",
    input.context || "(nothing specific yet)",
    "",
    "RECENT CONVERSATION (oldest first):",
    input.conversation.length
      ? input.conversation
          .map((t) => `${t.role === "helper" ? "HELPER" : "INVENTOR"}: ${t.text}`)
          .join("\n")
      : "(none yet)",
    "",
    "THE INVENTOR'S OWN MATERIAL SO FAR (the ONLY source of inventive substance — you may brainstorm directions and teach, but never write their inventive answer for them):",
    input.inventorMaterial || "(none yet)",
    ...(input.consciousness
      ? ["", "WHAT'S ALREADY SETTLED FOR THIS PATENT (stay consistent):", input.consciousness]
      : []),
    ...(input.familyContext ? ["", input.familyContext] : []),
  ].join("\n");
}
