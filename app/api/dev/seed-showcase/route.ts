import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createProject } from "@/lib/db/projects";
import { saveShowcase, seedShowcase } from "@/lib/modules/showcase/registry";
import type { DisclosureSection, ShowcaseKeyConcept } from "@/lib/modules/showcase/types";

/**
 * DEV-ONLY seed: creates a fresh project sitting at the Showcase "broaden or skip"
 * choice card, seeded with a test invention chosen to produce sharp candidate
 * cards (a distinctive mechanism that maps onto many established patterns across
 * fields) and verbatim that contains liftable criterion fragments. Open the
 * project ("TEST — Layer 4/5 flow") from the dashboard; bootstrap resumes it at
 * Showcase. Click Broaden to exercise the flag-on flow. Blocked in production.
 */
export const runtime = "nodejs";

const KEY_CONCEPTS: ShowcaseKeyConcept[] = [
  {
    id: "kc-anchor",
    title: "Anchor-first constraint propagation",
    statement:
      "The system begins from a small set of non-negotiable anchor constraints and propagates outward, so every downstream assignment is derived under the anchors and none can violate them.",
    verbatim: [
      "The one thing it must get right is never violating an anchor constraint, no matter what else has to give.",
      "I start from the handful of hard rules that can't move and let everything else be forced by them.",
    ],
  },
  {
    id: "kc-relax",
    title: "Minimal prioritized relaxation on conflict",
    statement:
      "When two assignments conflict, the system relaxes only the single lowest-priority soft constraint rather than recomputing the whole assignment.",
    verbatim: [
      "It has to relax the least it possibly can — recomputing the whole schedule on every conflict is exactly the failure mode I'm avoiding.",
      "On a clash it gives up the weakest soft rule first and leaves everything else where it is.",
    ],
  },
  {
    id: "kc-trace",
    title: "Traceable assignment provenance",
    statement:
      "Each assignment records which constraints forced it, so any later change can be localized to just the assignments those constraints touched.",
    verbatim: [
      "Every slot has to stay traceable to the constraints that forced it, so a change only disturbs what it actually affects.",
    ],
  },
];

const DISCLOSURE: DisclosureSection[] = [
  {
    key: "title",
    label: "Title",
    body: "Constraint-Anchored Assignment with Minimal Prioritized Relaxation",
  },
  {
    key: "background",
    label: "Background",
    body: "Existing assignment and scheduling systems recompute large portions of a solution when any single constraint is violated, which is costly and destabilizes assignments that were not in conflict. They also treat all constraints as interchangeable, so a hard, non-negotiable rule can be traded away as easily as a soft preference.",
  },
  {
    key: "summary",
    label: "Summary",
    body: "The disclosed system derives assignments by propagating outward from a small set of non-negotiable anchor constraints, resolves conflicts by relaxing only the single lowest-priority soft constraint, and records for each assignment the constraints that forced it so that later changes remain localized.",
  },
  {
    key: "abstract",
    label: "Abstract",
    body: "A system assigns interdependent elements under a constraint set by propagating from declared anchor constraints, relaxing the minimal lowest-priority soft constraint on conflict, and retaining per-assignment provenance of the forcing constraints.",
  },
  {
    key: "operations",
    label: "Operations",
    body: "The system ingests a constraint set partitioned into anchors and prioritized soft constraints, propagates assignments outward from the anchors, detects conflicts, relaxes the minimal soft constraint, and records provenance for each assignment.",
  },
];

async function seed() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "dev_only" }, { status: 403 });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized_log_in_first" }, { status: 401 });
  const project = await createProject(user.userId, user.email, "TEST — Layer 4/5 flow");
  const engine = seedShowcase(KEY_CONCEPTS, DISCLOSURE, []);
  await engine.start(); // emits the broaden/skip choice card
  await saveShowcase(project.id, engine);
  return NextResponse.json({
    ok: true,
    projectId: project.id,
    title: project.title,
    next: "Open this project from the dashboard; it resumes on Showcase. Click Broaden.",
  });
}

// GET so you can just visit the URL in the logged-in browser; POST also works.
export async function GET() {
  return seed();
}
export async function POST() {
  return seed();
}
