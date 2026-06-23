/**
 * Module 3 — Landscape. Server-side entry point. Import from server code only.
 * Client components import contracts from "@/lib/modules/landscape/types".
 */

export { LandscapeModule, type LandscapeSnapshot } from "./controller";
export {
  loadLandscape,
  saveLandscape,
  seedLandscape,
  clearLandscape,
} from "./registry";
export { n8nPriorArtSearch } from "./search.n8n";
export * from "./types";
