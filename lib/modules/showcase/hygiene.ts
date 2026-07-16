/**
 * A1 — Key Concept hygiene lint (Module 5 rebuild, spec §3 A1). The DETERMINISTIC
 * "Produce" half of the hygiene chain: near-duplicate detection, an internal-
 * vocabulary lexicon, meta-commentary markers, and a subjective-term lexicon.
 * (Spellcheck needs a dictionary dependency and is stubbed below.) The semantic-
 * duplicate "Verify" half runs on the second model and is wired by the chain.
 *
 * Findings carry a quote + a rubric-id citation, per R1, so they may gate cards.
 * Pure — no server-only imports.
 */

import type { Finding } from "./chain";

/**
 * Near-duplicate similarity threshold. Set HIGH on purpose: this module's job is to
 * BROADEN and differentiate, never to merge or shrink the claims-core, so the lint
 * fires only on near-identical wording (accidental copies), not on distinct concepts
 * that happen to share a lot of domain vocabulary.
 */
export const NEAR_DUP_THRESHOLD = 0.95;

/**
 * Internal-vocabulary lexicon: pipeline tokens and template category names that
 * must never appear in inventor-facing Key Concept text. Fixture-validated:
 * ai_assisted, ai_native, agentic, hardware_optimization all appear in the shipped
 * B text. Snake_case, code-origin tokens only — kept tight to avoid flagging
 * ordinary words the inventor might legitimately use.
 */
export const INTERNAL_VOCAB = [
  "ai_assisted",
  "ai_native",
  "agentic",
  "hardware_optimization",
  "genus_mechanism",
  "species_spectrum",
  "conceptaspects",
  "enumerator",
  "formalizer",
  "breadth_assessor",
  "baseline_builder",
  "detail_across",
] as const;

/** Meta-commentary markers: text talking ABOUT the concept rather than being it. */
export const META_MARKERS = [
  "this key concept",
  "the following key concept",
  "as described above",
  "as an ai",
  "i cannot",
  "i can't",
  "note that",
  "note:",
  "in summary",
  "to summarize",
  "here is",
  "here's",
  "as mentioned",
  "as noted",
] as const;

/** Subjective / indefinite terms (MPEP 2173.05(b) family). */
export const SUBJECTIVE_TERMS = [
  "better",
  "best",
  "improved",
  "optimal",
  "optimized",
  "efficient",
  "efficiently",
  "seamless",
  "seamlessly",
  "robust",
  "novel",
  "innovative",
  "superior",
  "significantly",
  "substantial",
  "substantially",
  "user-friendly",
  "powerful",
  "advanced",
  "sophisticated",
  "cutting-edge",
  "state-of-the-art",
  "high-quality",
  "easily",
  "flexible",
  "scalable",
  "reliable",
] as const;

/** A minimal KC shape for linting (title + statement). */
export type LintKC = { id: string; title: string; statement: string };

/** Lowercase word tokens. */
function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1);
}

/** Cosine similarity over term-frequency vectors (paraphrases score high). */
export function cosineSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.length || !tb.length) return 0;
  const fa = new Map<string, number>();
  const fb = new Map<string, number>();
  for (const t of ta) fa.set(t, (fa.get(t) ?? 0) + 1);
  for (const t of tb) fb.set(t, (fb.get(t) ?? 0) + 1);
  let dot = 0;
  for (const [t, n] of fa) dot += n * (fb.get(t) ?? 0);
  const mag = (m: Map<string, number>) =>
    Math.sqrt([...m.values()].reduce((s, n) => s + n * n, 0));
  const denom = mag(fa) * mag(fb);
  return denom === 0 ? 0 : dot / denom;
}

export type DuplicatePair = { a: LintKC; b: LintKC; similarity: number };

/** Near-duplicate pairs at or above the threshold (byte equality would miss these). */
export function findNearDuplicates(
  kcs: LintKC[],
  threshold = NEAR_DUP_THRESHOLD,
): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < kcs.length; i++) {
    for (let j = i + 1; j < kcs.length; j++) {
      const sim = cosineSimilarity(
        `${kcs[i].title} ${kcs[i].statement}`,
        `${kcs[j].title} ${kcs[j].statement}`,
      );
      if (sim >= threshold) pairs.push({ a: kcs[i], b: kcs[j], similarity: sim });
    }
  }
  return pairs;
}

/** Case-insensitive whole-token/phrase presence, returning the matched substring. */
function findFirst(text: string, needles: readonly string[]): string | null {
  const hay = text.toLowerCase();
  for (const n of needles) {
    const idx = hay.indexOf(n);
    if (idx >= 0) return text.slice(idx, idx + n.length);
  }
  return null;
}

/**
 * The deterministic lint over one KC. Returns findings (quote + rubric citation).
 * Duplicate detection is cross-KC and handled by findNearDuplicates separately.
 */
export function lintKC(kc: LintKC): Finding[] {
  const findings: Finding[] = [];
  const text = `${kc.title}\n${kc.statement}`;

  const internal = findFirst(text, INTERNAL_VOCAB);
  if (internal) {
    findings.push({
      quote: internal,
      citation: "LINT.internal_vocab",
      rule: "internal pipeline / template token in inventor-facing text",
    });
  }
  const meta = findFirst(text, META_MARKERS);
  if (meta) {
    findings.push({
      quote: meta,
      citation: "LINT.meta_commentary",
      rule: "meta-commentary: text describing the concept rather than being it",
    });
  }
  // Subjective terms match on word boundaries to avoid substring false positives.
  const lower = text.toLowerCase();
  for (const term of SUBJECTIVE_TERMS) {
    const re = new RegExp(`\\b${term.replace(/[-]/g, "[- ]")}\\b`, "i");
    const m = text.match(re);
    if (m && lower.includes(term.split(/[- ]/)[0])) {
      findings.push({
        quote: m[0],
        citation: "MPEP 2173.05(b)",
        rule: "subjective / indefinite term",
      });
      break; // one subjective-term finding per KC is enough to card it
    }
  }
  return findings;
}
