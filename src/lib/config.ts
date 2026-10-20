import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export const DEFAULT_GRACE_MINUTES = 30;

export async function getSessions() {
  return db.select().from(schema.attendanceSessions).orderBy(asc(schema.attendanceSessions.startMinute));
}

export async function getGraceMinutes(): Promise<number> {
  const [row] = await db
    .select({ graceMinutes: schema.settings.graceMinutes })
    .from(schema.settings)
    .where(eq(schema.settings.id, 1));
  return row?.graceMinutes ?? DEFAULT_GRACE_MINUTES;
}

export async function getAllowlist() {
  return db.select().from(schema.allowedIps).orderBy(asc(schema.allowedIps.createdAt));
}
