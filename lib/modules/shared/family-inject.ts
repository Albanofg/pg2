import "server-only";
import { resolveAgentFamilyBlock } from "@/lib/families/helper-context";

/**
 * Append the `## FAMILY KNOWLEDGE` block to a working agent's system prompt, when
 * the project is in a family and something relevant is embedded. The Helper is
 * skipped here — it fetches its own family context inside `runHelper`. Best-effort:
 * any failure returns the original system unchanged (never breaks a turn).
 *
 * The query is the agent's `subject` (the concept/section under work) when set, else
 * its prompt; capped so an oversized drafting prompt still embeds cleanly.
 */
const QUERY_CAP = 2000;

export async function familyAugmentedSystem(
  agent: string,
  system: string,
  query: string,
): Promise<string> {
  if (agent === "helper") return system;
  try {
    const block = await resolveAgentFamilyBlock(query.slice(0, QUERY_CAP));
    return block ? `${system}\n\n${block}` : system;
  } catch {
    return system;
  }
}
