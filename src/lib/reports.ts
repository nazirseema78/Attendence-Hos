import "server-only";
import { and, desc, eq, gte, lt, lte, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSessions } from "./config";
import { dateRange, hasSessionEnded, sessionEnd, sessionStart } from "./schedule";

/**
 * Register status of one student for one occurrence:
 * - on_time / late: Present (self-marked after verification, or marked by staff)
 * - pending: occurrence is open and nothing is recorded yet ("Not marked yet")
 * - absent: occurrence has closed with no Present record, or staff recorded Absent.
 * Absence is derived at read time, so there is no closure job that could race a late
 * self-mark or overwrite a Present record; writes are refused once an occurrence closes.
 */
export type RegisterStatus = "on_time" | "late" | "absent" | "pending";

export type RegisterRow = {
  sessionDate: string;
  sessionId: number;
  sessionName: string;
  studentId: string;
  studentName: string;
  phone: string;
  hasPhoto: boolean;
  status: RegisterStatus;
  attendanceId: string | null;
  markedAt: Date | null;
  ip: string | null;
  hasSelfie: boolean;
  method: "self" | "staff" | null;
  /** Face descriptor distance for self-marks (lower = closer match), for admin review. */
  distance: number | null;
};

export const MAX_REGISTER_DAYS = 62;

/**
 * One row per (date, session, student) for sessions that have started.
 * A student is expected in every session that had not yet ended when they were added;
 * inactive students only appear where they actually have a record.
 */
export async function buildRegister(opts: {
  from: string;
  to: string;
  studentId?: string;
  sessionId?: number;
  now?: Date;
  /** Pass already-loaded sessions to save a database round trip. */
  sessions?: Awaited<ReturnType<typeof getSessions>>;
}): Promise<RegisterRow[]> {
  const now = opts.now ?? new Date();
  const filters: SQL[] = [gte(schema.attendance.sessionDate, opts.from), lte(schema.attendance.sessionDate, opts.to)];
  if (opts.studentId) filters.push(eq(schema.attendance.studentId, opts.studentId));
  if (opts.sessionId !== undefined) filters.push(eq(schema.attendance.sessionId, opts.sessionId));

  // Independent queries run in parallel: each round trip to the database costs ~200 ms from India.
  const [allSessions, students, records] = await Promise.all([
    opts.sessions ?? getSessions(),
    db
      .select({
        id: schema.students.id,
        name: schema.students.name,
        phone: schema.students.phone,
        active: schema.students.active,
        createdAt: schema.students.createdAt,
        photoId: schema.students.photoId,
      })
      .from(schema.students)
      .where(opts.studentId ? eq(schema.students.id, opts.studentId) : undefined)
      .orderBy(schema.students.name),
    db
      .select({
        id: schema.attendance.id,
        studentId: schema.attendance.studentId,
        sessionId: schema.attendance.sessionId,
        sessionDate: schema.attendance.sessionDate,
        status: schema.attendance.status,
        markedAt: schema.attendance.markedAt,
        ip: schema.attendance.ip,
        selfieId: schema.attendance.selfieId,
        state: schema.attendance.state,
        method: schema.attendance.method,
        distance: sql<number | null>`(${schema.attendance.verification}->>'distance')::float`,
      })
      .from(schema.attendance)
      .where(and(...filters)),
  ]);
  const sessions = allSessions.filter((s) => opts.sessionId === undefined || s.id === opts.sessionId);

  const byKey = new Map(records.map((r) => [`${r.studentId}|${r.sessionId}|${r.sessionDate}`, r]));
  const rows: RegisterRow[] = [];

  for (const date of dateRange(opts.from, opts.to)) {
    for (const session of sessions) {
      if (sessionStart(session, date) > now) continue;
      const ended = hasSessionEnded(session, date, now);
      const end = sessionEnd(session, date);

      for (const student of students) {
        const rec = byKey.get(`${student.id}|${session.id}|${date}`);
        if (!rec && (!student.active || student.createdAt >= end)) continue;

        rows.push({
          sessionDate: date,
          sessionId: session.id,
          sessionName: session.name,
          studentId: student.id,
          studentName: student.name,
          phone: student.phone,
          hasPhoto: Boolean(student.photoId),
          status: rec ? (rec.state === "absent" || !rec.status ? "absent" : rec.status) : ended ? "absent" : "pending",
          attendanceId: rec?.id ?? null,
          markedAt: rec?.markedAt ?? null,
          ip: rec?.ip ?? null,
          hasSelfie: Boolean(rec?.selfieId),
          method: rec?.method ?? null,
          distance: rec?.distance ?? null,
        });
      }
    }
  }
  return rows;
}

/** Rejected attempts in [start, end), newest first. */
export async function getRejectedAttempts(start: Date, end: Date, limit = 100) {
  return db
    .select({
      id: schema.rejectedAttempts.id,
      at: schema.rejectedAttempts.at,
      ip: schema.rejectedAttempts.ip,
      reason: schema.rejectedAttempts.reason,
      studentName: schema.students.name,
    })
    .from(schema.rejectedAttempts)
    .leftJoin(schema.students, eq(schema.rejectedAttempts.studentId, schema.students.id))
    .where(and(gte(schema.rejectedAttempts.at, start), lt(schema.rejectedAttempts.at, end)))
    .orderBy(desc(schema.rejectedAttempts.at))
    .limit(limit);
}
