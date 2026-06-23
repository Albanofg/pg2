# Module 1 — Conception

Builds the inventor's rough idea up into a set of **clean, discrete concept
objects**, while recording a **verbatim trail of the inventor's own words** as
proof of who conceived what. The verbatim trail is the real deliverable.

This module is the **brain** of the stage. It does **not** own the screen, the
conversation surface, the model transport, or the rendering of cards — those
belong to the Helper. Module 1 plugs into the Helper through two seams.

## What this module owns

| Concern | File |
| --- | --- |
| Data contracts: concept objects, ledger, card specs, the `AgentRunner` seam | [types.ts](types.ts) |
| The append-only evidence ledger (verbatim-before-AI guarantee) | [ledger.ts](ledger.ts) |
| The five sub-agents' I/O schemas + prompt loading | [agents.ts](agents.ts) |
| The read→review→acknowledge flow engine | [controller.ts](controller.ts) |
| Sub-agent system prompts (one `.md` per agent) | [`../../../prompts/`](../../../prompts) |
| Optional reference model transport (deletable) | [runner.openai.ts](runner.openai.ts) |

## The two seams the Helper fills

1. **`AgentRunner`** — Module 1 supplies each sub-agent's system prompt (loaded
   from `prompts/<agent>.md`), the built user prompt, and an output schema. The
   Helper performs the actual model call and returns the validated object.
   Module 1 never touches the transport. A reference runner is in
   [runner.openai.ts](runner.openai.ts); swap it for your own (e.g. Claude,
   with retries/telemetry).
2. **Card rendering** — the engine emits card *specs* (`Module1Card`); the
   Helper renders them and sends the inventor's action back. Module 1 never
   renders UI.

## How the Helper drives it

```ts
import { ConceptionModule, openaiAgentRunner } from "@/lib/modules/conception";

const m1 = new ConceptionModule({ runAgent: openaiAgentRunner });

// 1. The inventor submits whatever they have. Captured verbatim FIRST.
let view = await m1.ingest(rawInput);

// 2. The Helper renders view.cards. When the inventor acts on a card:
view = await m1.act(cardId, { action: "approve" });
//      ... request_edit carries the correction verbatim:
view = await m1.act(cardId, { action: "request_edit", correction: "..." });
//      ... a Clarity answer / Leap idea is captured verbatim:
view = await m1.act(clarityCardId, { answer: "..." });
view = await m1.act(leapCardId, { idea: "..." });
//      ... Candidate concepts are kept / dropped / merged:
view = await m1.act(candidateCardId, { action: "merge", into: otherId });

// 3. When the inventor owns and has confirmed every surviving concept:
if (view.complete) {
  const concepts = m1.finish();   // the deliverable
  const proof = m1.ledgerEntries(); // the verbatim trail to persist + (later) seal
}
```

## The cards

- **Review card** (the main interaction) — the Helper's reading / restatement /
  suggested edit of the inventor's **own** material. Actions: Approve / Discard
  / Request edit. Also used to confirm any substance the Formalizer had to add.
- **Clarity card** — one question, only where something is genuinely missing.
  Answer captured verbatim.
- **Leap card** — the **only** path for genuinely new inventive content. Context
  plus a blank box; the inventor writes it in their own words. **Never shows
  AI-written options.**
- **Candidate concept card** — one concept; Keep / Drop / Merge.

## Rules enforced in code (not just prompts)

- **Verbatim before AI.** `ingest` writes the inventor's input to the ledger
  before any agent runs.
- **No AI-conceived substance reaches a card.** Every decomposed concept passes
  the Boundary Classifier; anything `inventive` is withheld and turned into a
  Leap card. When in doubt, the classifier withholds.
- **Formalized text derives only from inventor verbatim.** Additions the
  Formalizer must make are surfaced as confirm-addition cards and tagged
  `ai_suggested_human_accepted` only on explicit approval.
- **Decisions are explicit.** Nothing the AI produced counts until the inventor
  acts; every action is logged.

## Two baked-in choices (per the build brief)

- **Exit bar:** the module finishes as soon as the inventor owns and confirms
  each surviving concept in their own words. It does not stress-test the
  inventive core here (that is a later stage).
- **Pacing:** the engine leads with the reading-back (Review card). Clarity and
  Leap cards appear only where the material is genuinely missing or genuinely
  inventive; clarity questions are capped per round so a simple invention is not
  turned into an interrogation.

## Client vs server imports

- Server code: import from `@/lib/modules/conception` (this pulls `server-only`
  modules).
- Client components rendering cards: import **types only** from
  `@/lib/modules/conception/types`.
