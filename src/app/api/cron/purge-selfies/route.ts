import { timingSafeEqual } from "node:crypto";
import { and, inArray, isNotNull, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { defaultDeps, sweepAttempts } from "@/lib/attempts";
import { deletePrivate } from "@/lib/cloudinary";
import { env } from "@/lib/env";

const SELFIE_RETENTION_DAYS = 90;
const BATCH = 500;

function authorized(request: Request): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Daily (Vercel Cron): delete selfie files older than 90 days. Attendance records are kept. */
export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

  const cutoff = new Date(Date.now() - SELFIE_RETENTION_DAYS * 86_400_000);
  let purged = 0;

  for (;;) {
    const batch = await db
      .select({ id: schema.attendance.id, selfieId: schema.attendance.selfieId })
      .from(schema.attendance)
      .where(and(isNotNull(schema.attendance.selfieId), lt(schema.attendance.markedAt, cutoff)))
      .limit(BATCH);
    if (batch.length === 0) break;

    await deletePrivate(batch.map((r) => r.selfieId!));
    await db
      .update(schema.attendance)
      .set({ selfieId: null, selfieDeletedAt: new Date() })
      .where(inArray(schema.attendance.id, batch.map((r) => r.id)));
    purged += batch.length;
    if (batch.length < BATCH) break;
  }

  // Expire unfinished attempts and remove images from verifications that never completed.
  const attempts = await sweepAttempts(defaultDeps().storage);

  return Response.json({ purged, cutoff: cutoff.toISOString(), attempts });
}
