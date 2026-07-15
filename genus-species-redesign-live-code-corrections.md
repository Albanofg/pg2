# Genus & Species Redesign — Corrections vs. Live Code

Companion to `genus-species-redesign-spec.md`.
Purpose: the spec states (§6) that it was written from the 2.0 prompt documents and the design discussion, **not** the live codebase, and asks that three things be verified against live before build. This document reports that verification. It found four places where the spec's assumptions do not match the current code. None invalidate the design; each changes *where* or *how* a layer gets built, so they should be reconciled before handoff.

Verified against the working tree on 2026-07-14. File references use `path:line`.

---

## 1. Corrections (read before building)

### 1.1 The species fan-out is SEQUENTIAL, not parallel

The spec says the Synthesizer "Runs once per species in parallel fan-out" (§1) and Layer 4's generation "Runs per species type in the existing parallel fan-out" (§3).

**Live code:** `lib/modules/showcase/controller.ts:479` runs the three species one at a time — a `for (const t of SPECIES_TYPES)` loop with `await runSpeciesSynthesizer(...)` inside it. There is no parallelism today.

**Impact:** If Layer 4's grading pass or breadth expectations assume an existing parallel fan-out, that fan-out has to be **built** (e.g. `Promise.all`), not reused. Small change, but it is net-new work, not an existing capability.

### 1.2 There is NO database-level provenance enum or immutability trigger

The spec says (§3, Layer 1 Schema note, and §5) that "the provenance enum and immutability triggers live in the database schema," that adding `inventor_confirmed` is "a schema decision," and to "not work around it in application code."

**Live code:**
- Provenance is a **TypeScript union**, not a Postgres enum: `lib/modules/shared/concept.ts:11` defines `Provenance = "inventor_conceived" | "system_formalized" | "system_suggested_accepted"`. Provenance tags are also carried as plain string tags on ledger entries.
- The Ledger is persisted as a **jsonb blob**, not a relational table with triggers: `db/schema.ts:76` stores each module's engine state under `module_state` jsonb (`showcase?: unknown`). There is no `pgEnum` for provenance anywhere in `db/schema.ts`.
- Append-only / immutability is enforced in **application code**, not the database: `lib/modules/shared/ledger.ts` (the log is append-only by construction; a correction is a new entry, never a mutation).

**Impact:** Adding the `inventor_confirmed` tag is a **code edit** — extend the `Provenance` union in `concept.ts` and use it as a ledger tag — **not** a database migration. There is no DB enum or trigger to change. The reserved-decision framing ("confirm with Albano as a schema decision") should be updated so the builder does not go looking for a Postgres enum that does not exist.

### 1.3 There is no in-application "deep research capability"

Layers 1 and 3 lean on "the existing deep research capability."

**Live code:** No `deep-research` module exists in the repository. Deep research exists as a tooling **skill**, not as a callable function inside the app. There is nothing the pipeline can invoke today for Layer 1 constraint research or Layer 3 disagreement mapping.

**Impact:** The in-app research call is net-new and must be built (or the layer rescoped). It is not a wiring job onto an existing service.

### 1.4 The pipeline-wide gap object does not exist yet

The spec's central safety mechanism — "opens a gap in the pipeline-wide gap object instead of filling it" — is referenced by Layers 2, 4, and 5.

**Live code:** No such object exists. The only "gaps" in the showcase module are the figure-planner's unrelated `gaps: string[]` field. There is no shared gap structure threaded through the genus/species pipeline.

**Impact:** The gap object is net-new and is a dependency of Layers 2, 4, and 5. It should be designed first, since three layers write to it.

---

## 2. Verified build surface (the files this feature actually lives in)

Confirmed present in the working tree. This is the concrete surface a builder edits/extends.

### Prompts (the two AI steps being redesigned)
- `prompts/module-5-showcase/genus-species/01-genus-extractor.md` — 2.0 Extractor (Layer 2 remediation target)
- `prompts/module-5-showcase/genus-species/02-species-synthesizer.md` — 2.0 Synthesizer (Layer 4 replacement target)

### Orchestration / server
- `lib/modules/showcase/agents.ts` — `runGenusExtractor`, `runSpeciesSynthesizer`, and the `GenusOutput` / `SpeciesOutput` schemas (the genus object schema §6 asks to verify)
- `lib/modules/showcase/controller.ts` — the fan-out (~line 479) and BOTH approval gates: Gate 1 `species_review` (`emitSpeciesReview`, ~line 517) and Gate 2 `expansion_review` (~line 740)
- `lib/modules/showcase/types.ts` — `Genus`, `Species`, `AgentName`, and the card/intent types for both gates
- `lib/modules/showcase/runner.openai.ts` — the per-agent model map (every new backstage agent must be registered here)
- `app/api/showcase/route.ts` — the op switch (new ops land here)
- `lib/hooks/use-showcase.ts` — the client hook
- `components/showcase/showcase-panel.tsx` — Gate 1 & Gate 2 review UI (Layer 5 "surface" lands here)

### Provenance / Ledger (POHC machinery)
- `lib/modules/shared/concept.ts:11` — the `Provenance` union (where `inventor_confirmed` gets added)
- `lib/modules/shared/ledger.ts` — the append-only EvidenceLedger (app-code enforcement; `recordInventorSource` / `recordMachineEvent`)
- `db/schema.ts:76` — persistence: `module_state` jsonb blob + the append-only shared-consciousness table
- `lib/modules/shared/backpack.ts` — the `broadening`, `abstract_rules`, and `enablement_101` doctrine blocks the prompts pull (Layer 2's "strip the legal scaffolding" touches which blocks the Extractor loads)

### Existing "formalizer-like" agents to model Layer 5 on
- `prompts/module-5-showcase/05-background-extender.md`
- `prompts/module-5-showcase/06-summary-extender.md`
- `prompts/module-5-showcase/07-detail-description-extender.md`
- `prompts/module-5-showcase/08-abstract-rewriter.md`
- `prompts/module-5-showcase/09-key-concept-appender.md`

---

## 3. Per-layer file impact

| Spec layer | Files touched / created |
|---|---|
| L1 Constraint Discovery (new) | new prompt in `genus-species/`; new runner in `agents.ts` + registration in `runner.openai.ts`; controller flow; **new provenance tag** in `concept.ts`; Helper confirm-card in `types.ts` + `showcase-panel.tsx`; **new deep-research call** (see 1.3) |
| L2 Genus Extractor (remediate) | edit `01-genus-extractor.md`; likely trim `GenusOutput` / `Genus` back; adjust the Extractor's doctrine blocks in `agents.ts` (`AGENT_SECTIONS`) |
| L3 Derivatives Mapping (new, backstage) | new prompt; new runner + registration; controller call after genus; **deep-research call** (see 1.3) |
| L4 Enumerator + skeptic grading (replaces Synthesizer) | replace `02-species-synthesizer.md` with generation + grading prompts; new schemas + runners; **build the parallel fan-out** (see 1.1) and add the criterion question in `controller.ts` |
| L5 Surface + formalizer | new "sweep" card type in `types.ts` + `showcase-panel.tsx`; a formalizer prompt (cousin of the §2 extenders); writes `inventor_confirmed` to the Ledger |
| Cross-cutting | the **gap object** (see 1.4) — design first; L2, L4, L5 all write to it |

---

## 4. Summary for the spec author

The design is sound; four assumptions need reconciling:

1. Parallel fan-out is not present — it is built in Phase 1, not reused.
2. Provenance is app-code (a TS union + ledger tags), not a DB enum with triggers — `inventor_confirmed` is a code edit, not a migration.
3. No in-app deep-research capability exists — Layers 1 and 3 need it built or rescoped.
4. The pipeline-wide gap object is net-new and is a shared dependency of Layers 2, 4, and 5 — design it first.
