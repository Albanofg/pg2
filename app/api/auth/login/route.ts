import { NextResponse } from "next/server";
import { normalizeEmail, verifyPassword } from "@/lib/auth";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";
import { findUserByEmail } from "@/lib/db/users";

export const runtime = "nodejs";

/** POST /api/auth/login — { email, password } → verify + set session. */
export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  // Generic failure for any bad input or mismatch — never reveal which part failed.
  const invalid = () =>
    NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  if (!email || !password) return invalid();

  try {
    const user = await findUserByEmail(email);
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !ok) return invalid();

    const token = await signSession(user.id, user.email);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (err) {
    console.error("[auth/login] failed", err);
    return NextResponse.json({ error: "login_failed" }, { status: 500 });
  }
}
