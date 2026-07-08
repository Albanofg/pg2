import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request AI-usage attribution, carried without threading params through every
 * agent. A route sets `{ projectId, userId, email, stage }`; each runner nests
 * `{ agentCode }` for the specific call. The funnel (`gen.ts` → `recordUsage`) reads
 * the nearest store when it logs a model call.
 */
export type UsageContext = {
  projectId?: string;
  userId?: string;
  email?: string;
  /** brainstorm | conception | maturation | landscape | differentiation | showcase */
  stage?: string;
  /** "<module>/<agent>", e.g. "showcase/figure-planner". */
  agentCode?: string;
};

const storage = new AsyncLocalStorage<UsageContext>();

/**
 * Run `fn` with usage-attribution context. Nested calls INHERIT the parent context
 * and override with `ctx` (so a runner can add `agentCode` without losing the
 * route's `projectId`/`stage`). Each concurrent call gets its own store, so parallel
 * agents don't race on `agentCode`.
 */
export function withUsageContext<T>(ctx: UsageContext, fn: () => Promise<T>): Promise<T> {
  const parent = storage.getStore();
  return storage.run({ ...(parent ?? {}), ...ctx }, fn);
}

export function getUsageContext(): UsageContext | undefined {
  return storage.getStore();
}
