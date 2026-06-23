import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  // Fail loud at first DB use rather than silently producing a broken client.
  console.warn(
    "[db] DATABASE_URL is not set. Provision Neon and add it to .env.local."
  );
}

const sql = neon(process.env.DATABASE_URL ?? "");

export const db = drizzle(sql, { schema });
export { schema };
