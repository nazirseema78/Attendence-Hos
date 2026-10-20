import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { env } from "@/lib/env";

type Db = NodePgDatabase<typeof schema>;
const globalForDb = globalThis as unknown as { db?: Db };

/** Created on first use (not at import), so `next build` works without database credentials. */
function getDb(): Db {
  if (!globalForDb.db) {
    // One pool per server instance; also survives hot reloads in dev.
    const pool = new Pool({ connectionString: env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX) || 5 });
    globalForDb.db = drizzle(pool, { schema });
  }
  return globalForDb.db;
}

export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
