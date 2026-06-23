import "server-only";
import { streamText, generateText } from "ai";
import { MODELS } from "./openai";
import {
  HELPER_PERSONA,
  backpackFor,
  SOCRATIC_STRATEGIES,
  type SocraticStrategy,
} from "./backpack";

type Turn = { role: "user" | "helper"; content: string };

function toModelMessages(history: Turn[]) {
  return history.map((t) => ({
    role: (t.role === "helper" ? "assistant" : "user") as
      | "assistant"
      | "user",
    content: t.content,
  }));
}

/**
 * Stream the Helper's next Socratic question. Returns an async iterable of text
 * deltas so the route can forward tokens as {type:"token"} events.
 */
export async function streamHelperQuestion(opts: {
  phase: string;
  history: Turn[];
  message: string;
  contextSummary?: string;
  disavowedQuote?: string | null;
}) {
  const { phase, history, message, contextSummary, disavowedQuote } = opts;

  const system = [
    HELPER_PERSONA,
    backpackFor(phase),
    contextSummary
      ? `INVENTOR'S UPLOADED CONTEXT (for grounding analogies only, not as their words):\n${contextSummary}`
      : "",
    disavowedQuote
      ? `The inventor just DISAVOWED this text: "${disavowedQuote}". Acknowledge the correction in one short clause, then ask your next question to re-extract that part correctly.`
      : "",
    "Respond with at most 3 sentences. End with exactly one question.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await streamText({
    model: MODELS.helper,
    system,
    messages: [...toModelMessages(history), { role: "user", content: message }],
    temperature: 0.4,
  });

  return result.textStream;
}

/**
 * When the Drafter signals a gap, the Helper picks a Socratic strategy and
 * generates a single targeted prompt to close it.
 */
export async function socraticFallback(opts: {
  phase: string;
  gap: string;
  strategy: SocraticStrategy;
  contextSummary?: string;
}) {
  const { phase, gap, strategy, contextSummary } = opts;
  const { text } = await generateText({
    model: MODELS.helper,
    system: [
      HELPER_PERSONA,
      backpackFor(phase),
      `STRATEGY: ${SOCRATIC_STRATEGIES[strategy]}`,
      contextSummary
        ? `Inventor's uploaded context for grounding: ${contextSummary}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    prompt: `A drafting gap was detected: "${gap}". Using the strategy above, ask ONE question that extracts exactly the missing detail. Output only the question.`,
    temperature: 0.5,
  });
  return text.trim();
}

/**
 * Distill the inventor's accumulated core-novelty inputs into a tight
 * "Current Idea" statement for the Left Sidebar. Pure summarization — adds no
 * new technical substance.
 */
export async function distillIdea(humanInputs: string[]): Promise<string> {
  if (humanInputs.length === 0) return "";
  const { text } = await generateText({
    model: MODELS.distiller,
    system:
      "You compress an inventor's own statements into a crisp 1-2 sentence summary of their invention. Use ONLY their words and facts. Add nothing. No preamble.",
    prompt: humanInputs.map((h, i) => `(${i + 1}) ${h}`).join("\n"),
    temperature: 0,
  });
  return text.trim();
}

/** Pick a strategy that varies with how stuck the inventor is. */
export function chooseStrategy(consecutiveDontKnow: number): SocraticStrategy {
  if (consecutiveDontKnow >= 3) return "analogy";
  if (consecutiveDontKnow === 2) return "edge_case";
  return "direct";
}
