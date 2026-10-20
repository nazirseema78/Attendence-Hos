import "server-only";
import { and, count, eq, gt, lt } from "drizzle-orm";
import { db, schema } from "@/db";

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 10;

/** True when this login key has had too many recent failures. */
export async function isLoginLocked(key: string): Promise<boolean> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.loginFailures)
    .where(and(eq(schema.loginFailures.key, key), gt(schema.loginFailures.at, new Date(Date.now() - WINDOW_MS))));
  return n >= MAX_FAILURES;
}

export async function recordLoginFailure(key: string, ip: string | null): Promise<void> {
  await db.insert(schema.loginFailures).values({ key, ip });
  // Opportunistic cleanup of old rows.
  await db.delete(schema.loginFailures).where(lt(schema.loginFailures.at, new Date(Date.now() - 24 * 3600_000)));
}

export async function clearLoginFailures(key: string): Promise<void> {
  await db.delete(schema.loginFailures).where(eq(schema.loginFailures.key, key));
}

export const LOCKED_MESSAGE = "Too many failed attempts. Wait 15 minutes, then try again.";
