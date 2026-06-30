/**
 * Standalone test for the CONCEPTION EVALUATOR's deterministic layer — the
 * conditionality gate's pure scaffolding (deep spec §12 step 2: "the riskiest, most
 * testable part… confirm the conditionality gate fires correctly before building
 * anything visual"). Zero API calls; pure functions only.
 *
 * Run:  npx tsx scripts/test-conception-gate.ts
 * (or compile with the project's tsconfig and run the emitted JS.)
 */

import { selfTestGate } from "../lib/modules/brainstorm/conception-evaluator";

const { passed, failed, results } = selfTestGate();

for (const r of results) {
  const mark = r.pass ? "PASS" : "FAIL";
  console.log(`[${mark}] ${r.expected.padEnd(7)} got=${r.got.padEnd(7)}  "${r.reply}"`);
  if (!r.pass) console.log(`        ↳ ${r.note}`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
