import { NextResponse } from "next/server";
import { loadConsciousness } from "@/lib/modules/shared/consciousness-store";
import { loadDifferentiation } from "@/lib/modules/differentiation/registry";
import {
  clearShowcase,
  loadShowcase,
  saveShowcase,
  seedShowcase,
} from "@/lib/modules/showcase/registry";
import type {
  CardActionInput,
  Module5View,
  ShowcaseKeyConcept,
} from "@/lib/modules/showcase/types";

export const runtime = "nodejs";

const EMPTY_VIEW: Module5View = {
  phase: "choosing",
  cards: [],
  keyConcepts: [],
  species: [],
  broadened: false,
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
 * Drives Module 5 (Showcase · broadening). `start` is idempotent: returns the
 * saved session if it has progress, otherwise seeds from Differentiation's
 * certified Key Concepts + compiled Invention Disclosure.
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
        const engine = await loadShowcase(body.projectId);
        return NextResponse.json(engine ? engine.view() : EMPTY_VIEW);
      }
      case "start": {
        const existing = await loadShowcase(body.projectId);
        const v = existing?.view();
        const hasProgress = !!v && (v.cards.length > 0 || v.complete || v.broadened);
        if (existing && hasProgress) return NextResponse.json(v);

        const [differentiation, consciousness] = await Promise.all([
          loadDifferentiation(body.projectId),
          loadConsciousness(body.projectId),
        ]);
        if (!differentiation || !differentiation.view().complete) {
          return NextResponse.json(
            {
              error: "prior_module_incomplete",
              detail: "Complete Differentiation (Key Concepts + disclosure) before Showcase.",
            },
            { status: 409 },
          );
        }

        const keyConcepts: ShowcaseKeyConcept[] = differentiation.finish().map((c) => ({
          id: c.id,
          title: c.title,
          statement: c.differentiation_statement || c.formalized_statement,
          verbatim: c.conception_trail.map((t) => t.verbatim_text),
        }));
        const disclosure = differentiation.getDisclosure()?.sections ?? [];

        const engine = seedShowcase(
          keyConcepts,
          disclosure,
          differentiation.ledgerEntries(),
          consciousness,
        );
        const view = await engine.start();
        await saveShowcase(body.projectId, engine);
        return NextResponse.json(view);
      }
      case "act": {
        const engine = await loadShowcase(body.projectId);
        if (!engine) return NextResponse.json(EMPTY_VIEW);
        const view = await engine.act(body.cardId, body.input);
        await saveShowcase(body.projectId, engine);
        return NextResponse.json(view);
      }
      case "message": {
        const engine = await loadShowcase(body.projectId);
        if (!engine) return NextResponse.json(EMPTY_VIEW);
        const view = await engine.tell(body.text ?? "");
        await saveShowcase(body.projectId, engine);
        return NextResponse.json(view);
      }
      case "reset": {
        await clearShowcase(body.projectId);
        return NextResponse.json(EMPTY_VIEW);
      }
      default:
        return NextResponse.json({ error: "unknown_op" }, { status: 400 });
    }
  } catch (err) {
    console.error("[showcase] failed", err);
    return NextResponse.json(
      { error: "showcase_failed", detail: String(err) },
      { status: 500 },
    );
  }
}
