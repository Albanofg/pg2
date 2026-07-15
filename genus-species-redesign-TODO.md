# Genus & Species Redesign — Working TODO / Resume Notes

Session handoff so we can pick up cleanly. Companion to `genus-species-redesign-spec.md`
and `genus-species-redesign-live-code-corrections.md`.

Last worked: 2026-07-14. Status: **Phase 1 in progress.**

> **Before testing anything: restart the app** (rebuild if running `next start`).
> None of this session's changes are live until the server recompiles.

---

## Where we are

Phase 1 = Layer 2 remediation + Layer 4 (enumerator/grader) + Layer 5 (surface + formalizer),
on top of the gap-object infrastructure. Layer 2 and the gap object are **built**. Layer 4
prompts are **drafted, awaiting review**. Layer 4 wiring and Layer 5 are **not started**.

---

## ✅ Done this session (typecheck-clean; NOT live until server restart)

Redesign work:
1. **Gap object infrastructure** — `Gap`/`GapClass`/`GapOrigin`/`GapLocus`/`GapStatus`/`DeclaredGap`
   types in `lib/modules/showcase/types.ts`; `gaps` on `Module5View`; `gap_opened` ledger type.
   Controller: `gaps` state, `recordGaps()` + `gapLocus()`, `gap_opened` machine events,
   snapshot round-trip, view exposure, re-expand clears genus/enumerator gaps only.
   (Design: open-only lifecycle, 4 gap classes, 3 loci, lives in `module_state` blob — no DB table.)
2. **Layer 2 Genus Extractor remediation** — `prompts/module-5-showcase/genus-species/01-genus-extractor.md`
   rewritten to `genus_extractor_v2.1`: legal scaffolding stripped, back to distiller,
   constraints/invariants **formalized-from-inputs-only**, opens `missing_constraint`/`missing_invariant`
   gaps instead of authoring. `GenusOutput` schema + `Genus` type + `renderGenus` trimmed:
   **dropped** `formal_mapping_statement`, `technical_problem`, `technical_effect`; **added** `gaps`.
   Controller destructures `gaps` off the extractor result and records them.
3. **`inventor_confirmed` provenance tag** — added to the `Provenance` union in
   `lib/modules/shared/concept.ts`. No live consumer yet (Layer 1/5 will use it).

Earlier-session work (also shipped, also needs restart):
4. **Helper sees the draft** — `showcase` `helperContext()` now includes the full ICB draft + KC text.
5. **Helper sees the on-screen cards in every module** — `renderScreenCards()` in
   `lib/modules/shared/helper-agent.ts`, wired into conception/maturation/differentiation/showcase;
   landscape passes full per-source prior-art detail. Plus a shared guardrail: ground answers in
   context, surface a gap instead of confabulating.
6. **Section polish/redline feature** — Draft/Revise buttons on the narrative sections
   (Background, Summary, Abstract). New `section-polisher` agent + prompt
   (`prompts/module-5-showcase/11-section-polisher.md`), `polishSection` controller method,
   `polish_section` route op, `polishSection` hook, editor UI. Preserves every point; proposal-only
   (nothing saved until the inventor hits Save).

---

## 🔒 Locked decisions (do NOT re-litigate)

- **Gap object**: approved & built as designed.
- **Fan-out**: build the **parallel** version in Phase 1 as part of Layer 4 (`Promise.all` per species).
- **inventor_confirmed**: shipped as an app-code edit (the `Provenance` union). It is a **TS union +
  ledger tag**, NOT a DB enum — the spec's "DB enum + immutability triggers" premise was wrong
  (see corrections doc §1.2). DB-level immutability is **parked** (architecture call, not this feature).
- **Layer 1 (constraint discovery), Layer 3 (derivatives map), the deep-research call**: **parked to
  Phase 2.** Phase 1 Layer 4 runs from **established patterns only**.
- **Criterion question (Layer 4) → OPTION B**: build a **fragment-extraction pass**. Hard rules for
  that prompt:
  - **Verbatim phrases only, lifted not paraphrased.** If a phrase needs rewording to work as a
    criterion, it does NOT qualify as a fragment (omit it).
  - Each fragment carries a **pointer to its source statement** (traceability).
  - **Source = `keyConcepts[].verbatim`** (populated from `conception_trail` at
    `app/api/showcase/route.ts:90`). Do NOT use `humanVerbatim()` here (see bug below).
  - The **UI always includes a "none of these" option** that opens free input.
- **Prompt review gate**: the enumerator, grader, and (coming) Layer 5 formalizer prompts must be
  reviewed **before wiring in**. Editor links don't resolve on Albano's side — **paste full prompt
  contents in chat, or push and send GitHub links.**

Reserved for others (spec §5): workflow engine + approval-gate impl (Tim); whether Helper scaffolding
may reference candidate content (Tim); survivor count + safety caps (config; defaults with Albano).

---

## 🟡 Drafted, awaiting Albano's review (NOT wired)

- `prompts/module-5-showcase/genus-species/03-enumerator.md` — the librarian. Retrieve-never-invent;
  three parts per card (source/mapping/tradeoff); rank by surprise-with-sense; spread across fields;
  no steps/algorithms; no counts; quantity-by-distinctness; opens `missing_mechanism` gaps.
- `prompts/module-5-showcase/genus-species/04-grader.md` — the never-satisfied skeptic. Four axes
  (traceability/fidelity/specificity/distinctness, 0–3); stingy verdicts survive/demote/reject;
  demotes/rejects only, never adds.

**Next action on these:** paste full contents to Albano for review (links didn't resolve).

---

## ⏭️ Next up (tomorrow), in order

1. **Write the criterion fragment-extractor prompt** (Option B + hard rules above). Suggested file:
   `prompts/module-5-showcase/genus-species/05-criterion-fragmenter.md`. Present for review (same gate).
   - A build-time guard worth adding: each returned fragment must be an **exact substring** of its
     cited source statement — cheap to verify in the plumbing, enforces "lifted not paraphrased."
2. **Log the `humanVerbatim` bug** as a separate item (see below). Don't fix in this feature.
3. **Paste 03 / 04 / 05 full contents** to Albano; get approval/adjustments.
4. **On approval — build Layer 4 plumbing** (was intentionally held; do NOT build before approval):
   - Parallel fan-out: `Promise.all` running the enumerator per species type → collect candidates →
     grader pass (ideally the other model of the pair, fresh context) → filter survivors
     (target ~5, **configurable safety cap in config, not the prompt**).
   - New types: candidate card + grade; new zod schemas matching the prompt OUTPUT blocks; new
     `runEnumerator` / `runGrader` (+ `runCriterionFragmenter`) runners; register in `PROMPT_FILES`,
     `AGENT_SECTIONS`, `runner.openai.ts`.
   - Criterion question flow: fragment-extract → Helper asks "what must any implementation get right?"
     → tap a fragment or "none of these" → free input; ledger the answer.
   - **Retire `02-species-synthesizer.md`** and flip the live path off the Species Synthesizer only
     once Layer 4 is approved and wired.
5. **Layer 5** (surface + formalizer) — not started. The formalizer prompt is subject to the **same
   review gate**. Gap hooks (`origin: "formalizer"`) already accept gaps.

---

## 🐞 Bug to log (separate from this feature — do NOT fix here)

**`humanVerbatim()` is blind to upstream inventor material in Showcase (type-set mismatch).**
`EvidenceLedger.humanVerbatim()` filters by the `humanSourceTypes` set the ledger was constructed
with. Showcase constructs its ledger with `SHOWCASE_HUMAN_SOURCE_TYPES = {inventor_note, inventor_edit}`
(`lib/modules/showcase/types.ts:256`). Upstream entries seeded from Differentiation carry other types
(e.g. `novelty_statement`), so `humanVerbatim()` silently omits them. Not a crash — silent
under-coverage. Impact: `showcase.inventorMaterial()` under-returns upstream verbatim.
Suggested fix direction (later): thread the union of upstream human-source types into the showcase
ledger, or store a canonical human-source flag on entries instead of re-deriving by type per module.
Workaround in this feature: use `keyConcepts[].verbatim` for the criterion fragments.

---

## Key file map

- Prompts: `prompts/module-5-showcase/genus-species/` — `01-genus-extractor.md` (v2.1, done),
  `02-species-synthesizer.md` (to retire), `03-enumerator.md` (review), `04-grader.md` (review),
  `05-criterion-fragmenter.md` (to write).
- Orchestration: `lib/modules/showcase/controller.ts` (fan-out ~line 479; `recordGaps`;
  `generateVariations`), `agents.ts` (schemas + runners), `types.ts` (Gap/Genus/AgentName),
  `runner.openai.ts` (model map — register new agents here).
- Route/hook/UI: `app/api/showcase/route.ts`, `lib/hooks/use-showcase.ts`,
  `components/showcase/showcase-panel.tsx`.
- Provenance/ledger: `lib/modules/shared/concept.ts` (`Provenance`), `lib/modules/shared/ledger.ts`.

---

## Built so far (full inventory, file-level)

All typecheck-clean; **not live until server restart**. Draft prompts are intentionally unwired.

1. **Genus/species schema survival** — v2 outputs stopped being silently stripped by Zod. Species
   gained `sequence_of_operations`, `constraint_enforcement_map`, `invariant_preservation_map`, and
   `differentiation_from_siblings` (old `differentiation_from_traditional` kept as back-compat);
   `renderGenus`/`renderSpecies` pass the new fields downstream.
   `agents.ts`, `types.ts`, `prompts/module-5-showcase/07-detail-description-extender.md`.
   ⚠️ Interim side effect: this now pipes the still-live 2.0 Synthesizer's algorithm content
   (`sequence_of_operations` etc.) into the extenders — a POHC leak that Layer 4 removes. See "Next up".
2. **Helper sees the draft + anti-confabulation guardrail** — `showcase.helperContext()` includes the
   full ICB draft + KC text; shared Helper prompt guardrail (ground in context, flag gaps, don't loop).
   `showcase/controller.ts`, `shared/helper-agent.ts`.
3. **Helper sees on-screen cards in every module** — `renderScreenCards()` in `shared/helper-agent.ts`,
   wired into conception/maturation/differentiation/showcase; landscape passes full prior-art detail.
   The four module controllers + `landscape/controller.ts` + `conception/agents.ts`.
4. **Section polish/redline (Draft/Revise with AI)** — `section-polisher` agent + prompt
   (`11-section-polisher.md`), `polishSection` controller method, `polish_section` route op,
   `polishSection` hook, editor buttons on Background/Summary/Abstract. Proposal-only; preservation-first.
   `agents.ts`, `types.ts`, `runner.openai.ts`, `controller.ts`, `route.ts`, `use-showcase.ts`,
   `showcase-panel.tsx`. NOTE: now also gated on review; needs the restate-only-never-extend rule (below).
5. **Gap object infrastructure** — `Gap`/`GapClass`/`GapOrigin`/`GapLocus`/`GapStatus`/`DeclaredGap`,
   `gaps` on `Module5View`, `gap_opened` ledger type; controller `gaps` state + `recordGaps()` +
   `gapLocus()` + `gap_opened` events + snapshot + view. **Lives in showcase `module_state`
   (showcase-local), NOT the shared ledger** — see open item on relocation.
6. **Layer 2 Genus Extractor remediation** — `01-genus-extractor.md` → `genus_extractor_v2.1`; legal
   scaffolding stripped; constraints/invariants formalized-from-inputs-only; opens gaps not authored;
   `GenusOutput`/`Genus`/`renderGenus` dropped `formal_mapping_statement`/`technical_problem`/
   `technical_effect`, added `gaps`; controller records extractor gaps.
7. **`inventor_confirmed` provenance tag** — added to `Provenance` union in `shared/concept.ts`.
8. **Layer 4 prompts (DRAFTED, unwired, gated on review)** — `03-enumerator.md`, `04-grader.md`,
   `05-criterion-fragmenter.md`.
9. **Docs** — `genus-species-redesign-live-code-corrections.md`, this TODO,
   `bug-humanverbatim-showcase-type-mismatch.md`.

## Layer 4/5 flow BUILT behind a flag (2026-07-15)

The full redesign flow is implemented and typecheck-clean, dark behind
`SHOWCASE_CONFIG.layer4.live` (default **false**). Flip to true only after Tim's
gate-change walkthrough. While false, the legacy path (2.0 Synthesizer + Gate 1)
runs unchanged behind the renderSpecies stopgap.

Flow (flag on): genus → criterion fragmenter → **criterion card** (tap = `inventor_confirmed`
+ source pointer; free text = `inventor_conceived`) → enumerator ×3 parallel → grader ×3
→ bucket (survivor/reserve/reject) → **sweep card** (keep/dismiss/pull-more/show-different/
finalize; keep = `candidate_kept` tagged `inventor_confirmed`, meaning "fits criterion, not
conceived") → formalizer per kept → **Across Implementations** (`detail_across`) → complete.

Built: `config.ts` (flag + caps), Layer 4/5 types + phases + ledger types + `criterion_set`
human-source, `06-formalizer.md` + `runFormalizer`, criterion/enumerate/grade/sweep/formalize
in `controller.ts` (KC-derived stable ids via `stableHash`, gap recording for enumerator +
formalizer, snapshot round-trip), `criterion`/`candidate_sweep` in `act()`, `CriterionView` +
`SweepView` in the panel. Route/hook needed no change (extended `CardActionInput`).

Remaining before/at the flip:
- **Flip the flag** (`SHOWCASE_CONFIG.layer4.live = true`) — after Tim's walkthrough; the user schedules it.
- **Delete the legacy path** (2.0 Synthesizer `02-*.md` + `runSpeciesSynthesizer`, Gate-1 `species_review`, the renderSpecies stopgap) once confident on the new flow — currently gated, not deleted.
- **Gap-surfacing UI** still deferred (gaps are recorded + on the view, not shown).
- Not runtime-verified (flag off); typecheck-clean only.
- **New (flag-on) flow does NOT run the legacy Gate-2 broadening/extenders** (KC broadening, background/summary/abstract extenders). Per the spec's lean flow. Flag if you want those retained.

## Priority correction (2026-07-15)

Because item 1 makes the interim live path carry the 2.0 Synthesizer's authored algorithm content into
the extenders, **Layer 4 wiring jumps the queue**: as soon as 03/04/05 clear review, Layer 4 is the
next build — ahead of Layer 5 and everything else. (Optional interim mitigation available: stop
`renderSpecies` feeding the algorithm fields to the extenders until Layer 4 lands.)
