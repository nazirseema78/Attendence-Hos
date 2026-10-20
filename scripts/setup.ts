/**
 * One-command setup: `npm run setup`
 *  1. Applies database migrations (creates / updates tables).
 *  2. Adds the default attendance sessions and settings if none exist.
 *  3. Creates the first admin from INITIAL_ADMIN_* in .env.local (skipped if it already exists).
 * Safe to run again at any time.
 */
import { existsSync } from "node:fs";
import { hash } from "bcryptjs";
import { count, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "../src/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const DEFAULT_SESSIONS = [
  { name: "Session 1", startMinute: 8 * 60, endMinute: 14 * 60 + 30 },
  { name: "Session 2", startMinute: 14 * 60 + 30, endMinute: 21 * 60 },
  { name: "Session 3", startMinute: 21 * 60, endMinute: 8 * 60 },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is empty. Fill it in .env.local first.");

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });

  console.log("• Applying migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });

  const [{ n }] = await db.select({ n: count() }).from(schema.attendanceSessions);
  if (n === 0) {
    await db.insert(schema.attendanceSessions).values(DEFAULT_SESSIONS);
    console.log("• Added default sessions: 8:00–14:30, 14:30–21:00, 21:00–08:00");
  }
  await db.insert(schema.settings).values({ id: 1, graceMinutes: 30 }).onConflictDoNothing();

  // Snapshot occurrence windows onto attendance rows made before that column existed, using the
  // building time zone and current session times. Rows that already have a snapshot are untouched.
  const { sessionEnd, sessionStart } = await import("../src/lib/schedule");
  const { BUILDING_TIME_ZONE } = await import("../src/lib/timezone");
  const missing = await db
    .select({ id: schema.attendance.id, date: schema.attendance.sessionDate, session: schema.attendanceSessions })
    .from(schema.attendance)
    .innerJoin(schema.attendanceSessions, eq(schema.attendance.sessionId, schema.attendanceSessions.id))
    .where(isNull(schema.attendance.occurrenceStart));
  for (const row of missing) {
    await db
      .update(schema.attendance)
      .set({ occurrenceStart: sessionStart(row.session, row.date), occurrenceEnd: sessionEnd(row.session, row.date) })
      .where(eq(schema.attendance.id, row.id));
  }
  if (missing.length) console.log(`• Recorded session times on ${missing.length} older attendance records (${BUILDING_TIME_ZONE}).`);

  const name = process.env.INITIAL_ADMIN_NAME?.trim();
  const username = process.env.INITIAL_ADMIN_USERNAME?.trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD ?? "";
  if (!name || !username || !password) {
    console.log("• INITIAL_ADMIN_* not set; skipping admin creation.");
  } else {
    const [existing] = await db.select({ id: schema.admins.id }).from(schema.admins).where(eq(schema.admins.username, username));
    if (existing) {
      console.log(`• Admin "${username}" already exists; not changed.`);
    } else {
      if (password.length < 10) throw new Error("INITIAL_ADMIN_PASSWORD must be at least 10 characters.");
      await db.insert(schema.admins).values({ name, username, passwordHash: await hash(password, 12) });
      console.log(`• Created admin "${username}". You can now clear INITIAL_ADMIN_PASSWORD from .env.local.`);
    }
  }

  await pool.end();
  console.log("✓ Setup complete.");
}

main().catch((e) => {
  console.error("✗ Setup failed:", e instanceof Error ? e.message : e);
  // Database drivers put the real reason (e.g. "column does not exist", a timeout) in `cause`.
  const cause = e instanceof Error ? (e.cause as Error | undefined) : undefined;
  if (cause) console.error("  Cause:", cause.message ?? cause);
  process.exit(1);
});
