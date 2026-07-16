# Module 5 Rebuild: Genus & Species
## Builder Specification v2.3

Date: 2026-07-16
Audience: the build agent (V2 repo) and the prompt creator. This is the build. Nothing in it is pending approval, and everything flagged by Tim in the review sessions is incorporated below as requirements, not options. Where a named surface differs from the live repo, the live name wins and this spec's behavior wins. Section 13 is Phase 0: run it before any build step.
Supersedes: Builder Specifications v1.0 through v2.2.

---

## 1. The three rules of this spec

**R1. The Chain Rule. No machine output is single-pass.** Every AI artifact passes a chain of two or three steps before it is persisted or shown: Produce, then Verify in a fresh context on the second model of the pair, then Repair once if the verify fails, then mechanical fallback. The verifier receives the fixed rubric for that artifact and the pipeline map, never the producer's conversation. Verify findings show their work: each finding quotes the exact text it flags and cites its rule, the rubric check id for deterministic rules and the MPEP reference store section for patent-substance judgments (overbreadth, definiteness, traceability, subjective terms). A finding without quote and citation is discarded. Every chain writes a receipt to the quality ledger. One-shot generation gated by a human click is the pattern this rebuild retires.

**R2. The Interaction Budget. The inventor has already done the typing.** Modules 1 through 4 collected the conception record; this module spends it. There is no typed composition anywhere in this module: the UI never presents an empty text field. Interaction is selection: Keep, Remove, Edit on cards, where Edit only ever touches inventor-origin text (their mined quotes) or machine abstractions of it (the genus statement). Everything is mined from the verbatim record and tap-confirmed; nothing is ever asked. Where the record is silent, the region rests at disclosure grade and a gap object records exactly what is missing.

**R3. The Claims-Core Rule.** The Key Concept set is the asset the customer is buying. Nothing AI-authored becomes a Key Concept or part of one. Enforcement is structural: generator inputs are restricted to inventor-approved objects, and no schema field exists for machine-invented content. Confirming a verbatim quote of the inventor's own words by tap is legitimate confirmation; confirming a machine-retrieved vehicle by tap caps at disclosure grade.

## 2. Interaction budget (design the UI to this)

| Interaction | Cost | Where |
|---|---|---|
| Tap Keep / Remove | unlimited | every card surface |
| Tap Edit (touch-up of inventor-origin text) | low, optional | genus statements, mined quotes, KC review |

Typed composition: none. The module never asks the inventor to write.

Auto-run on stage entry is retained. Auto-advance past any pending review is removed: the stage never finalizes with an unviewed review card.

## 3. Phase A: Possession Inventory

Reads only what the stage already receives: the Key Concepts (title, statement, verbatim) and, for A3, the joined verbatim record.

**A1. KC hygiene chain.** Produce: deterministic lint (near-duplicate detection at similarity 0.85 or above, fixture-validated: the B document's KC1/KC2/KC3 score 0.905 to 0.927 pairwise while byte equality misses them; internal-vocabulary lexicon covering pipeline tokens and template category names, fixture-validated: ai_assisted, ai_native, agentic, and hardware_optimization all appear in the shipped B text; meta-commentary markers, fixture-validated on KC16; spellcheck; subjective-term lexicon). Verify: semantic-duplicate pass on the second model (two KCs a practitioner would read as the same scope). Repair: none; findings become cards. Inventor sees cards only when findings exist: duplicate pairs as Keep one / Keep both, flagged text as Keep / Remove. The clean set is the sole input to everything downstream. (Register G1, G2, G3, G4)

**A2. Genus detection, plural.** Produce: cluster the clean KCs by shared transformation; draft one genus statement per cluster (input pattern, transformation pattern, output pattern), every abstraction carrying verbatim anchors of at least 8 characters from the KC verbatim. Verify: deterministic anchor substring check plus a fresh-context neutrality and overbreadth review against the anchors (does the statement claim more than the quotes support). Repair once, then narrow mechanically to the anchored portion. Inventor: one card per genus, Keep / Edit / Remove. Edits are inventor_conceived. Multiple genera are carried in parallel through all later phases.
**A3. Constraint mining. This build fills the empty array.** Produce: mine the full verbatim record for candidate constraints, invariants, operation steps, and data structures; every candidate is a verbatim quote with its anchor, classified by type. Verify: deterministic anchor check, deduplication, classification review on the second model. Repair: drop unanchored candidates (never rewrite them into existence). Inventor: candidates grouped by type as tap cards, Keep / Remove, Edit permitted for trimming their own words. Output: confirmedConstraints populated with anchored, type-classified, inventor-confirmed entries, flowing through the existing signatures of the enumerator, grader, and formalizer. Required classes with no surviving candidate become gap objects routed to Phase C, not questions asked here. (F1, F2, C6; the deferred constraint layer, built)

## 4. Phase B: Axis Walk (the search)

Machine-side only; the inventor sees nothing until the region cards in Phase C. Runs per approved genus.

**Region schema:** region_id, genus_id, axis_id, position, status (primary | free_species | candidate | protected | included | excluded | parked), vehicle (nullable: label, source_class, mapping, tradeoff, grade), anchors[], deltas[], receipts[].

**B1. Axis set.** Axis one is the automation axis, seeded with the three mandatory build-styles, always produced first, in fixed order, never dropped, shown first:
1. ai_assisted: an AI that helps a person do it. A person does the work while an AI suggests, drafts, or checks alongside them; the person stays in the loop and decides.
2. ai_native: an AI that does it directly. An AI takes the input and produces the result itself, without a person doing each step.
3. agentic: an autonomous helper that works in steps. A self-directed helper breaks the job into steps, decides what to do next, and carries them out with light oversight.

The remaining software axes, walked for every genus: execution locus (client, server, edge, distributed, on-chain with off-chain split); timing (real-time, batch, event-driven); integration surface (standalone, API, plugin, embedded); data regime (modality, tenancy, privacy-preserving variants); mechanism family for the core transformation; deployment scale; degraded and offline operation; hardware acceleration of the software method. Axis applicability per genus is itself a chain: Produce the applicable subset with a one-line reason each, Verify against the genus statement and inventory, Repair once. Inapplicable axes are recorded with their reason, not silently skipped.

**B2. Possession check per region.** Produce: match inventory entries and verbatim against each region. Verify: deterministic anchor check. A match makes the region a free_species at zero inventor cost. This runs before any retrieval, so the system never asks outside for what the inventor already said.
**B3. Candidate vehicles for uncovered regions.** The existing enumerator and cross-model grader, now fed real inputs: the genus plus confirmedConstraints plus the region definition. Produce candidates; Verify with the grader whose traceability and fidelity dimensions finally have referents; Repair by drop. Every candidate carries a source_class with exactly two values: inventor_supplied, or established_practice as attested by the cross-model verify. A candidate the verify cannot attest is dropped. The mandatory three are exempt from drop, are established_practice by definition, and are graded with their grades recorded.
**Termination condition:** every applicable axis of every approved genus has every region carrying a status. The resulting status ledger is the machine half of the exhaustiveness claim; the inventor half is Phase C.

## 5. Phase C: Region decisions (the sweep, rebuilt)

Region cards grouped by axis, mandatory three first, free species pre-marked. Taps only:
- **Keep**: include at disclosure grade. Breadth prose in the specification; never a Key Concept.
- **Protect**: nominate for claim grade; opens the mined delta cards of Section 6.
- **Remove**: excluded, recorded with the exclusion as deliberate scope honesty.
- **Park**: gap stays open; claim grade hard-blocked for that region, disclosure floor unaffected.

Free species default to Keep and protect by taps alone: their anchors already exist and surface pre-filled for confirmation.

## 6. Delta mining (zero typing)

Per protected region, a chain harvests deltas from the record before the inventor sees anything. Produce: search the full verbatim record for statements relevant to this region's setting, since the inventor may already have said how the mechanism behaves in this locus, timing, or regime; each candidate is an anchored verbatim quote. Verify: deterministic anchor check, a fresh-context relevance review, then the specificity check (the quote must name a component and a behavior change). Repair: drop. A quote is never rewritten into existence.

The inventor sees delta cards, each carrying one of their own quotes:
- tap **Keep**: the delta is confirmed for this region;
- **Edit**: trim or tighten their own words; the result is captured verbatim, inventor_conceived;
- tap **Same as primary**: the mechanism is unchanged in this setting; records an invariance statement anchored to confirmed invariants;
- tap **Does not apply**: region moves to excluded;
- tap **Remove**: the quote is not a delta for this region.

Claim grade requires at least one kept passing delta or one region-specific confirmed constraint; the invariance path carries a dependent Key Concept only where a confirmed invariant covers the region. A protected region with nothing mined and nothing kept rests at disclosure grade, and a gap object records exactly which delta class is missing. This module harvests conception; it never solicits it. New conception evidence is created upstream (Modules 0 through 4), and the Coverage Ledger states honestly where the record ran out.

The design-around walk is machine-side: an enumerator pass frames candidate regions as competitor avoidance attempts against the anchored elements, sourced established_practice, graded like any candidate, and swept by taps in Phase C. It creates disclosure-grade breadth, never claim grade.

## 7. Phase D: Key Concept generation

Inputs restricted by schema to: approved genus statements, confirmedConstraints, passing deltas, free-species anchors. No vehicle text, no enumerator output, no template categories. The conceptAspects array (genus_mechanism, species_spectrum, hardware_optimization) is deleted from the code.
**D1. Independent Key Concepts.** Per genus, the independent position at the approved statement, rendered in three framings, in key-concept register with plain labels: as a method of steps, as a system of parts, as instructions on a medium. Same inventor content, three shapes, pure formalization. Each framing is element-structured: a preamble, discrete elements, and consistent reference to previously introduced elements, in key-concept vocabulary. All three ship in the disclosure output so the reviewing practitioner receives full coverage. In the review UI the three render as one grouped card per genus; Keep, Edit, and Remove act on the group, with per-framing edit inside the card.

**D2. Dependent Key Concepts.** One per claim-grade region, adding exactly one distinguishing limitation drawn from that region's confirmed constraint or passing delta, ordered as a retreat ladder from broadest to narrowest so fallback positions pre-exist any challenge.

**D3. Generation chain.** Produce; Verify: element-traceability (every element maps to inventory or delta), antecedent basis (every definite reference resolves to an earlier introduced element), no functional element without an operation sequence behind it in the inventory, no two Key Concepts of identical scope, subjective-term lexicon, terminology compliance; Repair once, then the failing concept is withheld with a logged reason, never shipped defective. Inventor review uses the existing review surface verbs: Keep, Edit, Regenerate, Remove per concept.
## 8. Phase E: Render, protect, prove

- Snapshot the disclosure before apply; the current in-place mutation gains an undo point.
- Rendering contract on the apply path, deterministic: enumerations stay enumerated; every cross-reference resolves to the list it names; one vocabulary across specification and figures; one control-flow figure obligation per claim-grade region contrasting its delta with the primary embodiment, generated from that region's operation material; claim-grade regions are the only figure-bearing regions, so figure cost is bounded by the inventor's own Protect decisions; every generated eraserDSL block opens with direction down followed by colorMode outline and styleMode plain as its second and third lines; figure bijection so a shrinking figure set blocks the release.
- Gap objects surface as parked-region cards in the final review; missing_mechanism hard-blocks claim grade only.
- The Coverage Ledger exports with the ICB: per genus, per axis, every region with its status, decision, and anchors. This artifact is what shows a reviewing practitioner in minutes that scope was walked exhaustively and where every fallback sits, and it is the evidence spine the Proof of Human Conception certifies against.

**The apply map: what writes where.** Rendering consumes only approved objects and lands them as follows, organized per genus when more than one genus was approved:
- Detailed Description, species subsections: one full passage per claim-grade region (vehicle skeleton, the kept delta quotes as contrasts against the primary embodiment, the invariant core, then that region's constraints, invariants, and operation sequence rendered as enumerations).
- Detailed Description, Across Implementations: disclosure-grade regions as breadth prose grouped by axis, each entry the vehicle mapping in plain language; nothing is asserted here that the inventory does not carry.
- Key Concepts: per genus, the three-framing independent group (D1), then dependents ordered as the retreat ladder (D2), then the original embodiment-level Key Concepts retained unchanged as the deepest retreat positions, re-parented under their genus. Nothing is deleted from the claims-core; broadening only ever adds above and around it.
- Summary: extended with the approved genus statement per genus and a one-paragraph species overview naming the covered axes.
- Background: extended only where a genus framing needs field-level context, drawn from inventory material; if the inventory carries none, the Background is untouched.
- Abstract: rewritten to the broadest approved genus within the word budget.
- Figures: one control-flow figure per claim-grade region plus the existing primary figures; the figure plan is part of the render, not an afterthought.

**Section render chains.** Every write above is a chain: Produce from approved objects only; Verify against the rendering contract (enumeration preservation, cross-reference resolution, single vocabulary, no substance beyond inventory and deltas) plus the section's own rule (Abstract word budget; Summary names only approved genera); Repair once; fallback is withhold-and-flag, never a silent partial write.

**Order of operations at module exit.** Render the full artifact set; run the module exit evaluation on that rendered set and apply its one refinement pass; then the final review; then apply. The inventor reviews the refined versions, and apply mutates the disclosure exactly once. The final review is one surface carrying every rendered artifact with original and new text side by side and the verbs Keep, Edit, Regenerate, Remove, plus the parked-region gap cards; Regenerate re-runs that artifact's chain only. Apply then snapshots, runs the deterministic contract checks over the assembled result, and writes; a contract failure blocks the write and surfaces the diff.

**State and resume.** Every chain result and every inventor decision persists on completion, keyed to stage state, so a refresh resumes at the same card and nothing re-runs silently. Start-over re-runs the stage from Phase A against the same inputs, supersedes prior receipts rather than deleting them, and keeps the snapshot history.

**Edge paths.** No genus survives review: the module completes without changes and records why. Zero regions kept: the original disclosure and Key Concepts pass through untouched. Zero claim-grade regions: disclosure-grade breadth still renders, the claims-core gains only the genus-level independents that A2 anchors support, and the Coverage Ledger says so. A chain exhausts its fallback: the artifact is withheld with its receipt and the module completes without it. Apply blocked by the contract: nothing is written, the diff surfaces, and the snapshot guarantees the pre-apply state regardless.

**Module exit evaluation.** On the rendered artifact set, before the final review, one evaluation chain runs four fixed perspectives over the broadened draft and the Key Concept set, each scoring 1 to 10 against three fixed questions with quote-cited findings: the mathematician (logical completeness: operation sequences compose, invariants do not contradict, every defined term is used and every used term is defined), the engineer (buildability: each claim-grade species is implementable from what is written, the data structures suffice, it can be piped and run), the philosopher (the genus holds as a category without the primary embodiment and its boundaries are defensible), the artist (the disclosure communicates, the utility lands as obvious, the breadth reads as wide and unexpected). Any perspective below 7 triggers exactly one targeted regeneration of the failing artifacts with that perspective's findings as feedback, then a rescore. Results persist to the quality ledger either way. This evaluation refines, it does not block: blocking belongs to the deterministic checks and the traceability verifies, so the rock-solid bar gates and the insanely-great bar improves. This implements the four-perspective evaluation adopted in the July 15 session.

## 9. Chain assignments

| Chain | Produce | Verify (fresh context, second model) | Fallback |
|---|---|---|---|
| KC hygiene | deterministic lint | semantic duplicate pass | cards to inventor |
| Genus detection | cluster + anchored statements | anchor check + overbreadth review | narrow to anchored portion |
| Constraint mining | anchored quote candidates | anchor check + classification review | drop unanchored |
| Axis applicability | applicable subset + reasons | genus and inventory consistency | include axis by default |
| Vehicle enumeration | enumerator with constraints + region | cross-model grader | drop; mandatory three exempt from drop, grades recorded |
| Delta mining | region-relevant anchored quotes from the record | anchor, relevance, specificity | drop; region rests at disclosure grade |
| KC generation | generator per D1 and D2 | traceability + scope + lexicon | withhold concept, log reason |
| Section renders (species passages, Across Implementations, Summary, Background, Abstract, figures) | render from approved objects only | rendering contract + section rule | withhold and flag, never partial |
| Apply | render | rendering contract checks | block apply, surface diff |
| Exit evaluation | four perspectives score the rendered set | rescore after one feedback regeneration | persist scores, non-blocking |

Every chain writes a receipt (QC spec schema) whether it passes or repairs.

## 10. Provenance map

| Event | Tag or record |
|---|---|
| Mined quote kept | content inventor_conceived by origin; confirmation logged as curation |
| Genus or quote edit, kept delta | inventor_conceived by origin, verbatim capture |
| Vehicle kept at disclosure grade | inventor_confirmed, meaning recorded as confirmed-fit-not-conceived |
| Region Protect, Remove, Park | decision events with region_id |
| All machine chain steps | system_formalized plus receipt |
| Withheld KC or dropped delta candidate | withheld event with reason |

No new provenance tags are introduced. Pannu scoring rule: disclosure-grade material (inventor_confirmed) is excluded from conception-factor inputs; each claim-grade dependent Key Concept carries references to its inventor_conceived deltas and constraints, and those references are the scoring inputs. The Coverage Ledger records confirmation events as curation, never conception.

## 11. Build order (each phase shippable, floor at live behavior)

0. Phase 0 reconnaissance per Section 13: map spec names onto live surfaces, record the mapping in a receipt.
1. Regression harness stood up with the A, B, and C documents as scored fixtures and the no-regression rule active. No later phase ships without a green run.
2. A1 hygiene chain plus snapshot-before-apply plus rendering contract checks. Deterministic, immediate, protects the claims-core and the apply path today.
3. A3 constraint mining feeding the existing signatures, with A2 anchored editable genus. The empty array fills; enumerator and grader get referents. Sweep unchanged.
4. Region schema plus B1 axis walk plus the rebuilt sweep of Phase C. Retrieval machinery reused; the mandatory three keep their seat.
5. Delta mining (Section 6) and claim-grade tiering.
6. D-phase KC generator swap; template aspects deleted.
7. Section render chains and the apply map, Coverage Ledger export, gap surfacing in final review, and the module exit evaluation.

Golden-corpus rerun before each phase ships, no-regression rule enforced.

## 12. Fixed build parameters (not subject to review)

- Three-framing independent Key Concepts ship in the consumer disclosure output, plain key-concept register, grouped-card review.
- The Section 4 axis set is final for this build. Axes live in config as data, so future additions are config edits, not rebuilds.
- Pannu inputs: claim-grade conception references only; inventor_confirmed is curation, never conception material.
- source_class has exactly two values: inventor_supplied and established_practice. No landscape value exists in this build; do not add a placeholder.
- Figures: claim-grade regions only, one control-flow figure each, Eraser DSL constraints as stated in Section 8, cost bounded by Protect decisions.
- The mandatory three build-styles: fixed order, always produced first, never dropped, graded with grades recorded.
- Every verify finding carries a verbatim quote plus a citation (rubric id or MPEP section) or is discarded.
- The four-perspective exit evaluation runs as specified in Section 8: scores persist, one feedback regeneration, never a block.
- The regression harness with the A, B, and C fixtures is live before Phase 1 ships.
- Zero typed composition anywhere in the module; Edit acts only on inventor-origin text and the genus statement.
- Nothing is deleted from the claims-core at apply; broadening adds above and around the original Key Concepts.
- UPL register tuning is out of scope for this build. Key Concepts ship at full structural rigor; language can be adjusted later without structural change.

## 13. Phase 0: repo reconnaissance (execute before any build step)

Read the live surfaces below and map this spec's names onto them. Live names are authoritative for naming; this spec is authoritative for behavior. Record the mapping in the build's first receipt.

- Exact TypeScript shapes of Key Concepts, module_state disclosure sections, gap events, and the Shared Consciousness payload
- The enumerator, grader, and formalizer signatures accepting confirmedConstraints as documented
- Model pairing mechanism (drafter and verifier) for chain assignments
- Sweep and review components' capacity for the new card types and taps
- Apply path location for snapshot insertion and rendering checks
- The current write paths for Abstract, Summary, Background, and Detailed Description, for the section render chains and the apply map
