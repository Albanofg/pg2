import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes with conflict resolution. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Stable, human-readable label for each phase key. */
export const PHASES = [
  { key: "core_novelty", index: 1, label: "Core Novelty" },
  { key: "tech_arch", index: 2, label: "Technical Architecture" },
  { key: "detailed_impl", index: 3, label: "Detailed Implementation" },
  { key: "broadening", index: 4, label: "Broadening" },
] as const;

export type PhaseKey = (typeof PHASES)[number]["key"];

export function phaseLabel(key: string): string {
  return PHASES.find((p) => p.key === key)?.label ?? key;
}

export function phaseIndex(key: string): number {
  return PHASES.find((p) => p.key === key)?.index ?? 1;
}
