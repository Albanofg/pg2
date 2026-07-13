import "server-only";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Paragraph as DocxParagraph, TextRun as DocxTextRun } from "docx";
import type { LedgerEntry } from "@/lib/modules/shared";
import type { DisclosureSection, ShowcaseDrawing, ShowcaseKeyConcept } from "./types";

/**
 * Export assembly for Module 5 — turns the finished module state into the two
 * deliverables: the Invention Disclosure document and the proof-package content
 * that gets RFC-3161 sealed. Pure string assembly; the route does the sealing.
 */

/** Filing metadata surfaced on the ICB cover. Each field optional — shown only when set. */
export type IcbMeta = {
  inventorNames?: string | null;
  applicationNumber?: string | null;
  filedDate?: string | null;
  status?: string | null;
};

/** Build the ICB cover lines from the filing metadata: an "Inventor(s)" line and a
 *  "·"-joined filing line (Application No. / Filed / Status). Either may be null when
 *  the inventor hasn't filled those fields in on the project's details. */
function coverMetaLines(meta?: IcbMeta): { inventors: string | null; filing: string | null } {
  const inv = (meta?.inventorNames ?? "").split(",").map((n) => n.trim()).filter(Boolean);
  const inventors = inv.length ? `Inventor${inv.length > 1 ? "s" : ""}: ${inv.join(", ")}` : null;
  const parts: string[] = [];
  if (meta?.applicationNumber?.trim()) parts.push(`Application No.: ${meta.applicationNumber.trim()}`);
  if (meta?.filedDate?.trim()) parts.push(`Filed: ${meta.filedDate.trim()}`);
  if (meta?.status?.trim()) parts.push(`Status: ${meta.status.trim()}`);
  return { inventors, filing: parts.length ? parts.join("  ·  ") : null };
}

/** Assemble the Invention Disclosure as Markdown (sections + Key Concepts + Drawings). */
export function assembleDisclosureMarkdown(
  disclosure: DisclosureSection[],
  keyConcepts: ShowcaseKeyConcept[],
  drawings: ShowcaseDrawing[] = [],
  meta?: IcbMeta,
): string {
  // Same 37 CFR 1.77(b) order as the .docx: Title → front matter → Brief Description
  // of the Drawings → Detailed Description (drawings walkthrough + technical) → Key
  // Concepts → Abstract.
  const titleSection = disclosure.find((s) => s.key === "title");
  const abstractSection = disclosure.find((s) => s.key === "abstract");
  const body = disclosure.filter((s) => s.key !== "title" && s.key !== "abstract");
  const detailIdx = body.findIndex((s) => s.key === "architecture");
  const front = detailIdx >= 0 ? body.slice(0, detailIdx) : body;
  const detail = detailIdx >= 0 ? body.slice(detailIdx) : [];

  const lines: string[] = [`# ${titleSection?.body?.trim() || "Invention Disclosure"}`, ""];

  // Cover metadata (inventor / application no. / filed / status) — only when set.
  const cover = coverMetaLines(meta);
  if (cover.inventors) lines.push(`**${cover.inventors}**`, "");
  if (cover.filing) lines.push(`_${cover.filing}_`, "");

  for (const s of front) lines.push(`## ${s.label}`, "", s.body.trim(), "");

  if (drawings.length) {
    lines.push("## Brief Description of the Drawings", "");
    for (const d of drawings) {
      lines.push(`- ${d.briefDescription || `FIG. ${d.figNumber} — ${d.title}`}`);
    }
    lines.push("");
    lines.push("## Detailed Description of the Drawings", "");
    for (const d of drawings) {
      if (d.detailedDescription) lines.push(d.detailedDescription.trim(), "");
    }
  }

  for (const s of detail) lines.push(`## ${s.label}`, "", s.body.trim(), "");

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

  if (abstractSection) {
    lines.push("## Abstract", "", abstractSection.body.trim(), "");
  }

  if (!body.length && !drawings.length) {
    lines.push("_(no compiled disclosure available)_", "");
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
    // MPEP 608.01(a): section headings uppercase, WITHOUT bold or underline.
    // (Override the docx HEADING_1 default of 16pt Word-blue → plain black.)
    children: [new TextRun({ text: label.toUpperCase(), bold: false, color: BLACK, size: SECTION, font: FONT })],
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

/** "Brief Description of the Drawings" body — one numbered line per figure. Placed
 *  BEFORE the Detailed Description per 37 CFR 1.77(b)(9). */
function briefDrawingParagraphs(
  drawings: ShowcaseDrawing[],
  docx: typeof import("docx"),
  counter: { n: number },
): DocxParagraph[] {
  const { Paragraph, TextRun } = docx;
  return drawings.map((d) => {
    const brief = (d.briefDescription || `FIG. ${d.figNumber} is a diagram of ${d.title}.`).trim();
    return new Paragraph({
      spacing: { line: LINE, after: 60 },
      children: [
        new TextRun({ text: `${formatParaNumber(counter.n++)} `, size: BODY }),
        new TextRun({ text: brief, size: BODY }),
      ],
    });
  });
}

/** "Detailed Description of the Drawings" body — the grounded per-figure walkthrough.
 *  Part of the Detailed Description (37 CFR 1.77(b)(10)). */
function detailedDrawingParagraphs(
  drawings: ShowcaseDrawing[],
  docx: typeof import("docx"),
  counter: { n: number },
): DocxParagraph[] {
  const { Paragraph, TextRun } = docx;
  const out: DocxParagraph[] = [];
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
 * Rasterize each figure's SVG to a PNG (buffer + pixel size) so it can be embedded
 * in the .docx. `@resvg/resvg-js` is imported lazily and renders the black line art
 * on white; if it's unavailable, the map is empty and drawings still export as
 * text (their descriptions). Per-figure failures are skipped, never fatal.
 */
/**
 * Strip the standalone-sheet chrome the document doesn't want: the "N / M" page
 * counter the service bakes in (the .docx paginates itself). The figure's own
 * "FIG. N" title is kept. Text is real `<text>`, so this targeted strip is safe.
 */
function cleanFigureSvg(svg: string): string {
  return svg.replace(/<text\b[^>]*>\s*\d+\s*\/\s*\d+\s*<\/text>/g, "");
}

/**
 * The diagram font, bundled with the app so it exists on serverless — Vercel's
 * runtime has essentially no system fonts, and without a real font file resvg
 * shapes no `<text>` glyphs and silently drops every box label and reference
 * numeral (vector shapes still render). The service is Matplotlib-based, whose
 * default family is "DejaVu Sans", so that is the family the SVG `<text>`
 * requests; we bundle exactly that face.
 *
 * NOTE: `@resvg/resvg-js@2.6.2` loads fonts by PATH (`fontFiles`), not by buffer.
 * (There is no `fontBuffers` option in this version; passing one silently
 * corrupts the whole options object — `fitTo`/`background` get dropped — so we
 * must hand resvg an on-disk path.) `next.config.mjs` traces this file into the
 * serverless function via `outputFileTracingIncludes`.
 *
 * Resolved + cached once. `null` if the file is somehow absent, so the export
 * still proceeds (system-font fallback, dev only) rather than crashing.
 */
const DIAGRAM_FONT_REL = "assets/fonts/DejaVuSans.ttf";
let diagramFontPathCache: string | null | undefined;
function diagramFontPath(): string | null {
  if (diagramFontPathCache !== undefined) return diagramFontPathCache;
  const p = join(process.cwd(), DIAGRAM_FONT_REL);
  if (existsSync(p)) {
    diagramFontPathCache = p;
  } else {
    console.error(
      `[showcase] diagram font not found at ${p} — figures will export without text; ` +
        `ensure ${DIAGRAM_FONT_REL} is committed and traced into the serverless bundle`,
    );
    diagramFontPathCache = null;
  }
  return diagramFontPathCache;
}

async function rasterizeDrawings(
  drawings: ShowcaseDrawing[],
): Promise<Map<number, { png: Buffer; width: number; height: number }>> {
  const map = new Map<number, { png: Buffer; width: number; height: number }>();
  if (!drawings.length) return map;
  let Resvg: typeof import("@resvg/resvg-js").Resvg;
  try {
    ({ Resvg } = await import("@resvg/resvg-js"));
  } catch {
    return map; // rasterizer unavailable — export proceeds text-only
  }
  // Resolve the bundled font once. When present we point EVERY generic family at
  // it and disable system fonts, so rendering is deterministic across local and
  // serverless and any `font-family` the SVG requests resolves to the one face.
  const fontPath = diagramFontPath();
  const fontOptions = fontPath
    ? {
        loadSystemFonts: false,
        fontFiles: [fontPath],
        defaultFontFamily: "DejaVu Sans",
        serifFamily: "DejaVu Sans",
        sansSerifFamily: "DejaVu Sans",
      }
    : { loadSystemFonts: true }; // dev fallback if the bundled file is absent
  for (const d of drawings) {
    if (!d.svgData) continue;
    try {
      const resvg = new Resvg(cleanFigureSvg(d.svgData), {
        fitTo: { mode: "width", value: 1600 },
        background: "white",
        font: fontOptions,
      });
      const r = resvg.render();
      map.set(d.figNumber, { png: Buffer.from(r.asPng()), width: r.width, height: r.height });
    } catch {
      // skip this figure's image — its description still appears in the text section
    }
  }
  return map;
}

/**
 * Assemble the Invention Disclosure as a real Word document and return the
 * serialized .docx bytes (Node Buffer). Sections render in app 2's canonical
 * order; a Drawings section (descriptions) sits before Key Concepts; the Abstract
 * is on its own page; then each figure is embedded on its OWN page as a drawing
 * sheet (landscape when the figure is wide) so the diagrams read large and clear.
 */
export async function assembleDisclosureDocx(
  disclosure: DisclosureSection[],
  keyConcepts: ShowcaseKeyConcept[],
  drawings: ShowcaseDrawing[] = [],
  meta?: IcbMeta,
): Promise<Buffer> {
  const docx = await import("docx");
  const { marked } = await import("marked");
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    Footer,
    PageNumber,
    ImageRun,
    PageOrientation,
  } = docx;
  const counter = { n: 1 };

  const titleSection = disclosure.find((s) => s.key === "title");
  const abstractSection = disclosure.find((s) => s.key === "abstract");
  // The Detailed Description begins here (its technical sections).
  const DETAIL_START = "architecture";
  // Body (everything but Title/Abstract) split into front matter (Background,
  // Summary…) and the Detailed Description's technical sections.
  const bodySections = disclosure.filter((s) => s.key !== "title" && s.key !== "abstract");
  const detailIdx = bodySections.findIndex((s) => s.key === DETAIL_START);
  const frontSections = detailIdx >= 0 ? bodySections.slice(0, detailIdx) : bodySections;
  const detailSections = detailIdx >= 0 ? bodySections.slice(detailIdx) : [];

  // ---- HEAD: everything before the figures — Title → front matter → Brief
  // Description of the Drawings.
  const head: DocxParagraph[] = [
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

  // Cover metadata under the title (inventor / application no. / filed / status) —
  // each rendered only when the inventor filled it in on the project's details.
  const cover = coverMetaLines(meta);
  if (cover.inventors) {
    head.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: cover.filing ? 40 : 200 },
        children: [new TextRun({ text: cover.inventors, size: BODY, color: BLACK, font: FONT })],
      }),
    );
  }
  if (cover.filing) {
    head.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: cover.filing, size: NOTE, color: MUTED, font: FONT })],
      }),
    );
  }

  if (!bodySections.length && !drawings.length) {
    head.push(
      new Paragraph({
        children: [new TextRun({ text: "(no compiled disclosure available)", italics: true, size: BODY })],
      }),
    );
  }

  // Front matter — Background, (Brief) Summary (37 CFR 1.77(b)(7)-(8)).
  for (const s of frontSections) {
    head.push(sectionHeading(s.label, docx));
    head.push(...markdownToParagraphs(processTextForDocx(s.body), docx, marked, counter));
  }

  // Brief Description of the Drawings — right before the figures (37 CFR 1.77(b)(9)).
  if (drawings.length) {
    head.push(sectionHeading("Brief Description of the Drawings", docx));
    head.push(...briefDrawingParagraphs(drawings, docx, counter));
  }

  // ---- FIGURE SHEETS: each figure on its OWN page, placed right AFTER the Brief
  // Description of the Drawings — landscape when the figure is wide. Text-only if
  // rasterizing failed.
  const raster = await rasterizeDrawings(drawings);
  const FIG_MARGIN = 720; // 0.5" (twips). Content px @96 DPI = (page − 2·margin)/1440·96.
  const figureSections = drawings
    .filter((d) => raster.has(d.figNumber))
    .map((d) => {
      const img = raster.get(d.figNumber)!;
      const landscape = img.width / Math.max(1, img.height) >= 1.15;
      // The ACTUAL page size after rendering. `docx` swaps width/height when
      // orientation is LANDSCAPE, so we always pass PORTRAIT base dims and let the
      // orientation flag do the swap — otherwise the page stays portrait and the
      // image overflows the right margin.
      const trueW = landscape ? 15840 : 12240;
      const trueH = landscape ? 12240 : 15840;
      const contentWpx = Math.round(((trueW - 2 * FIG_MARGIN) / 1440) * 96);
      const contentHpx = Math.round(((trueH - 2 * FIG_MARGIN) / 1440) * 96);
      // Fit inside the content box with headroom (never edge-to-edge → no clipping);
      // reserve a little vertical room for the caption line.
      const scale = Math.min((contentWpx * 0.96) / img.width, (contentHpx * 0.9) / img.height, 1);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      return {
        properties: {
          page: {
            size: {
              width: 12240,
              height: 15840,
              orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: { top: FIG_MARGIN, right: FIG_MARGIN, bottom: FIG_MARGIN, left: FIG_MARGIN },
          },
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({ type: "png", data: img.png, transformation: { width: w, height: h } })],
          }),
          // The figure carries its own "FIG. N" title; add just the descriptive
          // caption below (skip when there's no title).
          ...(d.title
            ? [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 120 },
                  children: [new TextRun({ text: d.title, italics: true, size: NOTE, color: MUTED, font: FONT })],
                }),
              ]
            : []),
        ],
      };
    });

  // ---- TAIL: everything after the figures — Detailed Description → Key Concepts →
  // Abstract (the very last thing, on its own page).
  const tail: DocxParagraph[] = [];
  // With drawings, the tail is its own docx section (which already begins a new
  // page), so the Detailed Description's first block must not add an extra break.
  const detailNeedsBreak = !drawings.length;
  let detailStarted = false;
  const pushDetail = (label: string, body: DocxParagraph[]) => {
    tail.push(sectionHeading(label, docx, { pageBreakBefore: detailNeedsBreak && !detailStarted }));
    tail.push(...body);
    detailStarted = true;
  };
  if (drawings.length) {
    pushDetail("Detailed Description of the Drawings", detailedDrawingParagraphs(drawings, docx, counter));
  }
  for (const s of detailSections) {
    pushDetail(s.label, markdownToParagraphs(processTextForDocx(s.body), docx, marked, counter));
  }

  // Key Concepts — own page (the "claims" slot; claims commence on a separate sheet).
  tail.push(sectionHeading("Key Concepts", docx, { pageBreakBefore: true }));
  tail.push(...keyConceptParagraphs(keyConcepts, docx, counter));

  // Abstract — the VERY LAST thing in the document, on its own page (37 CFR 1.72(b)).
  if (abstractSection) {
    tail.push(sectionHeading("Abstract", docx, { pageBreakBefore: true }));
    tail.push(...markdownToParagraphs(processTextForDocx(abstractSection.body), docx, marked, counter));
  }

  // ---- Assemble. With drawings: [text head] → [figure sheets] → [text tail]; the
  // figures land right after the Brief Description of the Drawings, the Abstract last.
  const portraitPage = {
    // USPTO 37 CFR 1.52: Letter, portrait; margins ≥ 1" left, ≥ 0.75" others.
    size: { width: 12240, height: 15840 },
    margin: { top: 1440, right: 1080, bottom: 1080, left: 1440 },
  };
  const pageFooter = () => ({
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
  });

  const sections = drawings.length
    ? [
        { properties: { page: portraitPage }, footers: pageFooter(), children: head },
        ...figureSections,
        { properties: { page: portraitPage }, footers: pageFooter(), children: tail },
      ]
    : [{ properties: { page: portraitPage }, footers: pageFooter(), children: [...head, ...tail] }];

  const doc = new Document({
    // Document-wide defaults: nonscript 12pt font, everywhere.
    styles: { default: { document: { run: { font: FONT, size: BODY } } } },
    sections,
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
