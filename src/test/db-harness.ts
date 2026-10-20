// Test-only: an in-memory Postgres (PGlite) behind a socket, migrated with the real migrations.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export async function startTestDb() {
  const pglite = await PGlite.create();
  const port = 40000 + Math.floor(Math.random() * 20000);
  const server = new PGLiteSocketServer({ db: pglite, port, host: "127.0.0.1", maxConnections: 10 });
  await server.start();

  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  // The app's db module reads these lazily on first query.
  process.env.DATABASE_URL = url;
  // PGlite is single-session: one pooled connection keeps each transaction isolated.
  process.env.DB_POOL_MAX = "1";

  const pool = new Pool({ connectionString: url, max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();

  return {
    url,
    async stop() {
      const g = globalThis as unknown as { db?: { $client?: Pool } };
      await g.db?.$client?.end().catch(() => {});
      await server.stop();
      await pglite.close();
    },
  };
}
