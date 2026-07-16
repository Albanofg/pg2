/**
 * Rendering contract checks — Module 5 rebuild, spec §8 (deterministic gate on the
 * apply path). Three rules: enumerations stay enumerated (never flattened to
 * prose), every cross-reference resolves to the list it names, and one vocabulary
 * runs across the specification. A contract failure blocks the write and surfaces
 * the diff (§8 "apply then … contract checks over the assembled result, and
 * writes; a contract failure blocks the write").
 *
 * On today's prose-only artifacts these fire nothing; they become load-bearing
 * once §112 enumerations (constraints / invariants / operation sequences) render.
 * Pure — no server-only imports.
 */

import type { Finding } from "./chain";

/** The disclosure section shape this operates on (matches DisclosureSection). */
export type ContractSection = { key: string; label: string; body: string };

/** An enumeration the render is expected to preserve as a list. */
export type ExpectedEnumeration = { name: string; items: string[] };

const LIST_LINE = /^\s*(?:[-*•]|\(?\d+[.)]|[a-z][.)])\s+\S/;

/** Does this text contain at least one enumerated (list-formatted) line? */
export function hasEnumeration(text: string): boolean {
  return text.split(/\r?\n/).some((line) => LIST_LINE.test(line));
}

/** The list items present in a body (trimmed of their markers). */
export function listItems(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => LIST_LINE.test(line))
    .map((line) => line.replace(/^\s*(?:[-*•]|\(?\d+[.)]|[a-z][.)])\s+/, "").trim())
    .filter(Boolean);
}

/**
 * Cross-references that name an enumerated list ("the computational constraints",
 * "the operation sequence", "the following steps") but resolve to no list present
 * anywhere in the sections. Each unresolved reference is a finding.
 */
const NAMED_LISTS: { phrase: RegExp; needsListLike: string }[] = [
  { phrase: /\bthe (computational )?constraints\b/i, needsListLike: "constraint" },
  { phrase: /\bthe (logical )?invariants\b/i, needsListLike: "invariant" },
  { phrase: /\bthe operation sequence\b/i, needsListLike: "operation" },
  { phrase: /\bthe following (steps|constraints|invariants)\b/i, needsListLike: "" },
];

export function crossReferenceFindings(sections: ContractSection[]): Finding[] {
  const findings: Finding[] = [];
  const anyList = sections.some((s) => hasEnumeration(s.body));
  for (const s of sections) {
    for (const nl of NAMED_LISTS) {
      const m = s.body.match(nl.phrase);
      if (!m) continue;
      // Resolves if SOME section carries an enumeration (the named list exists).
      if (!anyList) {
        findings.push({
          quote: m[0],
          citation: "CONTRACT.cross_reference",
          rule: `cross-reference "${m[0]}" resolves to no enumerated list in the disclosure`,
          detail: `in section "${s.label}"`,
        });
      }
    }
  }
  return findings;
}

/**
 * Enumeration preservation: each expected enumeration's items must appear as list
 * items in the rendered text. An item merged into prose (present as a substring but
 * not as its own list line) is a flattening defect.
 */
export function enumerationPreservationFindings(
  text: string,
  expected: ExpectedEnumeration[],
): Finding[] {
  if (!expected.length) return [];
  const rendered = new Set(listItems(text).map((i) => i.toLowerCase()));
  const findings: Finding[] = [];
  for (const enumr of expected) {
    for (const item of enumr.items) {
      const asItem = rendered.has(item.trim().toLowerCase());
      const asProse = text.toLowerCase().includes(item.trim().toLowerCase());
      if (!asItem && asProse) {
        findings.push({
          quote: item,
          citation: "CONTRACT.enumeration_flattened",
          rule: `"${enumr.name}" item flattened into prose instead of kept as an enumeration`,
        });
      }
    }
  }
  return findings;
}

/**
 * Run the deterministic rendering contract over an assembled disclosure. Empty =
 * clean (write may proceed); any finding blocks the write and is surfaced.
 */
export function checkRenderingContract(
  sections: ContractSection[],
  expected: { sectionKey: string; enumerations: ExpectedEnumeration[] }[] = [],
): Finding[] {
  const findings: Finding[] = [...crossReferenceFindings(sections)];
  for (const exp of expected) {
    const s = sections.find((x) => x.key === exp.sectionKey);
    if (s) findings.push(...enumerationPreservationFindings(s.body, exp.enumerations));
  }
  return findings;
}
