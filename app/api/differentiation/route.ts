import { NextResponse } from "next/server";
import { withUsageContext } from "@/lib/ai/usage-context";
import type { ConceptObject } from "@/lib/modules/shared";
import { loadConsciousness } from "@/lib/modules/shared/consciousness-store";
import { loadConception } from "@/lib/modules/conception/registry";
import { loadMaturation } from "@/lib/modules/maturation/registry";
import { loadLandscape } from "@/lib/modules/landscape/registry";
import {
  clearDifferentiation,
  loadDifferentiation,
  saveDifferentiation,
  seedDifferentiation,
} from "@/lib/modules/differentiation/registry";
import {
  runDifferentiationTeacher,
  runWhitespace,
} from "@/lib/modules/differentiation/agents";
import { openaiAgentRunner } from "@/lib/modules/differentiation/runner.openai";
import type {
  CardActionInput,
  ConceptLandscape,
  Module4View,
  WhitespaceTeaching,
} from "@/lib/modules/differentiation/types";

export const runtime = "nodejs";

const EMPTY_VIEW: Module4View = {
  phase: "framing",
  cards: [],
  concepts: [],
  conversation: [],
  ledger: [],
  complete: false,
};

type Body =
  | { op: "view"; projectId: string }
  | { op: "start"; projectId: string }
  | { op: "act"; projectId: string; cardId: string; input: CardActionInput }
  | { op: "message"; projectId: string; text: string }
  | { op: "prepare_next"; projectId: string }
  | { op: "compile"; projectId: string }
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

  return withUsageContext({ projectId: body.projectId, stage: "differentiation" }, async () => {
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

        const [maturation, landscape, consciousness, conception] = await Promise.all([
          loadMaturation(body.projectId),
          loadLandscape(body.projectId),
          loadConsciousness(body.projectId),
          loadConception(body.projectId),
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
          conception.getRepresentativeCode(),
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
      case "prepare_next": {
        // Background pipeline — ONE concept at a time: while the inventor answers
        // the current concept, prepare only the NEXT one's analysis + lesson.
        // The slow compute runs OUTSIDE the engine; then we re-load fresh and
        // graft in a tiny write, so a concurrent "This is mine" can't be clobbered.
        const probe = await loadDifferentiation(body.projectId);
        const target = probe?.peekPrepareTarget();
        if (!target) return NextResponse.json({ prepared: false });

        const analysis = await runWhitespace(openaiAgentRunner, {
          title: target.title,
          statement: target.statement,
          references: target.references,
        });
        let teaching: WhitespaceTeaching | undefined;
        try {
          teaching = await runDifferentiationTeacher(openaiAgentRunner, {
            title: target.title,
            statement: target.statement,
            analysis,
          });
        } catch (err) {
          console.error("[differentiation] prepare: teacher failed", err);
        }

        const engine = await loadDifferentiation(body.projectId);
        if (!engine) return NextResponse.json({ prepared: false });
        engine.attachPrepared(target.conceptId, analysis, teaching);
        await saveDifferentiation(body.projectId, engine);
        return NextResponse.json({ prepared: true });
      }
      case "compile": {
        // The heavy step (nine disclosure sections + certify every Key Concept),
        // run as its own request so the anchor click stays instant. Idempotent —
        // the engine only compiles from the "compiling" phase.
        const engine = await loadDifferentiation(body.projectId);
        if (!engine) return NextResponse.json(EMPTY_VIEW);
        const view = await engine.compile();
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
  });
}
