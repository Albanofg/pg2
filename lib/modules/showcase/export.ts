import "server-only";
import type { LedgerEntry } from "@/lib/modules/shared";
import type { DisclosureSection, ShowcaseKeyConcept } from "./types";

/**
 * Export assembly for Module 5 — turns the finished module state into the two
 * deliverables: the Invention Disclosure document and the proof-package content
 * that gets RFC-3161 sealed. Pure string assembly; the route does the sealing.
 */

/** Assemble the Invention Disclosure as Markdown (sections + Key Concepts). */
export function assembleDisclosureMarkdown(
  disclosure: DisclosureSection[],
  keyConcepts: ShowcaseKeyConcept[],
): string {
  const lines: string[] = ["# Invention Disclosure", ""];
  if (disclosure.length) {
    for (const s of disclosure) {
      lines.push(`## ${s.label}`, "", s.body.trim(), "");
    }
  } else {
    lines.push("_(no compiled disclosure available)_", "");
  }
  lines.push("## Key Concepts", "");
  if (keyConcepts.length) {
    keyConcepts.forEach((k, i) => {
      lines.push(`${i + 1}. **${k.title}** — ${k.broadened || k.statement}`);
      if (k.broadened) lines.push(`   _(broadened, meaning-preserving form)_`);
    });
  } else {
    lines.push("_(no Key Concepts)_");
  }
  lines.push("");
  lines.push("---", "", "_Invention Disclosure — for review by a registered patent practitioner. Not a filing._");
  return lines.join("\n");
}

/**
 * Build the inventor's-notebook content that proves human conception: the full,
 * ordered Ledger — every verbatim inventor input, every decision, and every
 * chained checkpoint. This deterministic text is what gets hashed and sealed.
 */
export function buildProofContent(entries: LedgerEntry[]): string {
  const lines: string[] = [
    "INVENTOR'S NOTEBOOK — Proof of Human Conception",
    `Entries: ${entries.length}`,
    "",
  ];
  for (const e of entries) {
    const tags = e.tags?.length ? ` [${e.tags.join(", ")}]` : "";
    const body = e.verbatim_text ? `\n    ${e.verbatim_text}` : "";
    const seal =
      e.type === "checkpoint" && e.meta ? `\n    ${JSON.stringify(e.meta)}` : "";
    lines.push(`${e.timestamp} · ${e.type} (${e.origin})${tags}${body}${seal}`);
  }
  return lines.join("\n");
}
