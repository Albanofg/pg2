import { NextResponse } from "next/server";
import { generateObject } from "@/lib/ai/gen";
import { withUsageContext } from "@/lib/ai/usage-context";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSessionUser } from "@/lib/auth";
import { MODELS } from "@/lib/ai/openai";
import { loadConception } from "@/lib/modules/conception/registry";

/**
 * The "Tell me more about this" tutor — a scoped teaching chat for ONE brainstorm direction.
 * It coaches the inventor toward a STRONGER answer they can develop in their own words; it
 * never authors the inventive mechanism (that stays human), and never uses legal language.
 *
 * It reads the inventor's REAL invention (the formalized statement + their own concepts and
 * words, loaded from the project) so it teaches from their system — not a label. It's a short
 * climb of AT MOST 4 steps: each reply is a short teaching beat that hands to ONE fill-in-the-
 * blank question (a "Mad Lib"); the inventor fills it, it comes back as their answer, and the
 * teacher gives the next step (correcting mistakes) until they can state the mechanism. Blanks
 * name slots, never the answer; the teacher never fills them.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

// Read the prompt each request (it's tiny) so tweaks to the tutor's behavior go live
// without a server restart.
async function loadTutorPrompt(): Promise<string> {
  const file = path.join(process.cwd(), "prompts", "module-1-conception", "12-tutor.md");
  return (await readFile(file, "utf8")).trim();
}

const TeachOutput = z.object({
  reply: z.string(),
  // This step's mad-lib question — a sentence with 1–2 [bracketed slot-labels] the inventor
  // fills to answer this step. null on the turn they reach the answer (the teacher affirms).
  // The teacher never fills a blank; a blank never contains/describes the answer.
  // `hint` is an ON-DEMAND teaching nugget: it teaches the idea so the inventor can FIND
  // their own answer — never the answer itself, never a list of options, never a riddle.
  scaffold: z
    .object({
      intro: z.string().default(""),
      template: z.string(),
      hint: z.string().default(""),
    })
    .nullable()
    .default(null),
});

/** Compact "read & learn" context: the inventor's real invention, in their words. */
async function inventionContext(projectId: string | undefined): Promise<string> {
  if (!projectId) return "";
  try {
    const view = (await loadConception(projectId)).view();
    const lines: string[] = [];
    if (view.statement?.text?.trim()) {
      lines.push("The invention (formalized reading of the inventor's idea):", view.statement.text.trim());
    }
    const concepts = view.concepts ?? [];
    if (concepts.length) {
      lines.push(
        "",
        "The inventor's concepts so far:",
        ...concepts.map((c) => `- ${c.title}: ${c.formalized_statement}`),
      );
    }
    const verbatim = concepts
      .flatMap((c) => c.conception_trail?.map((t) => t.verbatim_text) ?? [])
      .filter(Boolean);
    if (verbatim.length) {
      lines.push("", "The inventor's OWN WORDS so far (draw the fixed parts of any scaffold from these):", ...verbatim.map((v) => `• ${v}`));
    }
    return lines.join("\n");
  } catch (err) {
    console.error("[conception] teach: invention context load failed", err);
    return "";
  }
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    direction?: { direction?: string; why?: string; invite?: string };
    messages?: { role: "user" | "assistant"; content: string }[];
  };
  const d = body.direction ?? {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const context = await inventionContext(body.projectId);
  // Which teaching step this reply is (max 4). One assistant turn already sent = step 2, etc.
  const step = Math.min(4, messages.filter((m) => m.role === "assistant").length + 1);

  const system = [
    await loadTutorPrompt(),
    "",
    `THIS IS TEACHING STEP ${step} OF AT MOST 4. ${
      step >= 3
        ? "You are near the cap — converge NOW: get them to the resolving mechanism and, once they state it, affirm and return scaffold null."
        : "Move materially closer to the resolving mechanism with this step."
    }`,
    "",
    "THE DIRECTION you are teaching about:",
    `- Name: ${d.direction?.trim() || "(unspecified)"}`,
    ...(d.why?.trim() ? [`- Why it's interesting: ${d.why.trim()}`] : []),
    ...(d.invite?.trim() ? [`- The open question they must answer: ${d.invite.trim()}`] : []),
    ...(context
      ? [
          "",
          "THE INVENTOR'S REAL INVENTION — READ AND LEARN FROM THIS. Teach from THEIR system, and build the fixed words of any scaffold from what's here. Never invent mechanism beyond it:",
          context,
        ]
      : []),
  ].join("\n");

  try {
    const { object } = await withUsageContext(
      { projectId: body.projectId, userId: user.userId, email: user.email, stage: "conception", agentCode: "conception/teach" },
      () =>
        generateObject({
          model: MODELS.drafter,
          schema: TeachOutput,
      system,
      messages: messages.length
        ? messages
        : [
            {
              role: "user",
              content:
                "Tell me more about this — what does it mean, why is it interesting, and what would a strong answer look like?",
            },
          ],
      temperature: 0.5,
        }),
    );
    return NextResponse.json({
      reply: object.reply.trim(),
      scaffold:
        object.scaffold && object.scaffold.template.trim()
          ? {
              intro: object.scaffold.intro,
              template: object.scaffold.template,
              hint: object.scaffold.hint.trim(),
            }
          : null,
    });
  } catch (err) {
    console.error("[conception] teach failed", err);
    return NextResponse.json({ error: "teach_failed" }, { status: 500 });
  }
}
