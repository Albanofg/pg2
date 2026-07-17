import { NextResponse } from "next/server";
import { seedShowcase } from "@/lib/modules/showcase/registry";
import type { DisclosureSection, ShowcaseKeyConcept } from "@/lib/modules/showcase/types";

/**
 * DEV-ONLY headless driver: runs the whole Genus & Species flow end-to-end with the
 * REAL agents, auto-answering every card, and returns a full trace. No auth, no DB —
 * an in-memory engine. This exists to catch runtime failures BEFORE a human hits them
 * (typechecking a flow is not the same as running it). Blocked in production.
 *
 *   GET /api/dev/drive-genus-species
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const KEY_CONCEPTS: ShowcaseKeyConcept[] = [
  {
    id: "kc-1",
    title: "Single recurring approval flow focus",
    statement:
      "Unlike existing art that handles workflow failures, recovers from known errors, or pauses workflows to correct them, my system focuses on a single recurring approval flow and uses one rule to silently change only the very next screen, task, or approval path after one named repeated error.",
    verbatim: [
      "The one rule fires only after a named repeated error, and it changes only the very next screen, task, or approval path.",
      "I focus on one recurring approval flow, not the whole workflow.",
    ],
  },
  {
    id: "kc-2",
    title: "Workflow selection criteria based on costly recurring mistakes",
    statement:
      "Unlike existing art that pauses a running workflow to fix errors, my system first selects one repeatable workflow where recurring mistakes cause visible loss or delay, and then silently changes only the very next screen, task, or approval path after a repeated preventable error.",
    verbatim: [
      "I pick the workflow where the recurring mistakes actually cause visible loss or delay before anything else happens.",
    ],
  },
  {
    id: "kc-3",
    title: "Silent prevention by changing only the next step",
    statement:
      "Unlike existing art that fixes the error or pauses the workflow to repair it, my system silently substitutes the flow by changing only the immediately following step in a recurring approval flow, and it does this without warning the user.",
    verbatim: [
      "It silently substitutes the flow by changing only the immediately following step, and it does this without warning the user.",
      "The rest of the process is left exactly as it was.",
    ],
  },
];

const DISCLOSURE: DisclosureSection[] = [
  { key: "title", label: "Title", body: "Localized Successor Substitution in Recurring Approval Flows" },
  {
    key: "background",
    label: "Background",
    body: "Existing workflow systems pause a running process to repair a detected error, retry the failed step, or require a redesign of the workflow. They treat every error the same and disturb steps that were not in conflict.",
  },
  {
    key: "summary",
    label: "Summary",
    body: "The disclosed system selects a recurring approval flow in which repeated preventable errors cause visible loss, and on a named recurring error silently substitutes only the immediately succeeding step, leaving the remainder of the process unchanged.",
  },
  {
    key: "abstract",
    label: "Abstract",
    body: "A system detects a named recurring error in a repeatable approval process and applies a single conditional substitution rule that replaces only the immediately succeeding element with an alternative continuation, without pausing or redesigning the process.",
  },
  {
    key: "operations",
    label: "Operations",
    body: "The system ingests a repeatable process, a named recurring error, and a representation of the immediately succeeding element; on the named error it applies one substitution rule and emits the same process with exactly one next element changed.",
  },
];

type Step = { card: string; action: string; ok: boolean; note?: string };

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "dev_only" }, { status: 403 });
  }
  const t0 = Date.now();
  const trace: Step[] = [];
  const errors: string[] = [];
  const engine = seedShowcase(KEY_CONCEPTS, DISCLOSURE, []);

  try {
    let view = await engine.expand();
    for (let i = 0; i < 40; i++) {
      const snap = engine.toSnapshot();
      if (snap.broadened) break;
      // The first card the UI would actually show.
      const card = view.cards.find((c) => c.type !== "choice");
      if (!card) {
        trace.push({ card: "(none)", action: "STOP — no card and not broadened", ok: false });
        errors.push("DEAD END: no card on screen and the stage is not complete (blank page).");
        break;
      }
      const t = card.type;
      let input: unknown = null;
      if (t === "genus_review") input = { action: "keep" };
      else if (t === "constraint_review") input = { action: "confirm" };
      else if (t === "forest") {
        const c = card as { trees: { id: string; status: string }[] };
        const pending = c.trees.find((x) => x.status === "pending");
        if (pending) {
          // Claim the first, cover the rest — exercises both paths.
          input =
            c.trees.filter((x) => x.status === "claimed").length === 0
              ? { action: "claim", treeId: pending.id, detail: "This is the version I'd actually ship, because our approvals run server-side nightly." }
              : { action: "keep", treeId: pending.id };
        } else {
          input = { action: "finalize" };
        }
      } else if (t === "expansion_review") input = { action: "finalize" };
      else if (t === "candidate_sweep") input = { action: "finalize" };
      else if (t === "delta_review") input = { action: "confirm" };
      else if (t === "kc_hygiene") {
        const c = card as { duplicates: { pairId: string }[]; flags: { flagId: string }[] };
        input = c.duplicates[0]
          ? { action: "keep_both", pairId: c.duplicates[0].pairId }
          : { action: "keep_flag", flagId: c.flags[0]?.flagId };
      } else {
        trace.push({ card: t, action: "UNHANDLED card type — would render blank", ok: false });
        errors.push(`UNHANDLED: card type "${t}" has no driver path (possible blank page).`);
        break;
      }
      trace.push({ card: t, action: JSON.stringify(input), ok: true });
      view = await engine.act(card.id, input as never);
    }
  } catch (err) {
    errors.push(`THREW: ${err instanceof Error ? `${err.message}\n${err.stack}` : String(err)}`);
  }

  const snap = engine.toSnapshot();
  const kcs = snap.keyConcepts ?? [];
  return NextResponse.json({
    ok: errors.length === 0,
    seconds: Math.round((Date.now() - t0) / 1000),
    errors,
    trace,
    result: {
      broadened: snap.broadened,
      genus: snap.genus ? { name: snap.genus.genus_name, anchors: snap.genus.anchors ?? [] } : null,
      confirmedConstraints: snap.confirmedConstraints ?? [],
      trees: (snap.candidates ?? []).map((c) => ({
        label: c.label,
        origin: c.origin,
        decision: c.decision,
        humanDetail: c.humanDetail,
      })),
      keyConcepts: kcs.map((k) => ({ title: k.title, statement: k.statement.slice(0, 160) })),
      sections: (snap.disclosure ?? []).map((s) => ({ key: s.key, chars: s.body.length })),
    },
  });
}
