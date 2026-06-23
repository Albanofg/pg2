# Module 2 — Expansion

Takes the clean concepts Module 1 handed off, fleshes each into a **fuller
technical description** (review-and-acknowledge), then helps the inventor pick
which to **carry forward** — handing off a smaller, inventor-owned set ready to
be checked against prior art (Landscape).

Like Module 1, this is the **brain** of the stage only. It does not own the
screen, the conversation surface, the model transport, or card rendering. It
sits on the shared layer ([../shared/](../shared)) and plugs into the Helper
through the same two seams: the `AgentRunner` and card rendering.

## The rule still holds
Routine fleshing-out is the assistant's job; **new invention is always the
inventor's.** Enforced in code: every expanded description passes the Boundary
Classifier (tuned here to separate *routine elaboration* from *new inventive
choice*); anything inventive is withheld and turned into a **Leap card**, the
only path for new inventive content. Nothing is accepted until the inventor
acts.

## What this module owns

| Concern | File |
| --- | --- |
| Data contracts: `ExpandedConcept`, the three cards, the view | [types.ts](types.ts) |
| The three sub-agents' schemas + prompt loading | [agents.ts](agents.ts) |
| The expand→review then recommend→select engine | [controller.ts](controller.ts) |
| Sub-agent prompts (numbered by usage) | [`../../../prompts/module-2-expansion/`](../../../prompts/module-2-expansion) |
| Optional reference model transport (deletable) | [runner.openai.ts](runner.openai.ts) |

Cross-module currency (concept objects, the proof ledger, the agent seam) comes
from [../shared/](../shared).

## How the Helper drives it

```ts
import { ExpansionModule, openaiAgentRunner } from "@/lib/modules/expansion";

// Seed with the concepts Module 1 handed off (and, ideally, the same ledger
// instance so the proof trail stays continuous across modules).
const m2 = new ExpansionModule({ runAgent: openaiAgentRunner, concepts, ledger });

let view = await m2.start();                 // expands each concept, emits review cards
view = await m2.act(cardId, { action: "approve" });
view = await m2.act(cardId, { action: "request_edit", correction: "..." }); // verbatim
view = await m2.act(leapCardId, { idea: "..." });            // new inventive detail, verbatim
view = await m2.act(carryCardId, { choice: "carry_forward" }); // or "set_aside"

if (view.complete) {
  const carried = m2.finish();      // the smaller, expanded, inventor-owned set
  const proof = m2.ledgerEntries(); // the verbatim trail
}
```

## The cards

- **Expansion review card** — one concept's fuller version (original vs.
  expanded), actions Approve / Discard / Request edit. *Discard sets the concept
  aside* (a fast cut); *Request edit* takes the inventor's rewrite verbatim.
- **Leap card** — the only path for new inventive content; context + named
  missing element + a blank box. Never shows AI options. Captured verbatim and
  folded into that concept in the inventor's own words.
- **Carry-forward card** — one expanded concept with the assistant's
  recommendation (carry forward / set aside) and rationale; the inventor
  chooses.

## Two baked-in choices

- **Expansion provenance.** Routine elaboration the AI authored is tagged
  `ai_expanded` and only enters the record once the inventor approves the review
  card. Inventor edits and Leap content are tagged `human_conceived`.
- **Selection comes after expansion.** The engine expands and gathers all review
  decisions (and answers any Leaps) before running the recommender and surfacing
  carry-forward cards — so the inventor decides what to keep against the fully
  fleshed-out versions, not half-formed ones.
