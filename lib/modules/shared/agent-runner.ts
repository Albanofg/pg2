/**
 * The AgentRunner seam — how every module calls a sub-agent.
 *
 * A module supplies the system prompt (loaded from its prompts/*.md), the built
 * user prompt, and a Zod output schema; the Helper performs the actual model
 * call and returns the validated structured object. Modules never own the model
 * transport.
 *
 * `agent` is a free string (each module names its own agents); the runner maps
 * names to models. Pure — no server-only imports.
 */

import type { TypeOf, ZodTypeAny } from "zod";

export type AgentRunRequest<S extends ZodTypeAny> = {
  /** The sub-agent's name (module-specific, e.g. "expander"). */
  agent: string;
  system: string;
  prompt: string;
  /** Zod schema; the runner validates against it and returns its inferred type. */
  schema: S;
  /** Optional sampling hint; the runner may ignore it. */
  temperature?: number;
  /** Optional retrieval query — the subject under analysis/drafting (concept title,
   *  statement, section name). Used to fetch the most relevant family knowledge; the
   *  runner falls back to `prompt` when unset. */
  subject?: string;
};

export type AgentRunner = <S extends ZodTypeAny>(
  req: AgentRunRequest<S>,
) => Promise<TypeOf<S>>;
