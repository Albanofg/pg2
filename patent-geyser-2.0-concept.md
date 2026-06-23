# Patent Geyser 2.0 — Core Concept

> Replacement for Patent Geyser 1.0. A mesh where the human talks only to the Helper, and a small set of agents feed and are fed by two shared layers (Backpack + Shared Consciousness) to generate a provisional, guaranteeing the invention is 100% human.

---

## Core principles (non-negotiable)

1. **The human communicates only with the Helper.** They have no way to input to the other agents except through the Helper.
2. **No agent can invent.** Neither the agents nor the Helper ever tell the human "your invention is this." Whatever makes the patent unique has to come from the human.
3. **The Backpack has to be bulletproof.** It works for every software patent that exists and will ever exist, with no flaws.
4. **Fewer agents than the current app.** Each agent owns a piece of the draft, not everyone does everything.
5. **Agents check each other.** What one agent creates, another reviews. It is an extra layer of quality and safety: no part of the draft passes without being verified by an agent other than the one that created it.

---

## Architecture

### Helper (sole point of human contact)
- Intermediary between the human and the rest of the agents.
- Asks each agent to create its piece. Nothing is created unless the Helper asked for it.
- The human sees which agent is working and how, but does not talk to it directly.
- **Super strict routing.** Which agent each question or response goes to is determined by the **part of the process** the user is in at that moment. No shortcuts: the phase rules.

### Agents
- Small set. Each one responsible for a part of the draft.
- They only act when the Helper asks them to.
- To create anything, each agent consults **two places**: the Backpack and the Shared Consciousness.

### Backpack
- **Absolutely everything** needed to create a patent: how the text has to be, what kinds of text are needed, what component each text needs, and everything else.
- How to create the title, the abstract, the background, the "claims" (which will not be called claims), and absolutely everything required.
- Includes the broadening rules: how broad each thing has to be.
- Hyper specific, universal for software, bulletproof.

### Shared Consciousness
- Records the **what, how, when, and why** of everything that was created.
- Each agent writes the piece it was assigned here, and it stays available for everyone to read.
- It is the living memory of the draft: why each decision is the way it is.
- **Consistency (must):** once a step has been declared finished or perfect, a later step cannot contradict it. What cannot happen (as it does in 1.0 today): the genus and species broadening generates an abstract, calls it perfect, and then in the final polish the AI recommends redoing that same abstract.

### Mesh
- The app is a mesh where Backpack + Shared Consciousness + agents + Helper feed each other constantly to produce the provisional.

---

## Creation loop (how an agent builds its part)

1. The Helper asks an agent to create X.
2. The agent goes to the **Backpack** (how X is done correctly).
3. The agent goes to the **Shared Consciousness** (what has already been decided, why, what the others wrote).
4. The agent creates its piece and writes it into the Shared Consciousness.
5. **Cross-verification:** another agent reviews it against the Backpack and the Shared Consciousness. It is a back and forth until the agents agree that what was created, and the response the human will get, is the **most obvious and useful possible**. Nothing passes without that agreement.
6. It becomes readable by everyone.

> Cross-verification separates the one that creates from the one that validates. It is not just a compliance check: it is agreeing that the response to the human is the best one that can be given.

---

## Inventorship guarantee (the heart of the system)

Applies to the consumer / inventor version. We need to be 100% sure the invention is 100% the user's and 100% human.

- What gets created in the Shared Consciousness **is not the invention**: it is an **unresolved question / an open point**. Something the AI detects as a possible invention (it may be the patent's big invention or not) and that the human has not said yet.
- The AI can **never, ever** reveal that invention to the human. If it did, the invention would belong to the AI and not the human, and that is exactly what we do not want.
- From that open point, the Helper (with the other agents as support) uses the **Socratic method** to help the human arrive at the invention themselves, or at a different one they consider better.
- The human is **always** the one who puts the invention into play in the app.
- **The invention is marked as 100% human.** There is no score or gradient: it is binary, either it is 100% human or it is not.
- Failure mode (if the human does not get there): to be defined. It has to be something that **helps** them get there, not something that makes their life impossible.

### Proof of human conception (inventor's notebook)
- Everything the human says during the process is recorded in a specific place.
- In the end that is a file the human has to attest that they invented it: their inventor's notebook.
- Sealed with **RFC 3161** timestamps. It is a must.

---

## Real-time draft view + human correction

- A section in the app where the user sees almost in real time **how the draft is being generated**.
- Example: the title is already there, then the background is generated; once the user has moved past the background, they can click and see **how** that background was generated.
- As the human reads the current draft, they may run into something they do not agree with at all or that they believe they never said or invented. There they can disavow it: "that wasn't me, that idea isn't mine, take it out of here, that's not my software." There can be many different cases.
- **Corrections propagate downward.** If the patent's novelty changes, you cannot keep the same key concepts when the idea is now different. Everything that depended on it gets redone.

---

## Stack and scope

- **Stack:** Neon, Next.js, TypeScript.
- **N8N:** light use and only for prior art (the workflow is already built). Nothing beyond that.
- **Tier order:** we start with the consumer / inventor version. Then the professional one.
- **The inventorship guarantee applies only to the consumer tier.** The professional one is handled by someone who knows how to draft a patent and write claims, and does not need to prove the AI did not do it.

---

## What comes next (to be defined when we start building)

- **Agent roles and count.** This is a blueprint. The agents get defined once the concept is approved.
- **How the AI responds at each step.** It presents responses in various ways depending on what the action needs: boxes, text, chat, multiple formats. Each step can have its own format.
- **How user responses are presented and accepted.** *Present* = the format is decided by the action (free text, buttons, approve/reject card, chat). *Accept* = the system captures the response and routes it according to the phase of the process, with strict routing (see Helper).
- **The complete set of flow questions.** The full list of everything the Helper will ask the human end to end, from capturing the idea to the final draft. Every Socratic prompt, every clarification, every approval. It is the script / decision tree of the entire conversation.

> These pieces are what gets defined once we start the build.
