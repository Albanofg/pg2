import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createFamily, listFamilies } from "@/lib/db/families";

export const runtime = "nodejs";

/** List the current user's families (newest first). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const families = await listFamilies(user.userId);
  return NextResponse.json({ families });
}

/** Create a family. `title` required; `description`/`context` optional. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    description?: string;
    context?: string;
  };
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title_required" }, { status: 400 });
  }
  const family = await createFamily(user.userId, {
    title: body.title,
    description: body.description,
    context: body.context,
  });
  return NextResponse.json({ family });
}
