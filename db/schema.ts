import {
  pgSchema,
  text,
  uuid,
  boolean,
  timestamp,
  jsonb,
  integer,
  bigserial,
} from "drizzle-orm/pg-core";

/**
 * Patent Geyser 2.0 data model.
 *
 * Every table lives in the dedicated `patentgeyser2o` Postgres schema so this
 * app shares the Neon database with other projects without colliding. Drizzle's
 * schemaFilter (drizzle.config.ts) keeps push/introspect scoped to it.
 *
 * The Shared Consciousness is modeled as a DAG: each node carries the human
 * inputs that justify it plus the verified draft, and records its parents so
 * disavowal can cascade invalidation downstream.
 */
export const pg = pgSchema("patentgeyser2o");

// Users — real accounts (hand-rolled email/password auth). `id` is an
// app-generated uuid string; `email` is unique; `passwordHash` is scrypt
// `salt:hash` hex (nullable so legacy/seed rows without a password are valid).
export const users = pg.table("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Projects — one Invention Concept Blueprint (ICB).
export const projects = pg.table("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").default("Untitled Draft").notNull(),
  // core_novelty | tech_arch | detailed_impl | broadening
  currentPhase: text("current_phase").default("core_novelty").notNull(),
  // Durable per-project state for the module engines (Conception, Maturation,
  // Landscape, …). Additive: nullable, defaults to no saved state. Each module
  // persists a full snapshot here so sessions survive restarts and work on a
  // multi-user, multi-project, multi-instance deployment.
  moduleState: jsonb("module_state").$type<{
    conception?: unknown;
    maturation?: unknown;
    landscape?: unknown;
    differentiation?: unknown;
    showcase?: unknown;
  }>(),
  /**
   * Optimistic-concurrency token for `module_state`. Every save does a
   * compare-and-swap on this version so concurrent writers can't silently clobber
   * each other (lost-update protection for a multi-user / multi-tab deployment).
   */
  version: integer("version").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * The Shared Consciousness — the cross-module draft memory, as an append-only
 * table (ONE ROW PER ENTRY). This is deliberately NOT a jsonb blob: many agents
 * write it, often concurrently, so appends must be conflict-free INSERTs that
 * never clobber each other. Status changes (settle / supersede / stale) are
 * row-scoped UPDATEs. Reads are `WHERE project_id ORDER BY seq`.
 *
 * Distinct from the inventor's notebook (the EvidenceLedger): this is what the
 * AGENTS built and the reasoning behind it, not the human's sealed verbatim.
 */
export const consciousnessEntries = pg.table("consciousness_entries", {
  // The app supplies the id (the in-memory store generates it; derivedFrom /
  // supersedes reference it), so there is no DB default.
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull(),
  // Monotonic per-insert ordering, so a load reconstructs append order exactly.
  seq: bigserial("seq", { mode: "number" }).notNull(),
  part: text("part").notNull(),
  // artifact | decision | open_question
  kind: text("kind").notNull(),
  content: text("content").notNull(),
  why: text("why"),
  // A few concrete reasons (anchored to the inventor's words) the piece was made
  // this way. Carried forward so a downstream grade can check consistency against
  // each one — the anti-drift mechanism. Nullable/additive; old rows read as [].
  reasons: jsonb("reasons").$type<string[]>(),
  agent: text("agent").notNull(),
  // ISO-8601 string, stored verbatim to round-trip the in-memory entry exactly.
  createdAt: text("created_at").notNull(),
  derivedFrom: jsonb("derived_from").$type<string[]>(),
  tracesTo: jsonb("traces_to").$type<string[]>(),
  tags: jsonb("tags").$type<string[]>(),
  // draft | settled | superseded
  status: text("status").notNull(),
  supersedes: uuid("supersedes"),
  supersededBy: uuid("superseded_by"),
  stale: boolean("stale"),
  verification: jsonb("verification").$type<{
    by: string;
    verdict: "pass" | "fail";
    note?: string;
    at: string;
  }>(),
});

// Context files (codebases / READMEs) uploaded to Vercel Blob.
export const contextFiles = pg.table("context_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  size: integer("size").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Shared Consciousness — the living memory & DAG.
export const sharedConsciousness = pg.table("shared_consciousness", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull(),
  nodeKey: text("node_key").notNull(), // e.g. 'core_novelty', 'tech_arch', 'claim_1'
  // DAG edges: keys of the nodes this one depends on.
  parents: jsonb("parents").$type<string[]>().default([]).notNull(),
  humanInputs: jsonb("human_inputs").$type<string[]>().default([]).notNull(),
  draftOutput: text("draft_output"),
  isVerified: boolean("is_verified").default(false).notNull(),
  invalidatedAt: timestamp("invalidated_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Helper chat history.
export const messages = pg.table("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull(),
  role: text("role").notNull(), // 'user' | 'helper'
  content: text("content").notNull(),
  isDisavowal: boolean("is_disavowal").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Inventor's Notebooks — cryptographically sealed conception record.
export const notebooks = pg.table("notebooks", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull(),
  contentHash: text("content_hash").notNull(), // SHA-256 hex
  rfc3161Token: text("rfc3161_token"), // base64 ASN.1 TimeStampResp
  sealedAt: timestamp("sealed_at").defaultNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type ConsciousnessNode = typeof sharedConsciousness.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Notebook = typeof notebooks.$inferSelect;
export type ContextFile = typeof contextFiles.$inferSelect;
