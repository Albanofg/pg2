# Genus & Species Redesign: Change Specification

Version: draft for review by Albano before handoff
Scope: the genus/species expansion feature (two-prompt chain inside the final draft step, Module 5 pipeline)
Audience: code builder with no prior context

---

## 1. Background the builder needs

Patent Geyser V2 walks an inventor from raw idea to an Invention Disclosure reviewed later by a registered patent practitioner. The system's core rule is Proof of Human Conception (POHC): the AI never authors the inventive step. Every piece of content carries a provenance tag in an append-only, hash-chained store called the Ledger. Existing tags: `inventor_conceived`, `system_formalized`, `system_suggested_accepted`. The enforcement gate that withholds inventive output is called the Boundary. The single inventor-facing assistant is the Helper; all other agents are backstage and invisible.

The genus/species feature currently consists of two AI prompts:

1. **Genus Extractor**: takes the inventor's own words plus their approved Key Concepts, outputs an abstract description of the underlying mechanism (the genus).
2. **Species Synthesizer**: takes the genus plus a species type (`ai_assisted`, `ai_native`, `agentic`), outputs one alternative implementation architecture. Runs once per species in parallel fan-out.

## 2. Why it is being redesigned

The current 2.0 versions of these prompts instruct the AI to author content that must come from the inventor: the constraint boundary of the invention (Extractor) and step-by-step implementation algorithms (Synthesizer). Both are gated only by an approval click, which produces content whose honest provenance is `system_suggested_accepted` at the heart of the disclosure. The redesign changes what each AI step is allowed to produce so the lock holds structurally, and it adds new backstage capability (constraint research, disagreement mapping, skeptic grading). It does not add meaningful user burden.

Guiding rule for every prompt in this spec: **the AI may retrieve, map, formalize, and grade. It may never invent a mechanism, author an algorithm, or define the invention's boundary.** Where inputs lack the substance a step needs, the step opens a gap in the pipeline-wide gap object instead of filling it.

---

## 3. The five layers

### Layer 1: Constraint Discovery (new)

**Purpose.** Before any solutioning, find the domain's real anchor constraints: non-negotiable facts of law, physics, or economics that outlast all other constraints and that only domain insiders typically know. Reference example used internally: the statutory per-copy royalty rule that shaped a 1990s music streaming architecture. The point is to make that kind of insider discovery a research step instead of luck.

**When it runs.** Early, before or beside the Extractor, while inventor engagement is high.

**Flow.**
1. One research-oriented AI pass over the invention's domain (this may use the existing deep research capability). Output: a small list of candidate anchor constraints, each with a one-line statement, why it binds, and its source basis.
2. The Helper presents the candidates. The inventor confirms which ones actually bind their invention. Confirmation is tap-based, no composition required.
3. Confirmed constraints are written to the Ledger with a new provenance tag `inventor_confirmed`, each entry pointing at the research output it confirms.

**Prompt requirements.** Research and citation only. The prompt must not propose solutions, workarounds, or mechanisms that satisfy the constraints. It reports what binds, not what to do about it.

**POHC status.** Research is not conception. Clean.

**Schema note.** `inventor_confirmed` is a new provenance tag. The provenance enum and immutability triggers live in the database schema; adding a value is a schema decision to confirm with Albano before implementation. Do not work around it in application code.

### Layer 2: Genus Extractor (remediated)

**Purpose.** Same as today: distill the paradigm-neutral mechanism from the inventor's material. Two changes.

**Change A: strip the 2.0 legal scaffolding.** Remove from the prompt: all references to statutes, case names, and examination doctrine; the "first line of legal defense" framing; the instruction to re-anchor the invention in machine-level mechanics until it stops reading as a mental process; the requirement that the AI author computational constraints, logical invariants, technical problem, and technical effect when the inventor has not stated them. The Extractor's identity returns to distiller, not legal architect. The 1.0 abstraction laws (no interface surface, no paradigm leak, no inventor echo, paradigm triple check, specificity floor) are sound and stay.

**Change B: constraints come in, not out.** The Extractor now receives the Layer 1 confirmed constraints as an input alongside the inventor's words and Key Concepts. It may formalize constraints and invariants that appear in those inputs. Where the genus needs a constraint or invariant that no input contains, it opens a gap (gap class: missing constraint or missing invariant) in the pipeline-wide gap object and leaves the field empty. It never authors one.

**Inputs.** Inventor's own words, owned Key Concepts, confirmed constraints from Layer 1.
**Output.** Genus object. Provenance: `system_formalized`, with source pointers.

### Layer 3: Derivatives Mapping (new, backstage)

**Purpose.** Locate where non-obvious material lives in this domain. First principles are the settled middle ground where everyone agrees and nothing is patentable. The second and third-order derivative levels are where genuine experts violently disagree, and those disagreement zones are where useful non-obvious candidates come from.

**Flow.** One AI call per project, backstage, after the genus exists. Input: the genus and the confirmed constraints. Output: a structured map with two lists. First, the domain's settled first principles. Second, its live disagreement zones, each described as: the question in dispute, the positions real expert communities hold, and why the dispute is unresolved.

**Prompt requirements.** The disputes must exist in the literature or practice of the field. The prompt reports them; it does not take sides, resolve them, or extrapolate new positions. If the domain has no meaningful disagreement zones, the output says so; that is a valid result, not a failure.

**POHC status.** Mapping existing disputes is retrieval. Clean.

### Layer 4: Enumerator with skeptic grading (replaces the Species Synthesizer)

**Purpose.** This layer is the "thousand experiments." Nothing is literally executed and no experiment count is ever claimed anywhere, in prompts, UI copy, or marketing. Breadth lives inside the generation pass and is demonstrated by the quality of what surfaces.

**Generation pass.** Runs per species type in the existing parallel fan-out. Persona: a librarian surveying established engineering practice, not an engineer designing. Inputs: genus object, confirmed constraints, disagreement map, the inventor's ranking criterion (see below). Output: candidate cards. Each card has exactly three parts:
1. The existing pattern or the existing expert dispute it draws from, named plainly.
2. Its mapping onto this genus, one or two sentences, specific to this invention.
3. Its tradeoff against the inventor's criterion, one sentence.

Candidate sources are exactly two, both retrieval: established patterns from any field including distant ones, and the disagreement zones from Layer 3. Ranking key: how surprising the mapping is in application to this genus while remaining obviously sensible once seen. Candidates spread across fields; variants of one idea do not count as distinct.

**The inventor's criterion.** Before generation, the Helper asks one question: what must any implementation of this invention get right? Answered by tap from fragments drawn from the inventor's upstream Ledger material, with an option to add a short free answer if they want to. Ledgered.

**Hard prohibitions for the generation prompt.** No step sequences or algorithms. No invented mechanisms: every candidate must be traceable to a pattern or dispute that predates the request. No component-to-step maps, no distinctness arguments, no legal doctrine, no claimed counts of anything considered.

**Quantity.** No hardcoded candidate count in the prompt. The instruction is: generate as many candidates as remain genuinely distinct, stop when distinctness runs out. A configurable safety cap lives in config, not in the prompt.

**Grading pass.** A separate AI call in a fresh context, ideally the other model of the existing Gemini/GPT pair. Persona: a self-aware skeptic, a quality expert that is never satisfied, filtering through the first principles and disagreement map from Layer 3. It grades each candidate on: traceability to a real pattern or dispute, fidelity to the genus and confirmed constraints, specificity of the mapping, and distinctness from sibling candidates. It demotes or rejects; it never adds candidates or content. A small set of survivors (target order of five, configurable) proceeds to the surface.

**POHC status.** Retrieval plus mapping plus grading. The genuinely novel step is reserved for the inventor.

### Layer 5: Surface and write-up (minimal user burden)

**The sweep.** Survivors across all species and Key Concepts are presented in one aggregated pass, not per concept. Cards arrive a few at a time with a control to pull more. Interaction per card: keep or dismiss, one tap. Dismissals need no reason and cost nothing. Each card displays, at keep-time, the fragment of the inventor's own upstream Ledger words that sourced it, so a keep is visibly a keep-for-this-reason. Keep writes a Ledger entry: `inventor_confirmed`, pointing at the card and at the upstream source entry. No composition, no typing, no dictation, ever.

**The formalizer.** For each kept candidate, one AI call writes the disclosure section text. Its inputs are exactly three: the card, the inventor's upstream Ledger material, the confirmed constraints. Its rule: restate only what the inputs contain. Where the section needs substance none of the inputs provide (a mechanism's how, a missing step), it opens a gap in the gap object and writes around it. It never extends. This rule is the single most important prompt requirement in this spec; the previous design failed precisely at the point where describing became authoring. Section provenance: `system_formalized`, sources pointed.

**Downstream.** Sections flow into the draft and are covered by the existing whole-document polish. No additional per-section confirmation step exists. Total new user burden for the whole feature: the criterion tap and the keep/dismiss sweep.

---

## 4. Ship order

**Phase 1 (remediation, ships first).** Layer 2 changes and Layer 4 generation pass with prohibitions, plus the Layer 5 surface and formalizer. This removes the live problem in the current 2.0 files. In this phase Layer 4 sources candidates from established patterns only and grading can run in the same fan-out with a simple second-pass call.

**Phase 2 (capability stack, incremental).** Layer 1 constraint discovery, Layer 3 derivatives mapping, per-domain dynamic skeptics, cross-model grading. Each lands independently and improves candidate quality without changing the surface, the provenance model, or any Phase 1 interface.

## 5. Reserved decisions (do not implement without direction)

- Workflow engine choice and approval gate implementation: reserved for Tim.
- Whether backstage candidate knowledge may shape Helper scaffolding language (the teaching layer): reserved for Tim. Until decided, Helper scaffolding must not reference candidate content.
- Addition of the `inventor_confirmed` provenance tag to the schema enum: confirm with Albano.
- Survivor count and safety caps: config values, defaults to be set with Albano.

## 6. Flags

- This spec is written from the 2.0 prompt documents and the design discussion, not from the live codebase. Verify against live before build: the current implementation of the two approval gates, the current genus object schema, and where the fan-out orchestration lives.
- The scorer module is out of scope by prior decision.
- No copy anywhere in this feature may claim experiment counts, novelty of AI output, or filing readiness. Output framing is always: ready to bring to a patent practitioner.
