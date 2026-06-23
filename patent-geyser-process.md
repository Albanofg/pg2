# Patent Geyser — Process Specification

This document describes the full process, every stage, from raw input to handoff. It is written in the project's locked vocabulary. It describes what happens and who does it. It does not specify the interaction surface, since that is not decided.

The shape across the whole process: the front of each module is light reaction and momentum, where the system does the visible work and the inventor mostly judges it. The one demanding moment, the inventor stating in their own words what is genuinely new, sits in Module 4, where it is earned, not at the start where it would drive people off.

---

## Overview

Patent Geyser takes an inventor from a raw idea to an Invention Disclosure they can bring to a registered patent practitioner. It specializes in software, SaaS, and blockchain inventions. The inventor talks only to the Helper. The Helper does the heavy lifting and shows its work; the inventor reacts, keep this, drop that, fix a word, and occasionally supplies the one inventive line only they have. Specialized agents sit behind the Helper and the inventor never addresses them directly.

The product does not produce a filing. Its output is an Invention Disclosure plus a proof package, handed to a practitioner who handles filing.

---

## Two systems that run across every stage

### The Ledger

Every time the inventor says something in their own words, it is saved to the Ledger verbatim and timestamped, in the background. Each save is keyed by project, source, and reference, carries optional Concept scope and tags, and writes a hashed, chained provenance event alongside it. The inventor never stops to confirm ownership. The evidence trail builds itself out of normal conversation, and ownership is a running tally the system keeps, not a task the inventor performs.

### The Boundary

Every agent output passes the Boundary before the inventor sees it. Output that restates or organizes the inventor's own material may surface. Output that would be a genuinely new inventive idea is withheld and handed back to the inventor instead. The Helper never authors the invention. That is the inventor's job, and proving it is the point of the product.

A practical rule that falls out of the Boundary: when the inventor edits any upstream stage, everything downstream that was built on the old version is cleared and must be rebuilt. Nothing inventive survives downstream on stale upstream input.

---

## Module 0 — The Helper

The Helper is not a sequential stage. It runs across all five modules as the conductor. It is listed as a module because it has its own defined role, not because it occupies a position in the sequence.

**The single surface.** The inventor talks only to the Helper. The specialized agents, the ones that read, restate, split, deepen, critique, formalize, search, and broaden, sit behind it. The inventor never addresses them directly and never sees them run.

**What it does each turn.** The Helper decides which agent to run and when, reads what comes back, passes it through the Boundary, and surfaces what is allowed while withholding what is not. It writes the inventor's verbatim words to the Ledger as they come. It asks for clarity when something is genuinely missing, and it leads the inventor forward through the process. The inventor mostly reacts to what the Helper puts in front of them; the Helper does the visible work.

**The lead-decision split.** "The Helper leads" means different things for different kinds of decisions, and the difference is load-bearing. Building the Helper without this split is how conception quietly leaks to the machine.

1. Orchestration decisions: the Helper leads outright. Which agent to call, when to retry, when it has enough to proceed, when to ask the inventor, how to sequence. These are the Helper's to make, and they are recorded as machine actions.
2. Curation decisions: the Helper recommends, the inventor decides. Which pieces are real, what to keep, drop, or merge, which Concepts to carry forward. The Helper can hold a strong opinion and say why, but the inventor's choice is what gets recorded.
3. Conception decisions: the inventor only. The inventive idea, the novel mechanism, the differentiation against prior art. The Helper is structurally forbidden from authoring these, and the Boundary is what enforces it.

The failure mode to design against: a Helper that leads conception, proposing the inventive move and letting the inventor rubber-stamp it. A rubber-stamp is not conception, and an approval click is not a gate. The Helper leads orchestration, recommends on curation, and never conceives.

---

## Module 1 — Conception

**Input.** The raw material the inventor arrives with, in any form: a sentence, a long description, notes, or source code. It need not be complete.

**Goal.** Turn that into a set of distinct, individually owned Concepts, with the heavy work hidden so the start feels light and quick.

**Stages.**

1. Capture. The raw input is saved to the Ledger exactly as given, timestamped, before anything runs against it. This is silent and costs the inventor nothing. It is the baseline every later step traces back to.
2. Read and sort. The system reads the input and does the work the inventor would otherwise have to do: it restates the idea cleanly, separates it into distinct pieces, and notes which pieces look strong and which look thin. This is the system earning trust by doing the lifting first.
3. Boundary screen. Before any of that reaches the inventor, it is screened. Restatement and organization of the inventor's own material passes through. Anything that would be a genuinely new inventive idea is held back, never shown as the system's own answer. This runs invisibly.
4. React and shape. The inventor is shown the sorted pieces and reacts, one light judgment at a time: this stays, this goes, these two are really one. The feel is watching a messy idea get organized, not filling out a form. Each reaction is captured. No authoring is asked here.
5. Spark, only where forced and only after momentum. If a piece genuinely cannot stand without something the inventor never said, the system asks for that one thing, in a single sharp prompt, framed as the part only they know. This is rare. On a detailed input it may not fire at all in the first pass. It never opens the module.
6. Tidy and tag. Each surviving piece is cleaned into a clear statement built only from the inventor's words. Provenance is tagged in the background: inventor_conceived, system_formalized, or system_suggested_accepted. A piece thin on the inventor's own input is not blocked; it is marked quietly for a later module to firm up.
7. Finalize. When the set is distinct and stable, it is checkpointed to the Ledger, hashed and timestamped.

**Output.** A set of distinct Concepts, each owned, each with its verbatim trail and provenance tags, each standing alone. The splitting into separate ideas has already happened here, so nothing downstream needs to extract ideas again.

---

## Module 2 — Maturation

**Input.** The distinct owned Concepts. Some are full, some are a single line.

**Goal.** Bring each Concept up to the point where it can actually be searched, and let the inventor choose which to carry forward. A one-line Concept cannot be searched usefully, so this module makes each one concrete first.

**Stages.** Each Concept runs through this on its own.

1. Re-ground. The Concept's original raw words are reloaded from the Ledger, so the deepening builds from what the inventor actually said, not from text the system generated earlier. This prevents errors from compounding on top of AI output.
2. Deepen. The Concept is elaborated into what it does, how it works, and what is specific about it. This is drawing out detail already implied in the inventor's material, not adding invention.
3. Boundary screen. The deepening is screened the same way. Elaboration of the inventor's material is kept and tagged system_formalized. Anything that would amount to a genuinely new inventive detail is held back, and the system asks the inventor for that piece in their own words rather than writing it in.
4. Search-readiness check. Each Concept is measured against one question: is it concrete enough that a search would return useful results, or is it still an abstraction that would only return noise. Where it falls short, the system asks the inventor for the missing specificity, the mechanism, the concrete terms, the particular behavior, and captures the answer verbatim. A Concept cannot leave this module until it passes this check. This is the precondition the next module depends on.
5. Choose what to carry. The inventor picks which matured Concepts go to search. This is reaction, not authoring: some are weak on reflection, some overlap, some they do not wish to pursue. Each choice is recorded. Set-aside Concepts are kept in reserve, not deleted.
6. Checkpoint. The matured, selected set is checkpointed to the Ledger.

**Output.** A selected set of Concepts, each concrete enough to search, each still owned, each carrying its deepened statement and trail. Unselected Concepts are held in reserve.

---

## Module 3 — Landscape

**Input.** The selected, search-ready owned Concepts.

**Goal.** Show the inventor, per Concept, the closest existing art and whether they sit in crowded or open territory. Facts only.

**Stages.**

1. Search per Concept. Each selected Concept is sent out to be searched as its own query. Concepts are searched separately, not bundled, because a combined query returns material relevant to none of them cleanly. There are two search modes: a quick single-Concept search and a multi-Concept search across the selected set.
2. Return grouped. Results come back grouped under the Concept that produced them, each carrying a score for how close the existing art is.
3. Orient. The inventor is walked through each Concept's landscape: the closest existing art, where the Concept sits crowded, where it sits in open space. This is read-only. The inventor takes in the terrain, not acting yet, and is not asked to produce anything.
4. Boundary stays silent. The system shows the facts and withholds the conclusion. It does not tell the inventor what is novel or where their edge is. That judgment is conception and belongs to the inventor in the next module.
5. Checkpoint. The returned landscape is written to the Ledger, fixing the art known at this moment before any conclusion is drawn from it.

**Output.** Each carried Concept paired with its closest art and a crowded-or-open read.

The search itself, the data sources it draws on, the query construction, and how the closeness score is computed run in an external workflow, not in the application. This document specifies what the module takes in and hands back, not the search internals.

---

## Module 4 — Differentiation

**Input.** Each Concept paired with its prior art landscape.

**Goal.** The inventor articulates what is genuinely new about each Concept against the art; those become the Key Concepts; the disclosure is compiled; and inventorship is certified. This is the second conception moment, and it differs from Module 1. Module 1 captured the idea as conceived. Module 4 captures novelty as conceived against known art. The product needs both.

This is where the one genuinely heavy moment of the whole product lives, and it lives here on purpose. The inventor now has momentum, context, and a real reason to care, so being asked to say what is new lands as the meaningful part, not as opening homework.

**Stages.** Each Concept runs through this on its own.

1. Frame the gap. The system lays out plainly what the art already covers and pulls the mechanism out of the Concept, then surfaces the specific points where the inventor's input is needed. It teaches up to the edge and stops. This stage is deliberately factual; it raises questions, it does not assert strategy or novelty for the inventor.
2. The inventor's call on novelty. The inventor states what their Concept does that the art does not, in their own words. The system does not supply this; it is the inventor's to make. It is accepted when it carries real specifics, the mechanism and how it works, not a bare assertion that it is new. This is the highest-value capture in the product, and it is earned by everything before it. Captured verbatim.
3. Formalize and confirm. The inventor's statement is cleaned into clear differentiation text the inventor approves, tagged as formalized over their own words.
4. Anchor selection. The system generates anchor options, and the inventor picks which differentiated Concepts anchor the disclosure. Each is checked so it is not narrower than it needs to be. These anchors are the Key Concepts. They are Key Concepts, never claims, and the output is a disclosure, never an application.
5. Compile. The owned, differentiated Concepts are compiled into the Invention Disclosure draft. The draft is a full multi-section document: title, background, summary, abstract, architecture, data structures, operations, alternatives, and ramifications.
6. Certify inventorship. Per Concept, the conception record is completed across three factors: who conceived it, the quality of the contribution beyond AI assistance, and how it exceeds what was already known. Because capture has been ambient since Module 1, most of this is assembled from what the inventor already said, so it reads as confirming, not writing. Only genuinely uncovered factors get a fresh ask. Each certification is signed into the Ledger.

**Output.** A differentiated Invention Disclosure draft with signed per-Concept inventorship certifications.

---

## Module 5 — Showcase

**Input.** The differentiated Invention Disclosure draft and its certifications.

**Goal.** Make the draft complete and presentable, optionally broaden it without breaking the lock, and export it with proof.

**Stages.**

1. Figures. A figure plan is generated from the disclosure and the Key Concepts and rendered to images. The inventor reviews and approves. A single figure can be regenerated on its own without redoing the others. This is reaction, not authoring.
2. Broadening, optional, gated. The disclosure can be widened across architectural variations so the mechanism is covered across how it could be built, present and near-future. The pipeline extracts the underlying mechanism in variation-neutral terms, synthesizes the architectural variations, then fans out the widened pieces (the broadened Key Concepts, a hardware optimization angle, and background and summary extensions) and a rewritten abstract. It runs behind two approval gates: first which variations to keep, then each widened piece before it is applied. The Boundary guards both gates, because widening is exactly where the system is most tempted to invent. Anything genuinely new goes back to the inventor rather than being written in.
3. Export. The inventor downloads the Invention Disclosure as PDF or DOCX together with a self-verifying proof package built from the Ledger, framed as ready to bring to a registered patent practitioner.

**Output.** A complete Invention Disclosure plus its proof package.

---

## Handoff — Practitioner

An optional match connects the inventor with a registered patent practitioner for filing review or representation. Every path ends here. The product produces the disclosure and the proof; the practitioner handles filing. This match runs in an external workflow.

---

## Canonical names

These tend to get pasted and then outlive the decision, so they are listed once here. Change a term here and keep the rest consistent around it.

- **Concept** — one individually owned idea. The unit every module operates on.
- **Helper** — the single assistant the inventor talks to.
- **Ledger** — the per-project verbatim record, with a hashed, chained provenance event per entry.
- **Boundary** — the screen that withholds inventive agent output from the inventor and routes it back as a request.
- **Key Concept** — an anchor of the disclosure. Never "claim."
- **Invention Disclosure** — the product's output. Never "application," never "filing-ready."
- Provenance tags: **inventor_conceived**, **system_formalized**, **system_suggested_accepted**.
- Gates: **search_readiness** (Module 2), and the two broadening gates in Module 5 (variation approval, then artifact approval).

Module names: **The Helper** (Module 0, the conductor across all stages), **Conception**, **Maturation**, **Landscape**, **Differentiation**, **Showcase**.

No interaction surface and no individual agent names are fixed in this document, since neither is decided.

---

## Implementation notes

This separates what is reflected from the current codebase from what is new direction, so the spec is not mistaken for a description of what already runs.

Grounded in the current code: the Ledger as a verbatim human-input store with a hash-chained provenance event per save; the upstream-edit-clears-downstream rule; prior art running as an external search with a quick single-Concept mode and a multi-Concept mode; the Differentiation factual-question stage and the three-factor inventorship certification; the disclosure assembled from the nine sections listed; figures rendered with per-figure regeneration; and the optional broadening running as a multi-stage pipeline behind two approval gates.

New direction, not yet structural in the code: the Boundary as a single enforced screen every agent output must pass, rather than per-prompt instructions; the Maturation search-readiness check as a hard gate; and the lightness ordering, where the front of each module is reaction and the one heavy authoring moment is deferred to Module 4.
