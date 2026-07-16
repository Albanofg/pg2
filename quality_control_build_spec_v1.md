# Patent Geyser Quality Control System
## Build Specification v1.0

Date: 2026-07-15
Audience: code builder. Assumes familiarity with the Patent Geyser V2 process specification (Modules 0 through 6, the Ledger, the Boundary, provenance tags). No other context required.
Status: ready for phased build per Section 13. Items in Section 15 are open and owned as listed.

---

## 1. Purpose

Patent Geyser currently verifies the format of every module-to-module handoff (JSON shape) but not the quality of the content inside it. This system adds internal quality control at every module boundary, plus a full evaluation of the assembled end-result document before export.

Design intent in one line: catch defects at the earliest stage where they are detectable, prove every finding with a citation and a verbatim quote, and never let the quality layer author inventive content.

The system is invisible to the inventor, with one defined exception (Section 9.3: substantive gaps surface through the Helper as questions, never as QC output).

Terminology note: "ICB" below means the assembled end-result document, a team-internal term. All inventor-facing language remains governed by the locked product terminology (invention disclosure, key concept, and so on).

Module numbering note: this spec follows the July 15 restructure. Genus & Species is a standalone Module 5. Showcase is Module 6. This supersedes any earlier numbering in the process specification.

## 2. What this spec does not cover

- Grader prompt text. This spec defines the contract every grader must satisfy (Section 8). The prompt creator authors the actual prompt files.
- Greatness rubric content (the four-perspective evaluation). The slot is built here; the criteria are owned by Tim (Section 15).
- Final threshold values. All thresholds ship as provisional defaults (Section 14) and are calibrated with the Golden Set (Section 11).

## 3. Components and canonical terms

Final naming is subject to Albano's terminology lock. Terms used consistently throughout this spec:

- **Stage Gate**: the QC checkpoint at a module boundary. Composed of the Deterministic Validator and the Grader.
- **Deterministic Validator**: code-only checks, no AI. Runs before the Grader on the artifact and after the Grader on the Grader's output.
- **Grader**: an AI evaluator, one per stage, called in a fresh context with a fixed rubric. Judges, never decides, never fixes.
- **Quality Receipt**: the structured record of one gate run. The only thing a gate produces.
- **Quality Ledger**: append-only, hash-chained store of Quality Receipts. A sibling stream on the existing PoHC ledger rails.
- **Rubric**: versioned definition of the checks a gate runs, with weights, severities, classes, and MPEP anchors.
- **Pipeline Map**: static config describing what every module does and explicitly does not do. Injected into every Grader call.
- **Gap Object**: the existing planned pipeline-wide record of an unresolved substantive gap. This system is a producer of Gap Objects; it does not own the gap schema.
- **End-Result Analyzer**: the full-ICB evaluation before export. Same receipt machinery, its own rubric.
- **MPEP Reference Store**: versioned corpus of MPEP sections and USPTO support material, used for retrieval into Grader calls.
- **Golden Set**: fixture ICBs with known planted defects, used to qualify every rubric and grader version.

## 4. Placement

| Gate | Runs on | When |
|------|---------|------|
| G1 | Module 1 (Conception) handoff artifact | after module output finalized, before Module 2 ingests |
| G2 | Module 2 (Maturation) handoff artifact | same pattern |
| G3 | Module 3 (Landscape) results mapping | same pattern |
| G4 | Module 4 (Differentiation) handoff artifact | same pattern |
| G5 | Module 5 (Genus & Species) artifacts | per species artifact and on the merged set |
| G6 | assembled ICB | after Module 6 assembly, before export (this is the End-Result Analyzer) |

Module 0 (Helper) has no gate. It is the delivery channel for substantive gaps (Section 9.3).

Stage Gates are internal QC and are distinct from the inventor approval gates that already exist inside modules (for example the two approval gates inside Module 5). Approval gates remain exactly as specified in the process spec; QC gates run on artifacts regardless of approval state.

Latency: gates sit between inventor approval and next-module availability. The builder decides sync vs async presentation. Hard requirement: raw QC output is never rendered to the inventor.

## 5. Invariants

These hold everywhere in the system.

**I1. Code decides, AI judges.** Every pass, regenerate, or block verdict is computed deterministically from structured Grader output plus Validator results. The Grader never emits a verdict or a score.

**I2. Fresh context.** A Grader call never shares context with the generation that produced the artifact, and never sees another gate's conversation.

**I3. Cite and quote, or the finding does not exist.** Every AI finding carries (a) a rubric check id, (b) an MPEP or rubric citation, and (c) a verbatim evidence quote of at least 8 characters that substring-matches the artifact. The Validator discards unanchored findings and logs a Grader Integrity Event.

**I4. Read-only on inventive content.** The Grader output schema contains no field in which fix text can live. For substantive findings the maximum output is a single follow-up question. Enforcement is structural, the same philosophy as the ai_mode enum omitting a generating value: the capability is absent, not merely forbidden.

**I5. Versioned rubrics.** Rubrics and grader prompt versions are immutable once promoted. Scores are comparable only within a rubric version. Every receipt records rubric_version, grader_prompt_version, model_id, and mpep_edition.

**I6. No receipt, no verdict.** Every gate run appends exactly one receipt to the Quality Ledger before its verdict takes effect. Receipts are immutable, enforced by database triggers, the same pattern as the PoHC ledger.

**I7. Bounded loops.** Regeneration is capped per artifact per stage (default 2). Every receipt records iteration lineage via parent_receipt_id.

**I8. Out-of-scope awareness.** Every Grader receives the Pipeline Map. A finding about a responsibility the map assigns to another module is invalid and is discarded by the Validator. This is what prevents false flags such as reporting a missing prior art search that Module 3 performs.

## 6. Data structures

Field lists are semantic. Builder aligns actual names and types with the live Prisma schema. [verify against live]

### 6.1 Quality Receipt
- receipt_id, parent_receipt_id (nullable, links regeneration lineage)
- stage_id, gate_id, artifact_id, artifact_hash, artifact_version
- rubric_version, grader_prompt_version, model_id, mpep_edition
- validator_results: array of { check_id, verdict (pass | fail), detail }
- grader_findings: array of { check_id, verdict (pass | fail | warn), severity (high | medium | low), class (formal | substantive), citation { source, section }, evidence_quote, reasoning (short), follow_up_question (nullable, substantive findings only) }
- discarded_findings: array of { raw_finding, discard_reason }
- computed_score (0 to 100), thresholds_applied
- gate_verdict: PASS | REGENERATE | BLOCK
- iteration_index, created_at, prev_hash, entry_hash

### 6.2 Rubric and Check
Rubric: rubric_id, stage_id, version, status (draft | promoted | retired), mpep_edition, checks[]

Check: check_id, description, class (formal | substantive), layer (deterministic | grader), weight, severity, scope (which artifact regions or concerns it covers), mpep_anchors (nullable for deterministic checks), falsification_note (how this check could false-positive or false-negative; required on every check, this is what the Golden Set exercises)

### 6.3 Pipeline Map
Per module: module_id, responsibilities[], non_responsibilities[] (explicit), produces, consumes. Static config, versioned, injected into every Grader call.

### 6.4 Gap Object (producer view)
QC writes: gap_class (missing_mechanism | unsupported_assertion | enablement_hole | undefined_term | other_substantive), origin { stage_id, check_id, receipt_id }, evidence_quote, follow_up_question, status open. Closure rules in Section 9.3. Schema ownership sits with the pipeline-wide gap infrastructure, not with QC. [verify against live]

### 6.5 Grader Integrity Event
event_id, receipt_id, type (unanchored_finding | out_of_scope_finding | schema_violation | self_scored), payload. Feeds grader QA reporting (Section 11).

## 7. Layer 1: Deterministic Validator

Runs twice per gate: pre-grader on the artifact, post-grader on the Grader's output.

Pre-grader checks, v1 set:
- Schema validity of the handoff artifact (exists today between modules; folded in here as the first check)
- Required sections present and non-empty for the stage
- ID traceability: every concept, key concept, and species id referenced in the artifact resolves to an upstream ledger entry
- No placeholder or truncation markers (TODO, TBD, cut-off sentence endings, repeated-paragraph detection)
- Terminology compliance by audience: inventor-facing artifacts never contain "claim", "application", or "filing-ready"; no artifact emits the token already excluded by the existing PoHC scorer rule
- Length and structure bounds per stage (configurable min and max per section)

Post-grader checks, v1 set:
- Grader output parses against the findings schema exactly, with no extra keys
- Every finding's evidence_quote substring-matches the artifact (case-sensitive, minimum 8 characters)
- Every finding's check_id exists in the injected rubric version
- No finding targets a non_responsibility of the stage per the Pipeline Map
- No numeric score or verdict fields anywhere in Grader output (I1, I4)

Post-grader violations discard the individual finding, log a Grader Integrity Event, and never fail the artifact.

Placement of this layer (in-pipeline service vs build-time scripts) is an open item owned by Tim (Section 15). Spec assumption until decided: in-pipeline, synchronous, per gate run.

## 8. Layer 2: Grader contract

One Grader per stage. The prompt creator authors each prompt against this contract.

Inputs per call, and nothing else:
1. The handoff artifact, full text
2. The stage rubric (grader-layer checks only, with descriptions, severities, scopes, and MPEP anchors)
3. The Pipeline Map
4. Retrieved MPEP excerpts matching the rubric's anchors, from the MPEP Reference Store. Citations must be grounded in the supplied excerpts, not model memory.

No generation history. No other gates' output. No inventor identity.

Posture:
- Examiner-shaped, strict but fair. Vague hand-waving fails a check; specific mechanisms pass it. The existing single-concern examiner reviewer is the tone model.
- Flag and cite. Never propose, draft, or imply fix content. For each substantive finding, produce exactly one follow-up question that would close the gap.
- Evaluate only against the injected rubric. No self-invented checks, no holistic impressions, no scores.

Output: JSON only, matching the grader_findings shape in 6.1. Nothing else.

Stage focus (declares gate intent; rubric contents are derived through Section 10.3, not authored from this list):
- G1 Conception: concept coherence, on-topic engagement, subject-matter shape risks such as abstract-idea-only concepts
- G2 Maturation: mechanism specificity, undefined load-bearing terms, glossary consistency
- G3 Landscape: result-to-concept mapping integrity, coverage of every selected concept
- G4 Differentiation: differentiation actually references the retrieved art; unsupported novelty assertions
- G5 Genus & Species: species distinctness, genus support for each species, species coverage proportional to genus breadth (variable count, not a fixed three), preservation of constraints and invariants from source material
- G6 End-Result: Section 10

Model routing: grading with a different model than the one that generated the artifact reduces shared blind spots and is worth an A/B. Decision owned by Albano and Tim. Either way, make model_id configurable per gate.

## 9. Scoring, verdicts, and routing

### 9.1 Score computation (code, never the model)
computed_score = sum over grader-layer checks of (weight x value), where pass = 1, warn = 0.5, fail = 0, normalized to 0 to 100. Weights come from the rubric version. This is what keeps scores comparable run to run and version to version.

### 9.2 Verdict rules, evaluated in order
1. Any pre-grader Validator fail of high severity: REGENERATE (formal path)
2. Any substantive-class finding with verdict fail: BLOCK (gap path). Hard block: the missing_mechanism class can never be overridden by score.
3. computed_score below pass_min, or any high-severity formal fail: REGENERATE
4. Otherwise: PASS. Warns ride along in the receipt for trend reporting.

### 9.3 Routing

**Formal path (REGENERATE).** The receipt's failed findings are fed back to the producing module as structured feedback. Regenerate, re-run the gate. Cap: 2 regenerations, configurable. On cap exhaustion, apply the stage's mechanical fallback if one is defined (the Abstract Fixer's capped-iterations-then-truncate pattern is the model), otherwise route to the internal review queue. Never surface to the inventor.

**Gap path (BLOCK).** Write a Gap Object; the gate holds. The Helper receives the gap_class, the follow-up question, and an evidence pointer, and renders the question in its own Socratic register. The inventor never sees the receipt, the finding text, or any QC framing. The gap closes only when the resolution is recorded with inventor_conceived provenance. The producing module then regenerates incorporating the resolution, with system_formalized provenance on the regenerated artifact, and the gate re-runs. Gap-path re-runs do not count against the formal regeneration cap.

**Internal review queue.** Minimal v1: a flagged list in the admin console with the receipt attached.

### 9.4 Provenance on regeneration
QC-triggered regeneration is system_formalized. Nothing in the QC layer ever writes inventor_conceived or system_suggested_accepted.

## 10. End-Result Analyzer

Runs on the assembled ICB after Module 6 assembly, before export. Same receipt machinery, same ledger stream, same invariants.

### 10.1 Compliance section
Rubric v1 is seeded from the evaluation dimensions Tim has already produced in his existing scoring project. Action item: extract those dimensions, restate each as a Check per 6.2 (class, weight, severity, MPEP anchor, falsification note), promote as end_result_rubric v1. Do not let the model re-derive dimensions per run; a model inventing its own scale each session is exactly what versioned rubrics eliminate.

### 10.2 Greatness section (slot only in v1)
A second evaluation pass with four perspective sub-rubrics (mathematician, philosopher, engineer, artist) judging utility, breadth, and unexpected application. Build the slot: four sub-rubric positions, findings merged into the same receipt under a greatness namespace, no gating effect until criteria are promoted. Criteria owned by Tim.

### 10.3 The backtracking loop (how stage rubrics grow)
Every End-Result finding carries an earliest_detectable_stage tag: the Grader proposes it, a human confirms it in the review queue. Confirmed tags accumulate into a per-stage backlog; recurring failure classes become new stage checks in the next rubric version. This is the standing mechanism that turns end-result failures into earlier, cheaper catches. Build the tag field and the backlog view. Rubric authoring stays human.

## 11. Golden Set and promotion

Fixture corpus, stored in the repo:
- At launch, at minimum 3 known-clean ICBs and 5 defect-planted ICBs, grown over time
- Each planted fixture ships a defect manifest: which check_ids must fire, where, at what severity
- Plant categories v1: abstract-idea-only concept, missing mechanism in an operations description, undefined term used as load-bearing, orphan concept id, truncated section, claim-shaped language in an inventor-facing artifact, unsupported novelty assertion, enablement hole in a species

Harness:
- Runs every gate and the End-Result Analyzer against all fixtures
- Promotion rule for any rubric, grader prompt, or model change: 100 percent of planted high-severity defects caught, zero fails on clean fixtures (warns tolerated up to a configured count), zero unanchored_finding integrity events
- Harness results append to the Quality Ledger like any receipt
- Triggered on every rubric version change, grader prompt change, or model_id change

This is the falsifiability mechanism. A grader version is trusted only because it demonstrably catches what it must and stays silent where it should.

## 12. POHC constraints, restated for the builder

- Quality Ledger immutability is enforced by database triggers, the same pattern as the PoHC ledger, not application code alone
- The Grader output schema structurally lacks fix-content fields. Do not add one later for convenience; that hole is how AI-authored inventive content would enter through the QC channel
- QC operations map onto existing ai_mode values; the enum deliberately has no generating value and QC must not introduce one [verify against live enum values]
- The gap closure provenance rules in 9.3 are load-bearing for Proof of Human Conception. Treat them as invariants, not preferences

## 13. Build phases

**Phase 1.** Quality Ledger stream, Quality Receipt schema, Deterministic Validator wired into existing handoffs. No AI involved. Immediate value: structural defects and terminology violations caught from day one.

**Phase 2.** MPEP Reference Store interface, End-Result Analyzer with end_result_rubric v1, Golden Set harness. This phase produces the failure data everything else depends on.

**Phase 3.** Stage gate rollout in priority order: G5 first (Genus & Species, the known weakest quality point), then G4 and the key-concept surfaces, then G2, then the remainder. Per-stage rubrics derived from Phase 2 failure data through the 10.3 loop.

**Phase 4.** Full routing: regeneration loops with caps, Gap Object production, Helper handoff, internal review queue.

**Phase 5.** Greatness slot activation once Tim's criteria are promoted.

Rationale for the order: the End-Result Analyzer plus Golden Set must exist before stage rubrics are worth writing. Gates without calibrated rubrics create noise, and noise kills trust in a QC system faster than missing coverage does.

## 14. Calibration parameters (provisional defaults, all configurable)

| Parameter | Default |
|-----------|---------|
| pass_min per gate | 70 of 100, until Golden Set calibration |
| regeneration cap | 2 |
| evidence quote minimum | 8 characters |
| warn tolerance on clean fixtures | 3 per fixture |
| grader model_id and temperature | per gate config |
| receipt external timestamping | off (internal hash chain only; PoHC anchoring stays where it is) |

## 15. Open decisions

| Item | Owner | Blocks |
|------|-------|--------|
| Greatness rubric criteria | Tim | Phase 5 |
| Final threshold values | Tim and Albano, via Golden Set calibration | gate enforcement hardening |
| MPEP Reference Store corpus content and edition policy | Tim | Phase 2 |
| Deterministic Validator placement (in-pipeline vs build-time) | Tim | Phase 1 detail |
| Cross-model grading A/B | Albano and Tim | nothing; config supports both |
| Canonical names for Module 5 and the Section 3 terms | Albano | naming lock only |

## 16. Verify against live before building

- Field names and types in Section 6 against the live Prisma schema
- ai_mode enum values and where QC operations map onto them
- Ledger infrastructure reuse: confirm the hash-chain implementation supports a second stream without touching PoHC entries
- Current handoff artifact shapes at each module boundary (this spec assumes the post July 15 module structure)
