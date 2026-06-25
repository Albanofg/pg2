/**
 * Auth core (node-only).
 *
 * Hand-rolled email/password — no third-party vendor, no new dependencies.
 * Passwords are hashed with Node's `scrypt`; the session cookie itself is
 * signed/verified in the isomorphic `lib/session.ts` (Web Crypto) so middleware
 * can share it. This module imports `node:crypto`, so it must NOT be imported by
 * edge middleware — only by node route handlers / server components.
 */
import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64;

/** Normalize + shape-check an email. Returns the lowercased email or null. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v;
}

/** Hash a password as `saltHex:hashHex` (scrypt, random 16-byte salt). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

/** Constant-time verify against a stored `saltHex:hashHex`. */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * The current authenticated user from the session cookie, or null. Use at the top
 * of every protected route handler: `const user = await getSessionUser(); if (!user) 401`.
 */
export async function getSessionUser(): Promise<{ userId: string; email: string } | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const payload = await verifySession(token);
  if (!payload) return null;
  return { userId: payload.uid, email: payload.email };
}
