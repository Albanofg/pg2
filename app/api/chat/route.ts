import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/db";
import { messages as messagesTable } from "@/db/schema";
import { assertOwnership } from "@/lib/db/projects";
import {
  ensureNodes,
  recordHumanInput,
  collectHumanInputs,
  setPhase as persistPhase,
  getVerifiedDraft,
} from "@/lib/db/shared-consciousness";
import {
  invalidateCascade,
  nodesContainingText,
} from "@/lib/db/dag-invalidation";
import { streamHelperQuestion, distillIdea } from "@/lib/ai/helper-agent";
import { runMeshForNode } from "@/lib/ai/mesh";
import { buildContextSummary } from "@/lib/ai/context";
import { hasOpenAIKey } from "@/lib/ai/openai";
import { NODE_GRAPH } from "@/lib/dag";

export const runtime = "nodejs";
export const maxDuration = 120;

const NEXT_PHASE: Record<string, string | null> = {
  core_novelty: "tech_arch",
  tech_arch: "detailed_impl",
  detailed_impl: "broadening",
  broadening: null,
};

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  const { userId } = user;

  const body = await req.json();
  const { projectId, phase, message, disavowedQuote, history } = body ?? {};

  if (!projectId || !message) {
    return new Response("projectId and message required", { status: 400 });
  }
  if (!(await assertOwnership(projectId, userId))) {
    return new Response("forbidden", { status: 403 });
  }
  if (!hasOpenAIKey()) {
    return new Response("OPENAI_API_KEY not configured", { status: 500 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: { type: string; value: any }) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      try {
        await ensureNodes(projectId);
        const contextSummary = await buildContextSummary(projectId);
        let activePhase: string = phase ?? "core_novelty";

        // ── 1. Disavowal cascade ───────────────────────────────
        if (disavowedQuote) {
          let targets = await nodesContainingText(projectId, disavowedQuote);
          if (targets.length === 0) targets = [activePhase];

          const allAffected = new Set<string>();
          let rewind = activePhase;
          for (const t of targets) {
            const { affected, rewindPhase } = await invalidateCascade(projectId, t);
            affected.forEach((a) => allAffected.add(a));
            rewind = rewindPhase;
          }
          send({ type: "invalidate", value: [...allAffected] });
          activePhase = rewind;
          send({ type: "phase", value: activePhase });

          await db.insert(messagesTable).values({
            projectId,
            role: "user",
            content: message,
            isDisavowal: true,
          });
        } else {
          await db.insert(messagesTable).values({
            projectId,
            role: "user",
            content: message,
          });
        }

        // ── 2. Record the inventor's words into the active node ──
        await recordHumanInput(projectId, activePhase, message);

        // ── 3. Stream the Helper's Socratic question ─────────────
        const textStream = await streamHelperQuestion({
          phase: activePhase,
          history: Array.isArray(history) ? history : [],
          message,
          contextSummary,
          disavowedQuote,
        });

        let helperText = "";
        for await (const delta of textStream) {
          helperText += delta;
          send({ type: "token", value: delta });
        }

        // ── 4. Distill the Current Idea (core novelty inputs) ────
        const inputsByNode = await collectHumanInputs(projectId);
        const idea = await distillIdea(inputsByNode["core_novelty"] ?? []);
        if (idea) send({ type: "idea", value: idea });

        // ── 5. Run the mesh for the active node ──────────────────
        const verified = await getVerifiedDraft(projectId);
        const priorSections = verified
          .map((n) => `## ${NODE_GRAPH[n.nodeKey]?.label ?? n.nodeKey}\n${n.draftOutput}`)
          .join("\n\n");

        const outcome = await runMeshForNode({
          projectId,
          nodeKey: activePhase,
          phase: activePhase,
          humanInputs: inputsByNode[activePhase] ?? [],
          priorSections,
          contextSummary,
          emit: send,
        });

        if (outcome.kind === "gap") {
          // Append the targeted Socratic fallback to the Helper bubble.
          const followUp = `\n\n${outcome.question}`;
          for (const ch of chunk(followUp, 24)) send({ type: "token", value: ch });
          helperText += followUp;
        } else if (activePhase !== "broadening") {
          // Section verified — advance the phase machine.
          const next = NEXT_PHASE[activePhase];
          if (next) {
            await persistPhase(projectId, next);
            send({ type: "phase", value: next });
          }
        }

        await db.insert(messagesTable).values({
          projectId,
          role: "helper",
          content: helperText,
        });

        send({ type: "done", value: true });
      } catch (err) {
        console.error("[chat] stream error", err);
        send({ type: "token", value: "\n\n[The mesh hit an error. Your inputs are saved — try again.]" });
        send({ type: "done", value: true });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

/** Split a string into ~size chunks for smooth streaming of appended text. */
function chunk(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}
