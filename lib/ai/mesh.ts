import "server-only";
import { runDrafter } from "./drafter-agent";
import { runVerifier } from "./verifier-agent";
import { socraticFallback, chooseStrategy } from "./helper-agent";
import { saveDraft } from "@/lib/db/shared-consciousness";
import { NODE_GRAPH } from "@/lib/dag";

export type MeshEmit = (event: {
  type: "mesh" | "node" | "gap";
  value: any;
}) => void;

export type MeshOutcome =
  | { kind: "verified"; nodeKey: string; draft: string }
  | { kind: "gap"; nodeKey: string; gap: string; question: string };

/**
 * The Creation Loop for a single node:
 *   Drafter -> Verifier, up to 3 attempts. On GapDetected (or 3 rejections),
 *   the Helper produces a Socratic fallback question instead of inventing.
 * Emits live status so the UI can render the "agents working" terminal log.
 */
export async function runMeshForNode(opts: {
  projectId: string;
  nodeKey: string;
  phase: string;
  humanInputs: string[];
  priorSections?: string;
  contextSummary?: string;
  emit: MeshEmit;
}): Promise<MeshOutcome> {
  const { projectId, nodeKey, phase, humanInputs, priorSections, contextSummary, emit } =
    opts;
  const label = NODE_GRAPH[nodeKey]?.label ?? nodeKey;

  const MAX_ATTEMPTS = 3;
  let lastGap = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    emit({ type: "mesh", value: `Drafter drafting ${label}… [attempt ${attempt}]` });
    const drafted = await runDrafter({ nodeKey, phase, humanInputs, priorSections });

    if (drafted.status === "gap_detected") {
      lastGap = drafted.gap;
      emit({ type: "mesh", value: `Gap detected: ${drafted.gap}` });
      break;
    }

    emit({ type: "mesh", value: `Verifier cross-checking against Backpack…` });
    const verdict = await runVerifier({ draft: drafted.draft, humanInputs });

    if (verdict.approved) {
      emit({ type: "mesh", value: `Verifier approved ${label} ✓` });
      await saveDraft(projectId, nodeKey, drafted.draft, true);
      emit({
        type: "node",
        value: { nodeKey, draftOutput: drafted.draft, isVerified: true },
      });
      return { kind: "verified", nodeKey, draft: drafted.draft };
    }

    lastGap = verdict.reason;
    emit({
      type: "mesh",
      value: `Conflict detected: ${verdict.reason}. Drafter retrying…`,
    });
    // Surface the unverified attempt so the Right Sidebar shows progress.
    await saveDraft(projectId, nodeKey, drafted.draft, false);
    emit({
      type: "node",
      value: { nodeKey, draftOutput: drafted.draft, isVerified: false },
    });
  }

  // Exhausted attempts or explicit gap -> hand back to the Helper.
  emit({ type: "mesh", value: `Helper engaging Socratic fallback…` });
  const strategy = chooseStrategy(0);
  const question = await socraticFallback({
    phase,
    gap: lastGap || `Unable to complete ${label} without inventing.`,
    strategy,
    contextSummary,
  });
  emit({ type: "gap", value: { nodeKey, gap: lastGap, question } });
  return { kind: "gap", nodeKey, gap: lastGap, question };
}
