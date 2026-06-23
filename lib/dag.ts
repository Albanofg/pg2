/**
 * The canonical Shared Consciousness DAG.
 *
 * Each node depends on its parents. Disavowing a node recursively invalidates
 * the node and everything downstream of it, and reverts the Helper to the
 * earliest invalidated phase.
 *
 *   core_novelty → tech_arch → detailed_impl → broadening
 *        └───────────────→ background
 *
 * Section nodes (background, claims) hang off phases so the Live Draft can show
 * a patent-shaped document while the phase machine stays linear.
 */
export const NODE_GRAPH: Record<
  string,
  { label: string; parents: string[]; phase: string }
> = {
  core_novelty: { label: "Core Novelty", parents: [], phase: "core_novelty" },
  background: {
    label: "Background",
    parents: ["core_novelty"],
    phase: "core_novelty",
  },
  tech_arch: {
    label: "Technical Architecture",
    parents: ["core_novelty"],
    phase: "tech_arch",
  },
  detailed_impl: {
    label: "Detailed Implementation",
    parents: ["tech_arch"],
    phase: "detailed_impl",
  },
  broadening: {
    label: "Claims & Broadening",
    parents: ["detailed_impl"],
    phase: "broadening",
  },
};

export const NODE_ORDER = [
  "core_novelty",
  "background",
  "tech_arch",
  "detailed_impl",
  "broadening",
] as const;

/** All nodes reachable downstream of `start` (inclusive), via parent edges. */
export function descendantsOf(start: string): string[] {
  const result = new Set<string>([start]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, def] of Object.entries(NODE_GRAPH)) {
      if (result.has(key)) continue;
      if (def.parents.some((p) => result.has(p))) {
        result.add(key);
        changed = true;
      }
    }
  }
  return [...result];
}

/** Earliest phase among a set of node keys, used to rewind the Helper. */
export function earliestPhase(nodeKeys: string[]): string {
  for (const key of NODE_ORDER) {
    if (nodeKeys.includes(key)) return NODE_GRAPH[key].phase;
  }
  return "core_novelty";
}
