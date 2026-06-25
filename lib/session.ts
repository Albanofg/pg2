/**
 * Session cookie — isomorphic (edge + node).
 *
 * Stateless signed token: `base64url(payload) + "." + base64url(HMAC-SHA256(payload))`,
 * signed/verified with Web Crypto (`globalThis.crypto.subtle`) so the SAME code runs
 * in edge middleware AND node route handlers. Deliberately imports NO `node:crypto`
 * and is not `server-only`, so the edge middleware bundle stays valid.
 *
 * The secret comes from `process.env.SESSION_SECRET` (referenced directly so Next
 * inlines it into the edge bundle).
 */

export const SESSION_COOKIE = "geyser_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type SessionPayload = { uid: string; email: string; exp: number };

const enc = new TextEncoder();

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  // Back with a concrete ArrayBuffer so the result is a valid BufferSource for Web Crypto.
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set.");
  return s;
}

function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Sign a session for a user. Returns the cookie value. */
export async function signSession(uid: string, email: string): Promise<string> {
  const payload: SessionPayload = { uid, email, exp: nowSeconds() + MAX_AGE_SECONDS };
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Verify a cookie value; returns the payload if the signature is valid and unexpired, else null. */
export async function verifySession(
  token: string | undefined | null,
): Promise<SessionPayload | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      b64urlDecode(sigPart),
      enc.encode(body),
    );
    if (!ok) return null;
    const payload = JSON.parse(
      new TextDecoder().decode(b64urlDecode(body)),
    ) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < nowSeconds()) return null;
    if (!payload.uid || !payload.email) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Cookie attributes for the session (pass maxAge 0 to clear it on logout). */
export function sessionCookieOptions(maxAge: number = MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
