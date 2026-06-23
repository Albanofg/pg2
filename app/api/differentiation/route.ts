import { NextResponse } from "next/server";
import type { ConceptObject } from "@/lib/modules/shared";
import { loadConsciousness } from "@/lib/modules/shared/consciousness-store";
import { loadMaturation } from "@/lib/modules/maturation/registry";
import { loadLandscape } from "@/lib/modules/landscape/registry";
import {
  clearDifferentiation,
  loadDifferentiation,
  saveDifferentiation,
  seedDifferentiation,
} from "@/lib/modules/differentiation/registry";
import type {
  CardActionInput,
  ConceptLandscape,
  Module4View,
} from "@/lib/modules/differentiation/types";

export const runtime = "nodejs";

const EMPTY_VIEW: Module4View = {
  phase: "framing",
  cards: [],
  concepts: [],
  ledger: [],
  complete: false,
};

type Body =
  | { op: "view"; projectId: string }
  | { op: "start"; projectId: string }
  | { op: "act"; projectId: string; cardId: string; input: CardActionInput }
  | { op: "message"; projectId: string; text: string }
  | { op: "reset"; projectId: string };

/**
 * Drives Module 4 (Differentiation). `start` is idempotent: returns the saved
 * session if it has real progress, otherwise seeds from the carried Concepts
 * (Maturation) + their prior-art landscape (Module 3).
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body?.projectId) {
    return NextResponse.json({ error: "projectId_required" }, { status: 400 });
  }

  try {
    switch (body.op) {
      case "view": {
        const engine = await loadDifferentiation(body.projectId);
        return NextResponse.json(engine ? engine.view() : EMPTY_VIEW);
      }
      case "start": {
        const existing = await loadDifferentiation(body.projectId);
        const v = existing?.view();
        const hasProgress =
          !!v &&
          (v.cards.length > 0 ||
            v.complete ||
            v.concepts.some((c) => c.novelty || c.differentiation_statement));
        if (existing && hasProgress) return NextResponse.json(v);

        const [maturation, landscape, consciousness] = await Promise.all([
          loadMaturation(body.projectId),
          loadLandscape(body.projectId),
          loadConsciousness(body.projectId),
        ]);
        if (!maturation || !landscape) {
          return NextResponse.json(
            {
              error: "prior_modules_incomplete",
              detail: "Complete Maturation and Landscape before Differentiation.",
            },
            { status: 409 },
          );
        }

        // Carried Concepts (full objects), using the matured statement as the base.
        const carried = maturation
          .view()
          .concepts.filter((c) => c.decision === "carry_forward");
        const concepts: ConceptObject[] = carried.map((c) => ({
          ...c,
          formalized_statement: c.deepened_statement?.trim()
            ? c.deepened_statement
            : c.formalized_statement,
        }));

        // Their prior-art landscape from Module 3.
        const landscapeByConcept: ConceptLandscape[] = landscape.finish().map((idea) => ({
          conceptId: idea.conceptId,
          territory: idea.territory,
          sources: idea.sources.map((s) => ({
            title: s.title,
            identifier: s.identifier,
            url: s.url,
            snippet: s.snippet,
            closeness: s.closeness,
          })),
        }));

        const engine = seedDifferentiation(
          concepts,
          landscapeByConcept,
          landscape.ledgerEntries(),
          consciousness,
        );
        const view = await engine.start();
        await saveDifferentiation(body.projectId, engine);
        return NextResponse.json(view);
      }
      case "act": {
        const engine = await loadDifferentiation(body.projectId);
        if (!engine) return NextResponse.json(EMPTY_VIEW);
        const view = await engine.act(body.cardId, body.input);
        await saveDifferentiation(body.projectId, engine);
        return NextResponse.json(view);
      }
      case "message": {
        const engine = await loadDifferentiation(body.projectId);
        if (!engine) return NextResponse.json(EMPTY_VIEW);
        const view = await engine.tell(body.text ?? "");
        await saveDifferentiation(body.projectId, engine);
        return NextResponse.json(view);
      }
      case "reset": {
        await clearDifferentiation(body.projectId);
        return NextResponse.json(EMPTY_VIEW);
      }
      default:
        return NextResponse.json({ error: "unknown_op" }, { status: 400 });
    }
  } catch (err) {
    console.error("[differentiation] failed", err);
    return NextResponse.json(
      { error: "differentiation_failed", detail: String(err) },
      { status: 500 },
    );
  }
}
