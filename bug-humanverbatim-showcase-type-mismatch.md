# Bug: `humanVerbatim()` is blind to upstream inventor material in Showcase

Logged 2026-07-15. Separate from the genus/species redesign — **do not fix inside that feature.**
Severity: medium (silent under-coverage, no crash).

## Summary

In the Showcase module, `EvidenceLedger.humanVerbatim()` silently omits the inventor's upstream
verbatim material (from Conception / Maturation / Differentiation). It returns only Showcase-stage
inventor entries. Anything in Showcase that relies on `humanVerbatim()` therefore sees a truncated
view of the inventor's own words.

## Root cause

`EvidenceLedger.humanVerbatim()` filters entries by the `humanSourceTypes` set the ledger was
constructed with (`lib/modules/shared/ledger.ts` — `humanVerbatim()` keeps entries whose `type` is in
that set and that carry `verbatim_text`).

Showcase constructs its ledger with
`SHOWCASE_HUMAN_SOURCE_TYPES = { inventor_note, inventor_edit }`
(`lib/modules/showcase/types.ts:256`).

The Showcase ledger is seeded with the **Differentiation** module's entries
(`seedShowcase(..., differentiation.ledgerEntries(), ...)` in `app/api/showcase/route.ts`). Those
upstream entries carry other `type` values (e.g. `novelty_statement`) that are **not** in the Showcase
human-source set. So `humanVerbatim()` on the Showcase ledger matches only `inventor_note` /
`inventor_edit` and drops all the seeded upstream verbatim.

## Impact

- `ShowcaseModule.inventorMaterial()` (which calls `humanVerbatim()`) under-returns the inventor's
  upstream words — e.g. as context to the Showcase Helper and any agent fed `inventorMaterial`.
- Not a crash; it's silent under-coverage, which is easy to miss.

## Reproduction (sketch)

1. Complete Conception → Differentiation so the inventor has upstream verbatim (novelty statements, etc.).
2. Enter Showcase.
3. Inspect `ShowcaseModule.inventorMaterial()` / the ledger's `humanVerbatim()` — the upstream
   verbatim (novelty statements) is absent; only Showcase-stage notes/edits appear.

## Suggested fix direction (later)

Two candidate approaches — pick one when this is scheduled:

- **Thread the union of upstream human-source types** into the Showcase ledger construction, so
  `humanVerbatim()` recognizes upstream inventor entries too. (Simple, but couples Showcase to every
  upstream module's type vocabulary.)
- **Store a canonical human-source flag on each entry** at append time (e.g. derive from `origin`
  + a persisted boolean) instead of re-deriving "is this inventor-sourced?" by `type` per module.
  (Cleaner long-term; the entry carries its own provenance rather than depending on the reader's
  type set.)

## Workaround already in place

The Layer 4 criterion fragment-extractor does **not** use `humanVerbatim()`. It sources the inventor's
upstream material from `keyConcepts[].verbatim` (populated from `conception_trail` at
`app/api/showcase/route.ts:90`), which carries the upstream verbatim reliably.
