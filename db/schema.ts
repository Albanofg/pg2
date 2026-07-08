import {
  pgSchema,
  text,
  uuid,
  boolean,
  timestamp,
  jsonb,
  integer,
  bigserial,
  index,
  uniqueIndex,
  vector,
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

// Project Families — an owner-scoped label grouping sibling Projects that cover one
// product/subject domain, so distinct filings don't accidentally overlap.
// Organizational only: no content is shared or merged between member Projects.
export const projectFamilies = pg.table(
  "project_families",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    description: text("description"),
    // Free-text family background injected into the Helper's FAMILY CONTEXT every
    // turn — distinct from `description` (a short card label).
    context: text("context"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => ({
    userIdx: index("project_families_user_idx").on(t.userId),
  }),
);
export type ProjectFamily = typeof projectFamilies.$inferSelect;

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
  // The family this project belongs to (organizational grouping), or null if standalone.
  familyId: uuid("family_id").references(() => projectFamilies.id, { onDelete: "set null" }),
  // Editable project details (filing status etc.) — all optional. Feeds the Helper's
  // tone-by-status and the family context.
  inventorNames: text("inventor_names"), // comma-separated
  filedDate: text("filed_date"), // ISO date string (yyyy-mm-dd)
  status: text("status"), // draft | filed | granted | abandoned | archived
  applicationNumber: text("application_number"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// The digest cache — one row per notable artifact in a member Project. Computed once
// per save by the owning Project; every cross-sibling overlap check is then a pure
// indexed SQL read (no AI calls, no live re-read of other projects). FK-less on
// text; the refresh writer deletes-and-reinserts by kind rather than upserting.
export const projectFamilyArtifacts = pg.table(
  "project_family_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    // Mirrors the owning project's current family; kept in sync on attach/detach.
    familyId: uuid("family_id").references(() => projectFamilies.id, { onDelete: "set null" }),
    artifactKind: text("artifact_kind").notNull(), // idea_summary | extracted_idea | key_concept
    artifactRef: text("artifact_ref").notNull(), // stable ref (concept id or index)
    preview: text("preview").notNull(), // full artifact text, never truncated at write
    charCount: integer("char_count").notNull(),
    hash: text("hash").notNull(), // sha256 of normalized text
    // Semantic-retrieval vector (gemini-embedding-001 @ 1536 dims = EMBED_DIMS in
    // lib/ai/openai.ts). Nullable: written best-effort, null until embedded.
    embedding: vector("embedding", { dimensions: 1536 }),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    unique: uniqueIndex("project_family_artifacts_unique").on(
      t.projectId,
      t.artifactKind,
      t.artifactRef,
    ),
    familyKindIdx: index("project_family_artifacts_family_kind_idx").on(t.familyId, t.artifactKind),
    familyHashIdx: index("project_family_artifacts_family_hash_idx").on(t.familyId, t.hash),
    projectIdx: index("project_family_artifacts_project_idx").on(t.projectId),
  }),
);
export type ProjectFamilyArtifact = typeof projectFamilyArtifacts.$inferSelect;

// Family reference documents — external files (PDF/DOCX) uploaded once per family
// and shared by every sibling Project as background. Extracted to plain text at
// upload (mammoth for DOCX, pdf-parse for PDF), then AI-summarized. The Helper
// reads the summary (and, on demand, the full text) as background context, citing
// by name and never lifting. UPL-safe: these are "reference documents", never
// "prior art". Soft-deleted so a removed file leaves the family cleanly.
export const projectFamilyContextFiles = pg.table(
  "project_family_context_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    familyId: uuid("family_id")
      .references(() => projectFamilies.id, { onDelete: "cascade" })
      .notNull(),
    // Nullable so a file survives its uploader's account deletion.
    uploadedByUserId: text("uploaded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(), // application/pdf | DOCX MIME
    blobUrl: text("blob_url").notNull(),
    sizeBytes: integer("size_bytes").default(0).notNull(),
    extractedText: text("extracted_text"), // full plain text (null until extracted)
    summary: text("summary"), // one-line AI summary (null until summarized)
    // pending (extracting) | ok (text + summary ready) | failed (see error)
    extractionStatus: text("extraction_status").default("pending").notNull(),
    extractionError: text("extraction_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => ({
    familyIdx: index("project_family_context_files_family_idx").on(t.familyId),
  }),
);
export type ProjectFamilyContextFile = typeof projectFamilyContextFiles.$inferSelect;

// Reference-document passages — each uploaded file's extracted text is chunked and
// embedded for semantic retrieval (the Helper + working agents pull the most
// relevant passages, not a full-text dump). `familyId` + `filename` are denormalized
// so the ANN query is filter-and-rank with no join. Chunks are hard-deleted when
// their file is removed (keeps the vector corpus clean).
export const projectFamilyContextFileChunks = pg.table(
  "project_family_context_file_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fileId: uuid("file_id")
      .references(() => projectFamilyContextFiles.id, { onDelete: "cascade" })
      .notNull(),
    familyId: uuid("family_id").references(() => projectFamilies.id, { onDelete: "set null" }),
    filename: text("filename").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    // gemini-embedding-001 @ 1536 dims (EMBED_DIMS). Nullable: best-effort at write.
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    fileIdx: index("pf_context_file_chunks_file_idx").on(t.fileId),
    familyIdx: index("pf_context_file_chunks_family_idx").on(t.familyId),
  }),
);
export type ProjectFamilyContextFileChunk = typeof projectFamilyContextFileChunks.$inferSelect;

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

// AI usage log — one row per server-side model call. Observability only; the
// write is fire-and-forget (recordUsage) so a broken log never breaks an AI call.
// Deliberately FK-less: `user_email` is captured at insert time so rows stay
// readable even if the user/project is later deleted.
export const aiUsageLog = pg.table("ai_usage_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  seq: bigserial("seq", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  userId: text("user_id"), // nullable — some calls can't be attributed
  userEmail: text("user_email"),
  projectId: uuid("project_id"),
  stage: text("stage"), // brainstorm|conception|maturation|landscape|differentiation|showcase
  agentCode: text("agent_code"), // stable code, e.g. "showcase/figure-planner"
  agentLabel: text("agent_label"), // human-readable
  model: text("model").notNull(), // "gpt-5.4" | "gpt-5.4-mini" | "gemini-2.5-pro" | ...
  provider: text("provider"),
  inputTokens: integer("input_tokens").default(0).notNull(),
  outputTokens: integer("output_tokens").default(0).notNull(),
  cachedTokens: integer("cached_tokens").default(0).notNull(),
  totalTokens: integer("total_tokens").default(0).notNull(),
  durationMs: integer("duration_ms").default(0).notNull(),
  status: text("status").default("ok").notNull(), // ok | error
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
}, (t) => ({
  createdAtIdx: index("ai_usage_log_created_at_idx").on(t.createdAt),
  userEmailIdx: index("ai_usage_log_user_email_idx").on(t.userEmail),
  modelIdx: index("ai_usage_log_model_idx").on(t.model),
  agentIdx: index("ai_usage_log_agent_idx").on(t.agentLabel),
  stageIdx: index("ai_usage_log_stage_idx").on(t.stage),
}));
export type AiUsageRow = typeof aiUsageLog.$inferSelect;

export type Project = typeof projects.$inferSelect;
export type ConsciousnessNode = typeof sharedConsciousness.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Notebook = typeof notebooks.$inferSelect;
export type ContextFile = typeof contextFiles.$inferSelect;
