/**
 * Module 0 — Orientation. Server-side entry point.
 *
 * Import from server code (route handlers). Client components that only render
 * the view should import the pure contracts from
 * "@/lib/modules/orientation/types".
 */

export { OrientationModule } from "./controller";
export { loadOrientation, saveOrientation, resetOrientation } from "./registry";
export { openaiAgentRunner } from "./runner.openai";
export * from "./types";
