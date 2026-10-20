// Pure scheduling logic. Session times are wall-clock minutes in the building's time zone
// (see ./timezone.ts); occurrences are converted to absolute instants with that zone's rules.
// Intervals are start-inclusive, end-exclusive.

import { BUILDING_TIME_ZONE, buildingToday, wallClock, zonedTimeToUtc } from "./timezone";

export const MINUTES_PER_DAY = 1440;

export type SessionWindow = {
  id: number;
  name: string;
  /** Minutes since local midnight at the building, 0–1439. */
  startMinute: number;
  /** Minutes since local midnight, 0–1439. end <= start means the session crosses midnight. */
  endMinute: number;
};

export type ActiveSession<S extends SessionWindow = SessionWindow> = {
  session: S;
  /** Local calendar date (YYYY-MM-DD) on which this occurrence of the session started. */
  sessionDate: string;
  minutesIntoSession: number;
  status: "on_time" | "late";
};

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today's date at the building, YYYY-MM-DD. */
export const localToday = buildingToday;

function crossesMidnight(s: SessionWindow): boolean {
  return s.endMinute <= s.startMinute;
}

/** Nominal wall-clock length (used for overlap checks; real length can differ on DST days). */
export function sessionDurationMinutes(s: SessionWindow): number {
  return crossesMidnight(s) ? MINUTES_PER_DAY - s.startMinute + s.endMinute : s.endMinute - s.startMinute;
}

/** The instant the occurrence of `session` on local date `sessionDate` starts. */
export function sessionStart(session: SessionWindow, sessionDate: string, zone = BUILDING_TIME_ZONE): Date {
  return zonedTimeToUtc(sessionDate, session.startMinute, zone);
}

/** The instant the occurrence of `session` on local date `sessionDate` ends (exclusive). */
export function sessionEnd(session: SessionWindow, sessionDate: string, zone = BUILDING_TIME_ZONE): Date {
  const endDate = crossesMidnight(session) ? addDays(sessionDate, 1) : sessionDate;
  return zonedTimeToUtc(endDate, session.endMinute, zone);
}

/** Whether the occurrence of `session` that started on `sessionDate` has already ended at `now`. */
export function hasSessionEnded(session: SessionWindow, sessionDate: string, now: Date, zone = BUILDING_TIME_ZONE): boolean {
  return now.getTime() >= sessionEnd(session, sessionDate, zone).getTime();
}

/** The session open at `now`, which date it belongs to, and whether a mark now is on time or late. */
export function resolveActiveSession<S extends SessionWindow>(
  now: Date,
  sessions: S[],
  graceMinutes: number,
  zone = BUILDING_TIME_ZONE,
): ActiveSession<S> | null {
  const { date, minute } = wallClock(now, zone);

  for (const session of sessions) {
    let sessionDate: string | null = null;
    if (!crossesMidnight(session)) {
      if (minute >= session.startMinute && minute < session.endMinute) sessionDate = date;
    } else if (minute >= session.startMinute) {
      sessionDate = date;
    } else if (minute < session.endMinute) {
      // After midnight: this occurrence started the previous day.
      sessionDate = addDays(date, -1);
    }

    if (sessionDate) {
      // Elapsed time from absolute instants, so DST days are measured correctly.
      const elapsed = Math.floor((now.getTime() - sessionStart(session, sessionDate, zone).getTime()) / 60_000);
      return {
        session,
        sessionDate,
        minutesIntoSession: elapsed,
        status: elapsed < graceMinutes ? "on_time" : "late",
      };
    }
  }
  return null;
}

/** Inclusive list of dates from `from` to `to` (YYYY-MM-DD). */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD form (rejects e.g. 2026-02-30), within a sane range. */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value && value >= "2000-01-01" && value <= "2100-12-31";
}

/** Returns an error message if any two sessions overlap, otherwise null. */
export function findOverlap(sessions: SessionWindow[]): string | null {
  const owner: (string | undefined)[] = new Array(MINUTES_PER_DAY);
  for (const s of sessions) {
    const duration = sessionDurationMinutes(s);
    if (duration <= 0) return `"${s.name}" must have different start and end times.`;
    for (let i = 0; i < duration; i++) {
      const m = (s.startMinute + i) % MINUTES_PER_DAY;
      const existing = owner[m];
      if (existing !== undefined) {
        return `"${s.name}" overlaps with "${existing}" at ${formatMinute(m)}.`;
      }
      owner[m] = s.name;
    }
  }
  return null;
}

/** 870 -> "2:30 PM" */
export function formatMinute(minute: number): string {
  const h24 = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** 870 -> "14:30" (for <input type="time">) */
export function minuteToTimeInput(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** "14:30" -> 870, or null if malformed. */
export function timeInputToMinute(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
