import type { Config } from "drizzle-kit";

export default {
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Confine push/introspect to this app's schema only. Other schemas in the
  // shared Neon database are never read, diffed, or modified.
  schemaFilter: ["patentgeyser2o"],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
