# Module 5: Genus & Species — the New Approach

## From "extract a genus, synthesize species" → "grow a forest, claim your trees"

Date: 2026-07-16
Audience: whoever works on Module 5 next. Explains what changed from the old genus-extractor + species-synthesizer chain to the current conversational **Forest** approach, how each step works, which files it touches, and — honestly — what is live vs. built-but-bypassed.

---

## 1. The shift, in one line

**Old:** the system *extracted one genus* and *synthesized a fixed set of species for you*, and you tap-approved them.

**New:** the system helps you **name the genus (your forest)** and then you **steer** it — "what am I missing? how would a competitor design around this? what's the future version?" — while the AI fills the forest with trees, and **you claim the ones worth owning in your own words.** The genus and the species are yours; the AI teaches and fills, you drive and claim.

Why the change: the old flow is the legally weak "click-to-approve" pattern (approving machine output is *not* human conception). The new flow captures the inventor **driving** (the steering taps) and **synthesizing** (a one-line "+1" per claim) — the record of human conception that survives a patent challenge.

---

## 2. The old approach (what it was)

Two agents did the work, and the inventor mostly watched:

- **Genus Extractor** — distilled **one** paradigm-neutral genus from the Key Concepts. Ran automatically, no inventor confirmation, no evidence anchors.
- **Species Synthesizer** → later replaced by **Enumerator + Grader + a keep-many Sweep** — generated the "ways to build it" (originally three fixed `ai_assisted / ai_native / agentic` species; later an emergent forest), and the inventor tapped **Keep** on the ones they liked.
- **Broadening** — rewrote each Key Concept (`key-concept-broadener`), appended three **template** Key Concepts (`conceptAspects`: genus_mechanism / species_spectrum / hardware_optimization), and extended Abstract/Summary/Background.

Problems it had: single un-anchored genus, `confirmedConstraints` was always an empty array, the species were AI-authored-and-tap-approved (weak conception), the hygiene step could **delete** your Key Concepts (narrowing), and nothing captured the inventor's own synthesis.

---

## 3. The new pipeline (overview)

```
A1 hygiene ─→ genus ─→ constraints ─→ THE FOREST ─→ formalize ─→ Key Concepts ─→ exit eval ─→ review ─→ apply
 (silent      (anchored,  (mined from    (steer + claim,    (Across-     (3-framing        (4          (Keep/Edit/  (snapshot +
  signal)      overbreadth  your words →   your +1 = your     Impl.)       independents +    perspectives Regenerate/  contract gate +
               -verified,   fills the      conception)                     dependent ladder  + 1 pass)    Remove)      Coverage Ledger
               editable)    empty array)                                    from your claims)                          + receipts)
```

Two rules underpin all of it:
- **Every AI output is a chain**, never single-pass: **Produce → Verify (fresh context, second model) → Repair once → mechanical fallback**, and every chain writes a **receipt**. (See `chain.ts`.)
- **This module only ever widens.** No step removes, merges, or narrows what you already have. Broadening only adds *above and around* your originals.

---

## 4. Step by step (what's new, how it works, files)

### A1 — Key Concept hygiene (now a silent signal)
- **What's new:** it used to offer to *delete* near-duplicate Key Concepts (a narrowing trap). It no longer surfaces any delete/merge choice at all — a broadening module must make narrowing impossible. It runs the deterministic checks only to **record where concepts overlap** (a signal the genus uses to find the broad position), then proceeds. **No concept is ever removed.**
- **How:** `runKCHygiene()` computes a low-bar overlap signal + text flags, records `kc_overlap_signal`, returns immediately.
- **Files:** `hygiene.ts` (deterministic lint), `controller.ts`. *(Built but now bypassed: `09-kc-hygiene-verify.md`, the `kc_hygiene` card + `KCHygieneView`.)*

### A2 — Anchored, editable genus
- **What's new:** the genus now carries **verbatim anchors (≥8 chars) from your own words**, is checked for **overbreadth** on the second model, is **narrowed to the anchored portion** if it over-reaches, and you **confirm or edit it** on a card. (Old: one un-anchored genus, auto, no confirmation.)
- **How:** `runGenusChain()` = Produce (`runGenusExtractor`) → Verify (deterministic anchor check + `runGenusVerify` overbreadth) → Repair/fallback (narrow) → surface the **genus card** (Keep / Edit). Edits are `inventor_conceived`.
- **Files:** `01-genus-extractor.md` (now emits `anchors[]`), `11-genus-verify.md`, `agents.ts`, `controller.ts`, `GenusReviewView` in `showcase-panel.tsx`.

### A3 — Constraint mining (fills the empty array)
- **What's new:** the invention's real requirements are **mined from your verbatim record** as anchored, type-classified quotes (constraint / invariant / operation-step / data-structure). You confirm them, and they populate `confirmedConstraints`, which finally flows into the enumerator, grader, and formalizer. (Old: `confirmedConstraints` was always `[]`.)
- **How:** `runConstraintMining()` = Produce (`runConstraintMiner`) → Verify (deterministic anchor check) → fallback (drop unanchored) → **constraint card** (Keep / Trim / Confirm). Missing required classes → gaps.
- **Files:** `10-constraint-miner.md`, `coverage.ts` (`ConstraintKind`), `agents.ts`, `controller.ts`, `ConstraintReviewView`.

### THE FOREST — the headline change
- **What's new:** this **replaces the tap-only sweep**. It's a driven conversation:
  - A banner shows the **genus = your forest** ("the category you own").
  - Your **starting trees** appear (three build-styles from the baseline builder + emergent ways from the enumerator/grader).
  - You **steer** with taps: **🔍 "What am I missing?" · 🛡️ "How would a competitor get around this?" · 🚀 "What's the future version?"** — and the AI fills the forest in that direction.
  - New trees appear **grouped by origin** (Your trees / Filling the gaps / Blocking design-arounds / Future variants), each with a one-line strategic reason.
  - On each tree: **Claim it** (→ one short line in your own words = a patent claim), **Just cover it** (disclosure breadth), or **Not mine**.
- **How:**
  - Starting trees: `generateCandidates()` (baseline builder + enumerator + grader), tagged `origin: "yours"`, surfaced via `buildForestCard()`.
  - Steering: `expandForest(direction)` calls `runForestExpander` and appends trees tagged `gap` / `design_around` / `future`.
  - Claiming: sets the tree to **claim grade** (`decision:"protected"`, `claimConfirmed`) and stores your **`humanDetail`** (the +1), recorded verbatim as `inventor_conceived` — the **Cognitive Delta / human-conception anchor**.
  - Finalize → `formalizeKept(kept + claimed)`.
- **Files:** `16-forest-expander.md`, `agents.ts` (`runForestExpander`), `controller.ts` (`buildForestCard` / `expandForest` / `handleForest`), `ForestView` + `ForestTreeRow` in `showcase-panel.tsx`, types `ForestCard` / `ForestTree` / `ForestInput` / `TreeOrigin` in `types.ts`.

### Formalize
- Each kept/claimed tree → a passage in the **"Across Implementations"** section (restate-only, gap-aware).
- **Files:** `06-formalizer.md`, `controller.ts` (`formalizeKept`).

### Key Concept generation (D-phase)
- **What's new:** the old "broaden each KC + three template categories" is **gone**. Instead:
  - **D1 — Independent Key Concept**, per genus, in **three framings** (a method of steps / a system of parts / instructions on a medium), element-structured with antecedent basis. (`13-kc-independent.md`)
  - **D2 — Dependent Key Concepts**, one per **claimed** tree, ordered as a **retreat ladder** (broadest → narrowest). **Your +1 is the distinguishing limitation of that claim.** (`14-kc-dependent.md`)
  - **Your original Key Concepts are retained unchanged** as the deepest fallback positions.
  - The `conceptAspects` template array is **deleted** from the live path.
- **Files:** `13-kc-independent.md`, `14-kc-dependent.md`, `agents.ts`, `controller.ts` (`generateArtifacts`).

### Exit evaluation
- **What's new:** before the final review, four perspectives — **mathematician / engineer / philosopher / artist** — score the rendered set 1–10 with quote-cited findings. Any below 7 triggers **one** refinement pass, then a rescore. **Non-blocking** (it refines; the deterministic checks are what gate).
- **Files:** `15-exit-evaluator.md`, `agents.ts`, `controller.ts` (`runExitEvaluation`).

### Review + apply
- One review surface (Keep / Edit / Regenerate / Remove per artifact) → **apply once**, with a **snapshot** (undo point), a **rendering-contract gate** (enumerations preserved, cross-references resolve — blocks + reverts on failure), the **Coverage Ledger** export (per axis: every tree's status + grade + anchors — the evidence spine for the Proof of Human Conception), and a **receipt**.
- **Files:** `contract.ts`, `controller.ts` (`finalizeExpansion`, `recordCoverageLedger`), `ExpansionReviewView`.

---

## 5. Proof of Human Conception (why the shape matters)

The whole re-aim serves the legal goal from the product's core philosophy: prove **the human** conceived the invention, not the AI.

- **You drive** (steering taps) — the log shows *you* chose to ask "what am I missing?" and "how would competitors design around this?" That's active direction, not passive approval.
- **You synthesize** (the +1 per claim) — captured **verbatim**, tagged `inventor_conceived`. This is the "Cognitive Delta": the gap between what the AI surfaced and what you added.
- **Everything is anchored** — the genus to ≥8-char quotes of your words; each claim to your +1. No claim rests on machine-authored text.
- **Receipts + Coverage Ledger** — every chain and every decision leaves an immutable record.

This is the opposite of the "click-to-approve conception attack": a log of taps is weak; a record of you steering and synthesizing is the shield.

---

## 6. Data model & provenance (quick reference)

- **Genus** (`types.ts`): `genus_name`, `genus_description`, input/transformation/output patterns, `computational_constraints[]`, `logical_invariants[]`, `anchors[]`.
- **Tree / StoredCandidate**: `label`, `source`, `mapping`, `tradeoff`, `origin` (yours/gap/design_around/future), `note`, `decision` (kept/protected/excluded), `humanDetail` (the +1), `grade`.
- **Provenance events**: `agent_genus`, `agent_breadth`, `agent_baseline`, `agent_enumerated`, `agent_graded`, `agent_forest_expanded`, `constraint_confirmed`, `tree_kept` (`inventor_confirmed`), `tree_claimed` (`inventor_conceived`), `agent_kc_independent/dependent`, `exit_evaluation`, `coverage_ledger`, `quality_receipt`.

---

## 7. File map

**Prompts** (`prompts/module-5-showcase/genus-species/`):
| File | Role | Status |
|---|---|---|
| `01-genus-extractor.md` | genus + anchors (A2) | **live** |
| `11-genus-verify.md` | overbreadth verify (2nd model) | **live** |
| `10-constraint-miner.md` | constraint mining (A3) | **live** |
| `08-baseline-builder.md` | the 3 starting build-styles | **live** |
| `03-enumerator.md` | emergent starting trees | **live** |
| `04-grader.md` | dedup the emergent (2nd model) | **live** |
| `16-forest-expander.md` | fills the forest (gaps/design-arounds/future) | **live** |
| `06-formalizer.md` | kept/claimed trees → prose | **live** |
| `13-kc-independent.md` | D1 three-framing independents | **live** |
| `14-kc-dependent.md` | D2 dependent ladder from claims | **live** |
| `15-exit-evaluator.md` | four-perspective exit eval | **live** |
| `07-breadth-assessor.md` | sizes the starting emergent count | live (minor now) |
| `09-kc-hygiene-verify.md` | semantic dup verify | **built, bypassed** |
| `12-delta-miner.md` | per-region delta mining | **built, bypassed** (forest uses the +1 instead) |
| `05-criterion-fragmenter.md` | old criterion step | **dead** |

**Broadening prompts** (`prompts/module-5-showcase/`): `05-background-extender.md`, `06-summary-extender.md`, `08-abstract-rewriter.md` are **live** (Background/Summary/Abstract still extend). `03-key-concept-broadener.md`, `09-key-concept-appender.md`, `07-detail-description-extender.md`, `04-verifier.md` are **bypassed/dead** in the live path.

**Engine** (`lib/modules/showcase/`):
- `chain.ts` — the chain primitive + `Finding` / `VerifyResult` / `Receipt`.
- `coverage.ts` — Region/Axis/`SourceClass`/`ConstraintKind` schema (constraint kinds used; the full axis walk is deferred).
- `hygiene.ts` — deterministic KC lint.
- `contract.ts` — rendering-contract checks.
- `controller.ts` — the orchestrator (all the `run*` / `handle*` / `build*` methods).
- `agents.ts` — run functions + Zod schemas + agent registration.
- `runner.openai.ts` — agent → model map (verify agents on `MODELS.verifier`).
- `config.ts` — tunables. `types.ts` — all card/input/data types.

**UI** (`components/showcase/showcase-panel.tsx`): `ForestView` + `ForestTreeRow` (headline), `GenusReviewView`, `ConstraintReviewView`, `ExpansionReviewView`. *(Bypassed but present: `SweepView`, `KCHygieneView`, `DeltaReviewView`.)*

---

## 8. Honest status

- **Built and typechecking end-to-end. Not yet verified by running.** The forest step and the full downstream have executed zero times; quality of the AI output (forest trees, design-arounds, the final claim ladder, the draft) is unknown until driven.
- **Bypassed-but-present code:** the old keep-many **sweep**, the **delta-mining** path, and the **KC-hygiene delete card** are wired out of the live flow but not yet deleted. Cleanup pending once the forest is confirmed as the keeper.
- **Deferred (documented):** the full Phase-B **axis walk** (systematic per-axis species generation — the biggest lever for even richer forests), genus **plurality** (multiple genera in parallel), the D3 verify battery, per-section render-chain wrappers, and the regression harness.

The next real work is **driving it and tuning from what shows up** — that's where the quality is made, not in the typechecker.
