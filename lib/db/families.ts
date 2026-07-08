import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { projectFamilies, projects, projectFamilyArtifacts } from "@/db/schema";
import { assertOwnership } from "./projects";
import { refreshFamilyArtifactsBackground } from "@/lib/families/digest";

/**
 * Family CRUD + membership. Owner-scoped: every read/mutation filters on
 * `user_id`, and cross-owner requests get a null/false result (routes return 404,
 * not 403 — don't leak existence). Soft-delete only; member Projects are never
 * touched beyond detaching. Single-auth (no dual `inventors_users`).
 */

export async function createFamily(
  userId: string,
  input: { title: string; description?: string; context?: string },
) {
  const inserted = await db
    .insert(projectFamilies)
    .values({
      userId,
      title: input.title.trim() || "Untitled Family",
      description: input.description?.trim() || null,
      context: input.context?.trim() || null,
    })
    .returning();
  return inserted[0];
}

export async function listFamilies(userId: string) {
  return db
    .select()
    .from(projectFamilies)
    .where(and(eq(projectFamilies.userId, userId), isNull(projectFamilies.deletedAt)))
    .orderBy(desc(projectFamilies.updatedAt));
}

/** A non-deleted family owned by the user, or null. */
export async function getFamily(familyId: string, userId: string) {
  const [f] = await db
    .select()
    .from(projectFamilies)
    .where(
      and(
        eq(projectFamilies.id, familyId),
        eq(projectFamilies.userId, userId),
        isNull(projectFamilies.deletedAt),
      ),
    )
    .limit(1);
  return f ?? null;
}

/** Family + its member projects (newest first). Null if not owned. */
export async function getFamilyWithMembers(familyId: string, userId: string) {
  const family = await getFamily(familyId, userId);
  if (!family) return null;
  const members = await db
    .select({
      id: projects.id,
      title: projects.title,
      currentPhase: projects.currentPhase,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.familyId, familyId))
    .orderBy(desc(projects.updatedAt));
  return { ...family, members };
}

export async function updateFamily(
  familyId: string,
  userId: string,
  patch: { title?: string; description?: string | null; context?: string | null },
) {
  if (!(await getFamily(familyId, userId))) return false;
  await db
    .update(projectFamilies)
    .set({
      updatedAt: new Date(),
      ...(patch.title !== undefined ? { title: patch.title.trim() || "Untitled Family" } : {}),
      ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
      ...(patch.context !== undefined ? { context: patch.context?.trim() || null } : {}),
    })
    .where(and(eq(projectFamilies.id, familyId), eq(projectFamilies.userId, userId)));
  return true;
}

/**
 * Soft-delete: mark the family deleted, detach every member Project (family_id →
 * null) and null the family_id on their cached artifacts (rows kept — re-attaching
 * later is instant, no re-extraction). Member Projects/credits are never deleted.
 */
export async function softDeleteFamily(familyId: string, userId: string) {
  if (!(await getFamily(familyId, userId))) return false;
  await db
    .update(projectFamilies)
    .set({ deletedAt: new Date() })
    .where(and(eq(projectFamilies.id, familyId), eq(projectFamilies.userId, userId)));
  await db.update(projects).set({ familyId: null }).where(eq(projects.familyId, familyId));
  await db
    .update(projectFamilyArtifacts)
    .set({ familyId: null })
    .where(eq(projectFamilyArtifacts.familyId, familyId));
  return true;
}

/** Attach a project — both project and family must be owned. Refreshes the digest. */
export async function attachProjectToFamily(projectId: string, familyId: string, userId: string) {
  if (!(await assertOwnership(projectId, userId))) return false;
  if (!(await getFamily(familyId, userId))) return false;
  await db
    .update(projects)
    .set({ familyId, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  // Existing Agent-1/4/5 content shows up in sibling views immediately.
  refreshFamilyArtifactsBackground(projectId, "all");
  return true;
}

/** Detach a project — nulls family_id on the project and its cached artifacts. */
export async function detachProjectFromFamily(projectId: string, userId: string) {
  if (!(await assertOwnership(projectId, userId))) return false;
  await db
    .update(projects)
    .set({ familyId: null, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  await db
    .update(projectFamilyArtifacts)
    .set({ familyId: null })
    .where(eq(projectFamilyArtifacts.projectId, projectId));
  return true;
}
