# Fix: diagram labels/numerals missing in the .docx export

Paste everything below into the coding agent (Claude Code in VSCode). It is a complete,
self-contained brief — issue, root cause, exact fix, and how to verify.

---

## The issue

When a Showcase disclosure is exported to Word (`.docx`), every figure comes out as
**boxes and arrows with NO text** — all box labels and reference numerals are gone.
The same figures are correct in the app UI and correct in the per-figure **PDF**
download. Only the diagram images embedded in the `.docx` lose their text.

## Root cause (confirmed)

The `.docx` export rasterizes each figure's **SVG → PNG** with `@resvg/resvg-js`, in
`rasterizeDrawings()` inside `lib/modules/showcase/export.ts`. It is configured with:

```ts
const resvg = new Resvg(cleanFigureSvg(d.svgData), {
  fitTo: { mode: "width", value: 1600 },
  background: "white",
  font: { loadSystemFonts: true },   // <-- the bug
});
```

`resvg` needs an actual font file to shape `<text>` glyphs. `loadSystemFonts: true`
relies on fonts installed on the host. This app is deployed on **Vercel serverless**,
which has essentially **no system fonts**, so resvg finds no font, cannot render any
`<text>`, and drops it entirely. Vector shapes (`<rect>`, `<path>`, `<line>`) still
render — which is exactly the symptom: shapes present, all text missing.

Two corroborating facts:
- The **PDF** path is unaffected because the external Matplotlib diagram service
  renders the PDF server-side with fonts embedded; the app never rasterizes it.
- It would render **correctly on a local dev machine** (which has system fonts), so
  this only shows up in the deployed build — a classic serverless font issue.

The diagram service is Matplotlib-based, whose default font family is **"DejaVu Sans"**,
so that is almost certainly the `font-family` the SVG `<text>` elements request.

## The fix

Bundle a font with the app and load it into resvg explicitly, instead of depending on
system fonts. Use **DejaVu Sans** so the family name matches what the SVG requests.

### Step 1 — add the font file

Add `assets/fonts/DejaVuSans.ttf` to the repo. DejaVu Sans is permissively licensed
(free to bundle and redistribute) and ships with Matplotlib
(`.../matplotlib/mpl-data/fonts/ttf/DejaVuSans.ttf`) and the `dejavu-fonts-ttf` package.
Commit the actual `.ttf` file (do not rely on it being fetched at runtime).

### Step 2 — load the font explicitly in `lib/modules/showcase/export.ts`

At the top of the file, add Node fs/path imports and a cached font loader:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The diagram font, bundled so it exists on serverless (no system fonts there).
 *  Loaded once; null if missing so export still proceeds (text-only) rather than crash. */
let DIAGRAM_FONT: Buffer | null | undefined;
function diagramFont(): Buffer | null {
  if (DIAGRAM_FONT !== undefined) return DIAGRAM_FONT;
  try {
    DIAGRAM_FONT = readFileSync(join(process.cwd(), "assets/fonts/DejaVuSans.ttf"));
  } catch (err) {
    console.error("[showcase] diagram font not found — figures will export without text", err);
    DIAGRAM_FONT = null;
  }
  return DIAGRAM_FONT;
}
```

Then in `rasterizeDrawings()`, replace the `new Resvg(...)` options so it uses the
bundled font buffer and points every generic family at it (so ANY `font-family` the
SVG requests resolves to the one bundled font):

```ts
const font = diagramFont();
const resvg = new Resvg(cleanFigureSvg(d.svgData), {
  fitTo: { mode: "width", value: 1600 },
  background: "white",
  font: font
    ? {
        loadSystemFonts: false,        // deterministic across local + serverless
        fontBuffers: [font],
        defaultFontFamily: "DejaVu Sans",
        serifFamily: "DejaVu Sans",
        sansSerifFamily: "DejaVu Sans",
      }
    : { loadSystemFonts: true },        // dev fallback if the file is somehow absent
});
```

(A Node `Buffer` is a `Uint8Array`, so it satisfies `fontBuffers`.)

### Step 3 — make sure the font ships in the serverless bundle (Next 14)

`@resvg/resvg-js` is in `serverComponentsExternalPackages`, and we read the font via
`fs` at runtime, so Next's output file tracing must be told to include the font.
In `next.config.mjs`, add `outputFileTracingIncludes` under `experimental`:

```js
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: [
      "@neondatabase/serverless",
      "@resvg/resvg-js",
      "mammoth",
    ],
    outputFileTracingIncludes: {
      "/api/showcase/export": ["./assets/fonts/**"],
    },
  },
};
```

(If any other route also rasterizes figures, add its path here too. In Next 14 this
option lives under `experimental`; it is only top-level in Next 15.)

## Do NOT change

- The external diagram service or its `/generate` / `/draw` endpoints.
- The PDF path (it already works).
- `cleanFigureSvg`, the page/orientation math, or the docx assembly — only the font
  loading is wrong.

## How to verify (required before declaring done)

1. Add a tiny throwaway script or test that reads a real `svgData` string returned by
   the diagram service (or a saved sample), runs it through the **new**
   `rasterizeDrawings` config, writes the PNG to disk, and open it — confirm the box
   labels and reference numerals are now visible.
2. Run a full Showcase export end to end and open the `.docx`; every figure must show
   its text.
3. Build for production (`npm run build`) and confirm `assets/fonts/DejaVuSans.ttf`
   is traced into the serverless function output (check `.next/`), so it will exist on
   Vercel — not just locally.
4. Confirm the `font not found` warning does NOT log during a normal export.

## Commit note

Root cause was serverless font loading, not the diagram generator. Fix bundles DejaVu
Sans and loads it explicitly into resvg; no change to the diagram service or the PDF.
