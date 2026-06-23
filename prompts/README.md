# Agent prompts

System prompts for the AI sub-agents the app calls — **one `.md` file per
agent**, kept as standalone Markdown so they can be read, diffed, and edited
without touching application code.

## Organization

Prompts are grouped **per module**, and within each module **numbered by order
of usage**. This keeps things from becoming a flat mess as more modules land.

```
prompts/
  module-1-conception/
    01-distiller.md           cut raw input down to its core conception (no new substance)
    02-decomposer.md          split the core into discrete candidate concepts
    03-examiner.md            diagnose weaknesses and risks
    04-clarifier.md           ask questions where genuinely unclear
    05-boundary-classifier.md gate: factual/clarifying (surface) vs inventive (withhold)
    06-formalizer.md          rewrite verbatim into clean concept text
    07-code-generator.md      representative code, after the inventor approves the core
  module-2-expansion/
    01-expander.md            flesh each concept into a fuller technical description
    02-boundary-classifier.md gate: routine elaboration (surface) vs new invention (withhold)
    03-recommender.md         recommend which concepts to carry forward
  module-3-landscape/         (future)
  module-4-differentiation/   (future)
  module-5-showcase/          (future)
```

## Conventions

- **Folder per module:** `module-<n>-<stage>/`.
- **Numeric prefix = order of usage** within that module (`01-`, `02-`, …).
- Each file is the **full system prompt** for a single agent. Application code
  loads the file's contents and passes it as the system message when calling
  that agent.

Module 1's loader maps each agent to its file in
[lib/modules/conception/agents.ts](../lib/modules/conception/agents.ts).
