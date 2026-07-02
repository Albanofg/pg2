import { NextResponse } from "next/server";
import { generateText } from "ai";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSessionUser } from "@/lib/auth";
import { MODELS } from "@/lib/ai/openai";

/**
 * The "Tell me more about this" tutor — a scoped teaching chat for ONE brainstorm direction.
 * It coaches the inventor toward a STRONGER answer they can develop in their own words; it
 * never authors the inventive mechanism (that stays human), and never uses legal language.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

// Read the prompt each request (it's tiny) so tweaks to the tutor's behavior go live
// without a server restart.
async function loadTutorPrompt(): Promise<string> {
  const file = path.join(
    process.cwd(),
    "prompts",
    "module-1-conception",
    "12-tutor.md",
  );
  return (await readFile(file, "utf8")).trim();
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    direction?: { direction?: string; why?: string; invite?: string };
    messages?: { role: "user" | "assistant"; content: string }[];
  };
  const d = body.direction ?? {};
  const messages = Array.isArray(body.messages) ? body.messages : [];

  const system = [
    await loadTutorPrompt(),
    "",
    "THE DIRECTION you are teaching about:",
    `- Name: ${d.direction?.trim() || "(unspecified)"}`,
    ...(d.why?.trim() ? [`- Why it's interesting: ${d.why.trim()}`] : []),
    ...(d.invite?.trim() ? [`- The open question they must answer: ${d.invite.trim()}`] : []),
  ].join("\n");

  try {
    const { text } = await generateText({
      model: MODELS.drafter,
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
    });
    return NextResponse.json({ reply: text.trim() });
  } catch (err) {
    console.error("[conception] teach failed", err);
    return NextResponse.json({ error: "teach_failed" }, { status: 500 });
  }
}
