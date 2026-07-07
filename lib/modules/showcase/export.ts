import "server-only";
import type { Paragraph as DocxParagraph, TextRun as DocxTextRun } from "docx";
import type { LedgerEntry } from "@/lib/modules/shared";
import type { DisclosureSection, ShowcaseDrawing, ShowcaseKeyConcept } from "./types";

/**
 * Export assembly for Module 5 — turns the finished module state into the two
 * deliverables: the Invention Disclosure document and the proof-package content
 * that gets RFC-3161 sealed. Pure string assembly; the route does the sealing.
 */

/** Assemble the Invention Disclosure as Markdown (sections + Key Concepts + Drawings). */
export function assembleDisclosureMarkdown(
  disclosure: DisclosureSection[],
  keyConcepts: ShowcaseKeyConcept[],
  drawings: ShowcaseDrawing[] = [],
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
  if (drawings.length) {
    lines.push("## Drawings", "");
    lines.push("### Brief Description of the Drawings", "");
    for (const d of drawings) {
      lines.push(`- ${d.briefDescription || `FIG. ${d.figNumber} — ${d.title}`}`);
    }
    lines.push("", "### Detailed Description of the Drawings", "");
    for (const d of drawings) {
      if (d.detailedDescription) lines.push(d.detailedDescription.trim(), "");
    }
  }
  return lines.join("\n");
}

/**
 * Compact text of just the Key Concepts — the CAPPED input for diagram
 * generation. The diagram service renders the full disclosure too slowly (and
 * can wedge its single worker on large input), so for now we feed it only the
 * Key Concepts: one line per concept, "N. <title> — <broadened|statement>".
 * Revisit (send more of the draft) once that service is faster or async.
 */
export function assembleKeyConceptsText(keyConcepts: ShowcaseKeyConcept[]): string {
  const lines: string[] = ["Key Concepts", ""];
  keyConcepts.forEach((k, i) => {
    lines.push(`${i + 1}. ${k.title} — ${(k.broadened || k.statement).trim()}`);
  });
  return lines.join("\n").trim();
}

/* ------------------------------------------------------------------ *
 * Word (.docx) rendering
 *
 * Same mechanism as V1: the `docx` package builds a real OOXML document
 * object-by-object (Paragraph/TextRun), then Packer serializes it to bytes.
 * Both `docx` and `marked` are heavy, so they're dynamically imported only when
 * an export actually runs. No Word/template/temp-file is ever involved.
 *
 * Formatting follows V1's disclosure rules, adapted to app 2:
 *   - a single running [0001] paragraph counter across the whole document,
 *     zero-padded to 4 digits, on every body paragraph / list item / caption /
 *     Key-Concept entry — never on headings or the title;
 *   - 12pt body, 13pt bold sub-headings, HEADING_1 sections, 1.2× line spacing;
 *   - sections render in app 2's own canonical order, with the Abstract forced
 *     to the very end (own page) and Key Concepts on their own page.
 * ------------------------------------------------------------------ */

// docx sizes are in half-points; spacing/indent are in twentieths of a point.
const BODY = 24; // 12pt (USPTO 37 CFR 1.52: nonscript, ≥12pt)
const SUBHEAD = 26; // 13pt bold sub-heading
const SECTION = 28; // 14pt bold section heading
const TITLE_SIZE = 36; // 18pt bold document title
const NOTE = 20; // 10pt footer
const LINE = 360; // 1.5× line spacing (USPTO 37 CFR 1.52 minimum)
const INDENT = 360; // list indent
const FONT = "Times New Roman"; // nonscript body font (patent-spec convention)
const BLACK = "000000";
const MUTED = "666666";
const RED = "C00000"; // the PoHC warning red (V1's brand red)

/** [0001]-style paragraph label from a running counter. */
function formatParaNumber(n: number): string {
  return `[${String(n).padStart(4, "0")}]`;
}

/**
 * Clean agent-authored markdown before it is parsed and numbered: decode literal
 * \uXXXX escapes, strip stray markdown-table syntax and its header leftovers, and
 * collapse long blank runs. Mirrors V1's processTextForDocx.
 */
function processTextForDocx(text: string): string {
  let t = text.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) =>
    String.fromCharCode(parseInt(h, 16)),
  );
  // Drop table separator rows ( | --- | :--: | ), then flatten remaining pipe rows.
  t = t
    .split("\n")
    .filter((line) => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line))
    .map((line) => (line.includes("|") ? line.replace(/\|/g, " ").replace(/\s{2,}/g, " ").trim() : line))
    .join("\n");
  // Stray table-header leftovers and long dash runs.
  t = t.replace(/\b(Support Map|Claim Limitation|Supporting Specification Excerpt)\b/g, "");
  t = t.replace(/-{3,}/g, "");
  // Collapse 3+ blank lines to a single blank line.
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

/** Rewrite V1-style [SECTION: X] markers into markdown sub-headings. */
function preprocessMarkdown(text: string): string {
  return text.replace(/\[SECTION:\s*([^\]]+)\]/g, (_m, name) => `\n\n## ${String(name).trim()}\n\n`);
}

/** Strip a pre-existing "1." / "2)" ordinal prefix to avoid double-numbering. */
function stripLeadingOrdinal(text: string): string {
  return text.replace(/^\s*\d+[.)]\s*/, "").trim();
}

/** Flatten marked inline tokens into styled TextRuns (bold / italic / code). */
function inlineRunsFromTokens(
  tokens: any[] | undefined,
  docx: typeof import("docx"),
  opts: { bold?: boolean; italic?: boolean; size?: number } = {},
): DocxTextRun[] {
  const { TextRun } = docx;
  const { bold = false, italic = false, size = BODY } = opts;
  const runs: DocxTextRun[] = [];
  for (const tk of tokens ?? []) {
    switch (tk.type) {
      case "strong":
        runs.push(...inlineRunsFromTokens(tk.tokens, docx, { ...opts, bold: true, size }));
        break;
      case "em":
        runs.push(...inlineRunsFromTokens(tk.tokens, docx, { ...opts, italic: true, size }));
        break;
      case "codespan":
        runs.push(new TextRun({ text: tk.text ?? "", bold, italics: italic, size, font: "Consolas" }));
        break;
      case "link":
        runs.push(...inlineRunsFromTokens(tk.tokens, docx, opts));
        break;
      case "br":
        runs.push(new TextRun({ text: "", break: 1 }));
        break;
      default:
        if (Array.isArray(tk.tokens) && tk.tokens.length) {
          runs.push(...inlineRunsFromTokens(tk.tokens, docx, opts));
        } else {
          runs.push(new TextRun({ text: tk.text ?? tk.raw ?? "", bold, italics: italic, size }));
        }
    }
  }
  if (!runs.length) runs.push(new TextRun({ text: "", size }));
  return runs;
}

/** A numbered body paragraph: leading [00NN] run + the content runs. */
function numberedParagraph(
  counter: { n: number },
  contentRuns: DocxTextRun[],
  docx: typeof import("docx"),
  extra: Record<string, unknown> = {},
): DocxParagraph {
  const { Paragraph, TextRun } = docx;
  const label = formatParaNumber(counter.n++);
  return new Paragraph({
    spacing: { line: LINE, after: 120 },
    children: [new TextRun({ text: `${label} `, size: BODY }), ...contentRuns],
    ...extra,
  });
}

/**
 * Convert a section body (markdown) into numbered Word paragraphs via marked's
 * lexer. Paragraphs and list items each take the next [00NN]; sub-headings (##)
 * render as unnumbered 13pt bold. Unknown tokens still get numbered so nothing
 * silently loses its number.
 */
function markdownToParagraphs(
  md: string,
  docx: typeof import("docx"),
  marked: typeof import("marked").marked,
  counter: { n: number },
): DocxParagraph[] {
  const { Paragraph, TextRun } = docx;
  const out: DocxParagraph[] = [];
  let tokens: any[];
  try {
    tokens = marked.lexer(preprocessMarkdown(md));
  } catch {
    // If the markdown can't be parsed, keep the text rather than dropping it.
    return [numberedParagraph(counter, [new TextRun({ text: md.trim(), size: BODY })], docx)];
  }

  for (const token of tokens) {
    switch (token.type) {
      case "heading":
        out.push(
          new Paragraph({
            spacing: { line: LINE, before: 160, after: 80 },
            children: inlineRunsFromTokens(token.tokens, docx, { size: SUBHEAD, bold: true }),
          }),
        );
        break;
      case "paragraph":
        out.push(numberedParagraph(counter, inlineRunsFromTokens(token.tokens, docx), docx));
        break;
      case "list": {
        const ordered = !!token.ordered;
        let idx = typeof token.start === "number" ? token.start : 1;
        for (const item of token.items ?? []) {
          const inlineToks: any[] = [];
          for (const sub of item.tokens ?? []) {
            if (Array.isArray(sub.tokens) && sub.tokens.length) inlineToks.push(...sub.tokens);
            else inlineToks.push(sub);
          }
          const prefix = ordered ? `${idx}. ` : "• ";
          out.push(
            new Paragraph({
              spacing: { line: LINE, after: 60 },
              indent: { left: INDENT },
              children: [
                new TextRun({ text: `${formatParaNumber(counter.n++)} ${prefix}`, size: BODY }),
                ...inlineRunsFromTokens(inlineToks, docx),
              ],
            }),
          );
          idx++;
        }
        break;
      }
      case "space":
        break;
      default: {
        const raw = (token.raw ?? "").trim();
        if (raw) out.push(numberedParagraph(counter, [new TextRun({ text: raw, size: BODY })], docx));
      }
    }
  }
  return out;
}

/** An uppercase HEADING_1 section title (never numbered), optional page break. */
function sectionHeading(
  label: string,
  docx: typeof import("docx"),
  opts: { pageBreakBefore?: boolean } = {},
): DocxParagraph {
  const { Paragraph, TextRun, HeadingLevel } = docx;
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: !!opts.pageBreakBefore,
    spacing: { before: 240, after: 120 },
    // Override the docx HEADING_1 default (16pt Word-blue, not bold) → black bold.
    children: [new TextRun({ text: label.toUpperCase(), bold: true, color: BLACK, size: SECTION, font: FONT })],
  });
}

/** Key Concepts, each numbered "[00NN] Key Concept N: <title> — <text>". */
function keyConceptParagraphs(
  keyConcepts: ShowcaseKeyConcept[],
  docx: typeof import("docx"),
  counter: { n: number },
): DocxParagraph[] {
  const { Paragraph, TextRun } = docx;
  if (!keyConcepts.length) {
    return [
      new Paragraph({
        spacing: { line: LINE },
        children: [new TextRun({ text: "(no Key Concepts)", italics: true, size: BODY })],
      }),
    ];
  }
  const out: DocxParagraph[] = [];
  keyConcepts.forEach((k, i) => {
    const text = stripLeadingOrdinal(k.broadened || k.statement);
    out.push(
      new Paragraph({
        spacing: { line: LINE, after: 80 },
        children: [
          new TextRun({ text: `${formatParaNumber(counter.n++)} `, size: BODY }),
          new TextRun({ text: `Key Concept ${i + 1}: ${k.title} — `, bold: true, size: BODY }),
          new TextRun({ text, size: BODY }),
        ],
      }),
    );
    if (k.broadened) {
      out.push(
        new Paragraph({
          spacing: { line: LINE, after: 80 },
          children: [
            new TextRun({
              text: "(broadened, meaning-preserving form)",
              italics: true,
              size: NOTE,
              color: MUTED,
            }),
          ],
        }),
      );
    }
  });
  return out;
}

/**
 * The Drawings section: "Brief Description of the Drawings" (one numbered line per
 * figure) then "Detailed Description of the Drawings" (the grounded per-figure
 * walkthrough). Text only — the figure images themselves live in the app's
 * Drawings tab and the per-figure PDFs; embedding raster images in the .docx would
 * need an SVG→PNG rasterizer (a follow-up).
 */
function drawingParagraphs(
  drawings: ShowcaseDrawing[],
  docx: typeof import("docx"),
  counter: { n: number },
): DocxParagraph[] {
  const { Paragraph, TextRun } = docx;
  const out: DocxParagraph[] = [];
  out.push(
    new Paragraph({
      spacing: { line: LINE, before: 160, after: 80 },
      children: [new TextRun({ text: "Brief Description of the Drawings", bold: true, size: SUBHEAD })],
    }),
  );
  drawings.forEach((d) => {
    const brief = (d.briefDescription || `FIG. ${d.figNumber} is a diagram of ${d.title}.`).trim();
    out.push(
      new Paragraph({
        spacing: { line: LINE, after: 60 },
        children: [
          new TextRun({ text: `${formatParaNumber(counter.n++)} `, size: BODY }),
          new TextRun({ text: brief, size: BODY }),
        ],
      }),
    );
  });
  out.push(
    new Paragraph({
      spacing: { line: LINE, before: 200, after: 80 },
      children: [new TextRun({ text: "Detailed Description of the Drawings", bold: true, size: SUBHEAD })],
    }),
  );
  drawings.forEach((d) => {
    const detail = (d.detailedDescription || "").trim();
    if (!detail) return;
    out.push(
      new Paragraph({
        spacing: { line: LINE, after: 120 },
        children: [
          new TextRun({ text: `${formatParaNumber(counter.n++)} `, size: BODY }),
          new TextRun({ text: detail, size: BODY }),
        ],
      }),
    );
  });
  return out;
}

/**
 * Assemble the Invention Disclosure as a real Word document and return the
 * serialized .docx bytes (Node Buffer). Sections render in app 2's canonical
 * order; a Drawings section (descriptions) sits before Key Concepts; the Abstract
 * is pulled out and forced to the very end on its own page.
 */
export async function assembleDisclosureDocx(
  disclosure: DisclosureSection[],
  keyConcepts: ShowcaseKeyConcept[],
  drawings: ShowcaseDrawing[] = [],
): Promise<Buffer> {
  const docx = await import("docx");
  const { marked } = await import("marked");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Footer, PageNumber } =
    docx;
  const counter = { n: 1 };

  const titleSection = disclosure.find((s) => s.key === "title");
  const abstractSection = disclosure.find((s) => s.key === "abstract");
  // Everything else, in the canonical order it already arrives in.
  const bodySections = disclosure.filter((s) => s.key !== "title" && s.key !== "abstract");
  // Analog of V1's "Detailed Description starts a new page": the technical body begins here.
  const DETAIL_START = "architecture";

  const children: DocxParagraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: titleSection?.body ? processTextForDocx(titleSection.body).replace(/\n+/g, " ") : "Invention Disclosure",
          bold: true,
          color: BLACK,
          size: TITLE_SIZE,
          font: FONT,
        }),
      ],
    }),
  ];

  if (bodySections.length) {
    for (const s of bodySections) {
      children.push(sectionHeading(s.label, docx, { pageBreakBefore: s.key === DETAIL_START }));
      children.push(...markdownToParagraphs(processTextForDocx(s.body), docx, marked, counter));
    }
  } else {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "(no compiled disclosure available)", italics: true, size: BODY })],
      }),
    );
  }

  // Drawings — own page (descriptions; the figures render in-app + as PDFs).
  if (drawings.length) {
    children.push(sectionHeading("Drawings", docx, { pageBreakBefore: true }));
    children.push(...drawingParagraphs(drawings, docx, counter));
  }

  // Key Concepts — own page.
  children.push(sectionHeading("Key Concepts", docx, { pageBreakBefore: true }));
  children.push(...keyConceptParagraphs(keyConcepts, docx, counter));

  // Abstract — forced last, own page (nothing after it).
  if (abstractSection) {
    children.push(sectionHeading("Abstract", docx, { pageBreakBefore: true }));
    children.push(...markdownToParagraphs(processTextForDocx(abstractSection.body), docx, marked, counter));
  }

  const doc = new Document({
    // Document-wide defaults: nonscript 12pt font, everywhere.
    styles: { default: { document: { run: { font: FONT, size: BODY } } } },
    sections: [
      {
        properties: {
          // USPTO 37 CFR 1.52: Letter, portrait; margins ≥ 1" left, ≥ 0.75" others.
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1080, bottom: 1080, left: 1440 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "Page ", size: NOTE, color: "888888" }),
                  new TextRun({ children: [PageNumber.CURRENT], size: NOTE, color: "888888" }),
                  new TextRun({ text: " of ", size: NOTE, color: "888888" }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: NOTE, color: "888888" }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

/* ------------------------------------------------------------------ *
 * Proof of Human Conception — Word doc + provenance package
 *
 * Ported from V1's pohc-docx.ts, adapted to app 2's single unified ledger:
 *   - V1's two sources (AI-Helper log + typed inputs) map to the ledger's
 *     `origin` — human entries are the inventorship evidence, machine entries
 *     are the process/checkpoint trail;
 *   - V1's red banner is kept but reworded to avoid the word "patent" (app 2's
 *     never-say-patent rule);
 *   - faithful to V1's raw style: no text cleanup, no footer, single spacing;
 *   - the seal lives OUTSIDE the docx, as sibling files inside the download zip
 *     (V1's provenance-package pattern), so the docx itself carries no hash/token.
 * ------------------------------------------------------------------ */

/** Stable ascending-by-timestamp sort (no Date.now needed; ISO strings compare). */
function byTimestampAsc(a: LedgerEntry, b: LedgerEntry): number {
  return a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0;
}

/** V1's dotted header line: "Entry N · type · captured <ts> · tags: …". */
function entryHeaderRuns(
  label: string,
  entry: LedgerEntry,
  docx: typeof import("docx"),
): DocxTextRun[] {
  const { TextRun } = docx;
  const runs: DocxTextRun[] = [new TextRun({ text: label, bold: true, size: 22 })];
  const sep = (text: string) => {
    runs.push(new TextRun({ text: " · ", size: 20 }));
    runs.push(new TextRun({ text, size: 20 }));
  };
  sep(entry.type || "unknown");
  sep(`captured ${entry.timestamp}`);
  if (entry.tags?.length) sep(`tags: ${entry.tags.join(", ")}`);
  return runs;
}

/** One PoHC section (Heading 2 + a block per entry, or an italic empty state). */
function proofSection(
  title: string,
  entries: LedgerEntry[],
  emptyMessage: string,
  docx: typeof import("docx"),
): DocxParagraph[] {
  const { Paragraph, TextRun, HeadingLevel } = docx;
  const out: DocxParagraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 200 },
      children: [new TextRun({ text: `${title} (${entries.length})` })],
    }),
  ];
  if (!entries.length) {
    out.push(new Paragraph({ children: [new TextRun({ text: emptyMessage, italics: true, size: 22 })] }));
    return out;
  }
  entries.forEach((e, i) => {
    out.push(new Paragraph({ spacing: { before: 240, after: 60 }, children: entryHeaderRuns(`Entry ${i + 1}`, e, docx) }));
    // Raw verbatim (V1 does zero preprocessing); machine entries fall back to their meta payload.
    const body = e.verbatim_text ?? (e.meta ? JSON.stringify(e.meta) : "");
    if (body) out.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: body, size: 22 })] }));
  });
  return out;
}

/** Render the Proof of Human Conception as a Word document (.docx bytes). */
export async function assembleProofDocx(
  entries: LedgerEntry[],
  meta: { projectId: string; sealedAt: string },
): Promise<Buffer> {
  const docx = await import("docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;

  const human = entries.filter((e) => e.origin === "human").sort(byTimestampAsc);
  const machine = entries.filter((e) => e.origin !== "human").sort(byTimestampAsc);

  const children: DocxParagraph[] = [
    // Red warning banner — the very first thing in the document (reworded: no "patent").
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 240 },
      children: [new TextRun({ text: "DO NOT SUBMIT THIS FILE WITH ANY APPLICATION", bold: true, color: RED, size: 40 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 480 },
      children: [
        new TextRun({
          text: "This is your private Proof of Human Conception record — inventorship evidence for your own files only.",
          italics: true,
          color: RED,
          size: 22,
        }),
      ],
    }),
    // Title + metadata.
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 200, after: 200 },
      children: [new TextRun({ text: "Proof of Human Conception" })],
    }),
    new Paragraph({
      spacing: { after: 240 },
      children: [
        new TextRun({ text: "Project ID: ", bold: true, size: 22 }),
        new TextRun({ text: meta.projectId, size: 22 }),
        new TextRun({ text: "    Sealed: ", bold: true, size: 22 }),
        new TextRun({ text: meta.sealedAt, size: 22 }),
      ],
    }),
    ...proofSection("Inventor Inputs", human, "No inventor inputs captured.", docx),
    ...proofSection("Process & Checkpoints", machine, "No process events captured.", docx),
  ];

  const doc = new Document({ sections: [{ properties: {}, children }] });
  return Packer.toBuffer(doc);
}

/**
 * Bundle the whole Proof-of-Human-Conception package as a .zip (V1's provenance
 * pattern): the readable docx + the seal files that make it verifiable —
 *   - sha256.txt         — the content hash, over canonical-content.txt;
 *   - canonical-content.txt — the exact text that was hashed (so the hash is reproducible);
 *   - timestamp.tsr      — the raw RFC-3161 token (only when the TSA sealed it);
 *   - proof.json         — the full structured seal (hash, token, status, entries).
 */
export async function assembleProofPackage(input: {
  entries: LedgerEntry[];
  content: string;
  contentHash: string;
  rfc3161Token: string | null;
  sealedAt: string;
  tsaStatus: string;
  projectId: string;
}): Promise<Buffer> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  const docxBuf = await assembleProofDocx(input.entries, {
    projectId: input.projectId,
    sealedAt: input.sealedAt,
  });
  const safeId = input.projectId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "project";

  zip.file(`pohc-${safeId}.docx`, docxBuf);
  zip.file("sha256.txt", `${input.contentHash}  canonical-content.txt\n`);
  zip.file("canonical-content.txt", input.content);
  if (input.rfc3161Token) {
    zip.file("timestamp.tsr", Buffer.from(input.rfc3161Token, "base64"));
  }
  zip.file(
    "proof.json",
    JSON.stringify(
      {
        contentHash: input.contentHash,
        rfc3161Token: input.rfc3161Token,
        sealedAt: input.sealedAt,
        tsaStatus: input.tsaStatus,
        entries: input.entries,
      },
      null,
      2,
    ),
  );

  return zip.generateAsync({ type: "nodebuffer" });
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
