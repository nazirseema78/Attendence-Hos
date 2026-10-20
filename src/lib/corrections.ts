import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { sessionEnd, sessionStart } from "./schedule";

export const CORRECTION_ACTIONS = {
  present_on_time: { state: "present", status: "on_time", label: "Present · on time" },
  present_late: { state: "present", status: "late", label: "Present · late" },
  absent: { state: "absent", status: null, label: "Absent" },
} as const;
export type CorrectionAction = keyof typeof CORRECTION_ACTIONS;

export function isCorrectionAction(v: unknown): v is CorrectionAction {
  return typeof v === "string" && v in CORRECTION_ACTIONS;
}

export type CorrectionResult = { ok: true } | { ok: false; message: string };

type Snapshot = { state: string; status: string | null; method: string } | null;

/**
 * Staff mark or correct one student's attendance for one occurrence.
 * Self-marked evidence (selfie, verification) is never deleted; only state/punctuality change,
 * and every change is written to attendance_corrections with the previous and new values.
 */
export async function applyCorrection(opts: {
  adminId: string;
  adminIp: string | null;
  studentId: string;
  sessionId: number;
  sessionDate: string;
  action: CorrectionAction;
  reason: string;
  now?: Date;
}): Promise<CorrectionResult> {
  const now = opts.now ?? new Date();
  const reason = opts.reason.trim();
  if (reason.length < 5) return { ok: false, message: "Give a reason of at least 5 characters." };
  if (reason.length > 500) return { ok: false, message: "Keep the reason under 500 characters." };

  const [student] = await db.select({ id: schema.students.id }).from(schema.students).where(eq(schema.students.id, opts.studentId));
  const [session] = await db.select().from(schema.attendanceSessions).where(eq(schema.attendanceSessions.id, opts.sessionId));
  if (!student || !session) return { ok: false, message: "Student or session not found." };

  const start = sessionStart(session, opts.sessionDate);
  if (start > now) return { ok: false, message: "This session hasn't started yet, so it can't be marked." };
  const target = CORRECTION_ACTIONS[opts.action];

  return db.transaction(async (tx) => {
    // Create the row if missing (racing a self-mark is safe: the unique index decides), then lock it.
    const created = await tx
      .insert(schema.attendance)
      .values({
        studentId: opts.studentId,
        sessionId: opts.sessionId,
        sessionDate: opts.sessionDate,
        state: target.state,
        status: target.status,
        method: "staff",
        markedByAdminId: opts.adminId,
        occurrenceStart: start,
        occurrenceEnd: sessionEnd(session, opts.sessionDate),
        markedAt: now,
        ip: opts.adminIp ?? "staff",
      })
      .onConflictDoNothing()
      .returning({ id: schema.attendance.id });

    const [row] = await tx
      .select()
      .from(schema.attendance)
      .where(
        and(
          eq(schema.attendance.studentId, opts.studentId),
          eq(schema.attendance.sessionId, opts.sessionId),
          eq(schema.attendance.sessionDate, opts.sessionDate),
        ),
      )
      .for("update");

    const createdNow = created.length === 1;
    const previous: Snapshot = createdNow ? null : { state: row.state, status: row.status, method: row.method };
    const next = { state: target.state, status: target.status, method: row.method };

    if (previous && previous.state === next.state && previous.status === next.status) {
      return { ok: false as const, message: "That is already the recorded status." };
    }
    if (!createdNow) {
      await tx
        .update(schema.attendance)
        .set({ state: target.state, status: target.status, markedByAdminId: opts.adminId })
        .where(eq(schema.attendance.id, row.id));
    }
    await tx.insert(schema.attendanceCorrections).values({
      studentId: opts.studentId,
      sessionId: opts.sessionId,
      sessionDate: opts.sessionDate,
      adminId: opts.adminId,
      reason,
      previous,
      next,
      createdAt: now,
    });
    return { ok: true as const };
  });
}

export async function getCorrections(studentId: string, sessionId: number, sessionDate: string) {
  return db
    .select({
      id: schema.attendanceCorrections.id,
      reason: schema.attendanceCorrections.reason,
      previous: schema.attendanceCorrections.previous,
      next: schema.attendanceCorrections.next,
      createdAt: schema.attendanceCorrections.createdAt,
      adminName: schema.admins.name,
    })
    .from(schema.attendanceCorrections)
    .innerJoin(schema.admins, eq(schema.attendanceCorrections.adminId, schema.admins.id))
    .where(
      and(
        eq(schema.attendanceCorrections.studentId, studentId),
        eq(schema.attendanceCorrections.sessionId, sessionId),
        eq(schema.attendanceCorrections.sessionDate, sessionDate),
      ),
    )
    .orderBy(desc(schema.attendanceCorrections.createdAt))
    .limit(50);
}

/** Students corrected per occurrence, for "corrected" badges. */
export async function correctedKeys(from: string, to: string): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({
      studentId: schema.attendanceCorrections.studentId,
      sessionId: schema.attendanceCorrections.sessionId,
      sessionDate: schema.attendanceCorrections.sessionDate,
    })
    .from(schema.attendanceCorrections)
    .where(sql`${schema.attendanceCorrections.sessionDate} BETWEEN ${from} AND ${to}`);
  return new Set(rows.map((r) => `${r.studentId}|${r.sessionId}|${r.sessionDate}`));
}
