import { NextResponse } from "next/server";
import { hashPassword, normalizeEmail } from "@/lib/auth";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";
import { createUser, findUserByEmail } from "@/lib/db/users";

export const runtime = "nodejs";

/** POST /api/auth/signup — { email, password } → create account + set session. */
export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "weak_password", detail: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }

  try {
    if (await findUserByEmail(email)) {
      return NextResponse.json({ error: "email_taken" }, { status: 409 });
    }
    const passwordHash = await hashPassword(password);
    const user = await createUser(email, passwordHash);
    if (!user) {
      // Lost a race on the unique email constraint.
      return NextResponse.json({ error: "email_taken" }, { status: 409 });
    }
    const token = await signSession(user.id, user.email);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (err) {
    console.error("[auth/signup] failed", err);
    return NextResponse.json({ error: "signup_failed" }, { status: 500 });
  }
}
