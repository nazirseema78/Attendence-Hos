import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getGraceMinutes, getSessions } from "./config";
import { formatMinute, localToday, resolveActiveSession, sessionEnd, sessionStart } from "./schedule";

// Self-marking lives in ./attempts.ts. This module only reads, for the student's own page.

type Rec = { state: "present" | "absent"; status: "on_time" | "late" | null; markedAt: Date; method: "self" | "staff" };

export type StudentToday = {
  active: {
    sessionId: number;
    name: string;
    sessionDate: string;
    window: string;
    status: "on_time" | "late";
    onTimeUntil: string;
    closesAt: Date;
  } | null;
  record: Rec | null;
  /** The sessions of the current day, as cards. */
  day: { sessionId: number; name: string; window: string; state: "upcoming" | "open" | "closed"; record: Rec | null }[];
  dayDate: string;
};

/** The student's own sessions for the current day and the open one, from server time in the building zone. */
export async function getStudentToday(studentId: string, now: Date = new Date()): Promise<StudentToday> {
  const [sessions, graceMinutes] = await Promise.all([getSessions(), getGraceMinutes()]);
  const active = resolveActiveSession(now, sessions, graceMinutes);
  // The "day" shown is the occurrence date of the open session (so 01:00 still shows last night's set).
  const dayDate = active?.sessionDate ?? localToday(now);

  const records = await db
    .select({
      sessionId: schema.attendance.sessionId,
      state: schema.attendance.state,
      status: schema.attendance.status,
      markedAt: schema.attendance.markedAt,
      method: schema.attendance.method,
    })
    .from(schema.attendance)
    .where(and(eq(schema.attendance.studentId, studentId), eq(schema.attendance.sessionDate, dayDate)));
  const bySession = new Map(records.map((r) => [r.sessionId, r as Rec]));
  const window = (s: (typeof sessions)[number]) => `${formatMinute(s.startMinute)} – ${formatMinute(s.endMinute)}`;

  return {
    active: active
      ? {
          sessionId: active.session.id,
          name: active.session.name,
          sessionDate: active.sessionDate,
          window: window(active.session),
          status: active.status,
          onTimeUntil: formatMinute((active.session.startMinute + graceMinutes) % 1440),
          closesAt: sessionEnd(active.session, active.sessionDate),
        }
      : null,
    record: active ? (bySession.get(active.session.id) ?? null) : null,
    dayDate,
    day: sessions.map((s) => ({
      sessionId: s.id,
      name: s.name,
      window: window(s),
      state: now < sessionStart(s, dayDate) ? "upcoming" : now >= sessionEnd(s, dayDate) ? "closed" : "open",
      record: bySession.get(s.id) ?? null,
    })),
  };
}

/** The student's own recent attendance. */
export async function getStudentHistory(studentId: string, limit = 15) {
  return db
    .select({
      id: schema.attendance.id,
      sessionDate: schema.attendance.sessionDate,
      sessionName: schema.attendanceSessions.name,
      state: schema.attendance.state,
      status: schema.attendance.status,
      markedAt: schema.attendance.markedAt,
      method: schema.attendance.method,
    })
    .from(schema.attendance)
    .innerJoin(schema.attendanceSessions, eq(schema.attendance.sessionId, schema.attendanceSessions.id))
    .where(eq(schema.attendance.studentId, studentId))
    .orderBy(desc(schema.attendance.markedAt))
    .limit(limit);
}
