import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export type UserRow = typeof users.$inferSelect;

/** Look up an account by its (already-normalized) email. */
export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Create an account. `email` must already be normalized (lowercased/trimmed).
 * Returns the new user, or null if the email is already taken (the unique
 * constraint turns the insert into a no-op via onConflictDoNothing).
 */
export async function createUser(
  email: string,
  passwordHash: string,
): Promise<UserRow | null> {
  const id = randomUUID();
  const inserted = await db
    .insert(users)
    .values({ id, email, passwordHash })
    .onConflictDoNothing({ target: users.email })
    .returning();
  return inserted[0] ?? null;
}
