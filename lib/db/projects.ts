import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, users, contextFiles } from "@/db/schema";
import { ensureNodes } from "./shared-consciousness";

/** Upsert the local user into our table on first use. */
export async function ensureUser(userId: string, email: string) {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(users).values({ id: userId, email }).onConflictDoNothing();
  }
}

/**
 * Load the project the workspace should open. If `projectId` is given and owned
 * by the user, load that one; otherwise fall back to the most recent, creating
 * a first project if the user has none.
 */
export async function bootstrapProject(
  userId: string,
  email: string,
  projectId?: string | null
) {
  await ensureUser(userId, email);

  let project: typeof projects.$inferSelect | undefined;

  if (projectId) {
    const owned = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);
    project = owned[0];
  }

  if (!project) {
    const found = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.updatedAt))
      .limit(1);
    project = found[0];
  }

  if (!project) {
    const inserted = await db
      .insert(projects)
      .values({ userId, title: "Untitled Draft" })
      .returning();
    project = inserted[0];
  }

  await ensureNodes(project.id);
  return project;
}

/** All of the user's projects, newest first — for the dashboard. */
export async function listProjects(userId: string) {
  return db
    .select({
      id: projects.id,
      title: projects.title,
      currentPhase: projects.currentPhase,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt));
}

/** Create a fresh project (and its Shared Consciousness nodes). */
export async function createProject(
  userId: string,
  email: string,
  title = "Untitled Draft"
) {
  await ensureUser(userId, email);
  const inserted = await db
    .insert(projects)
    .values({ userId, title: title.trim() || "Untitled Draft" })
    .returning();
  const project = inserted[0];
  await ensureNodes(project.id);
  return project;
}

/** Delete a project and everything under it (FK cascade). Returns false if not owned. */
export async function deleteProject(userId: string, projectId: string) {
  if (!(await assertOwnership(projectId, userId))) return false;
  await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  return true;
}

/** Rename a project. Returns false if not owned. */
export async function renameProject(
  userId: string,
  projectId: string,
  title: string
) {
  if (!(await assertOwnership(projectId, userId))) return false;
  await db
    .update(projects)
    .set({ title: title.trim() || "Untitled Draft", updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  return true;
}

/** Guard: confirm a project belongs to the current user before mutating. */
export async function assertOwnership(projectId: string, userId: string) {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

export async function addContextFile(
  projectId: string,
  name: string,
  url: string,
  size: number
) {
  const inserted = await db
    .insert(contextFiles)
    .values({ projectId, name, url, size })
    .returning();
  return inserted[0];
}

export async function listContextFiles(projectId: string) {
  return db
    .select()
    .from(contextFiles)
    .where(eq(contextFiles.projectId, projectId));
}
