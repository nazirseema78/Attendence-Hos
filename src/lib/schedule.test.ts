import { test } from "node:test";
import assert from "node:assert/strict";
import { findOverlap, formatMinute, hasSessionEnded, isValidIsoDate, resolveActiveSession, sessionEnd, sessionStart, timeInputToMinute } from "./schedule";

const sessions = [
  { id: 1, name: "Session 1", startMinute: 8 * 60, endMinute: 14 * 60 + 30 },
  { id: 2, name: "Session 2", startMinute: 14 * 60 + 30, endMinute: 21 * 60 },
  { id: 3, name: "Session 3", startMinute: 21 * 60, endMinute: 8 * 60 },
];

/** Build an instant from a Pakistan (building) wall-clock time. */
const ist = (isoLocal: string) => new Date(`${isoLocal}+05:00`);

test("morning mark inside grace period is on time", () => {
  const r = resolveActiveSession(ist("2026-10-20T08:10"), sessions, 30);
  assert.equal(r?.session.id, 1);
  assert.equal(r?.sessionDate, "2026-10-20");
  assert.equal(r?.status, "on_time");
});

test("mark exactly at the grace boundary is late", () => {
  const r = resolveActiveSession(ist("2026-10-20T08:30"), sessions, 30);
  assert.equal(r?.status, "late");
});

test("14:30 belongs to session 2, not session 1", () => {
  const r = resolveActiveSession(ist("2026-10-20T14:30"), sessions, 30);
  assert.equal(r?.session.id, 2);
  assert.equal(r?.status, "on_time");
});

test("night session before midnight uses today's date", () => {
  const r = resolveActiveSession(ist("2026-10-20T21:05"), sessions, 30);
  assert.equal(r?.session.id, 3);
  assert.equal(r?.sessionDate, "2026-10-20");
  assert.equal(r?.status, "on_time");
});

test("night session after midnight uses the previous date and is late", () => {
  const r = resolveActiveSession(ist("2026-10-21T02:00"), sessions, 30);
  assert.equal(r?.session.id, 3);
  assert.equal(r?.sessionDate, "2026-10-20");
  assert.equal(r?.minutesIntoSession, 5 * 60);
  assert.equal(r?.status, "late");
});

test("night session crosses month and year boundaries", () => {
  const r = resolveActiveSession(ist("2027-01-01T01:00"), sessions, 30);
  assert.equal(r?.sessionDate, "2026-12-31");
});

test("07:59 is still the night session, 08:00 is session 1", () => {
  assert.equal(resolveActiveSession(ist("2026-10-21T07:59"), sessions, 30)?.session.id, 3);
  assert.equal(resolveActiveSession(ist("2026-10-21T08:00"), sessions, 30)?.session.id, 1);
});

test("gap in the schedule returns null", () => {
  const partial = [{ id: 1, name: "Morning", startMinute: 8 * 60, endMinute: 9 * 60 }];
  assert.equal(resolveActiveSession(ist("2026-10-20T10:00"), partial, 30), null);
});

test("hasSessionEnded handles the overnight session", () => {
  const night = sessions[2];
  assert.equal(hasSessionEnded(night, "2026-10-20", ist("2026-10-21T07:59")), false);
  assert.equal(hasSessionEnded(night, "2026-10-20", ist("2026-10-21T08:00")), true);
});

test("the agreed schedule has no overlap", () => {
  assert.equal(findOverlap(sessions), null);
});

test("overlapping sessions are detected", () => {
  const bad = [...sessions.slice(0, 2), { ...sessions[2], endMinute: 8 * 60 + 30 }];
  assert.match(findOverlap(bad) ?? "", /overlaps/);
});

test("time formatting and parsing", () => {
  assert.equal(formatMinute(870), "2:30 PM");
  assert.equal(formatMinute(0), "12:00 AM");
  assert.equal(formatMinute(720), "12:00 PM");
  assert.equal(timeInputToMinute("21:00"), 1260);
  assert.equal(timeInputToMinute("25:00"), null);
});

test("night session window spans midnight", () => {
  const night = sessions[2];
  assert.equal(sessionStart(night, "2026-10-19").getTime(), ist("2026-10-19T21:00").getTime());
  assert.equal(sessionEnd(night, "2026-10-19").getTime(), ist("2026-10-20T08:00").getTime());
});

test("only real calendar dates are accepted from URLs", () => {
  assert.equal(isValidIsoDate("2026-10-19"), true);
  assert.equal(isValidIsoDate("2028-02-29"), true);
  for (const bad of ["2026-02-30", "2026-13-01", "2026-1-1", "garbage", "", "1999-12-31", "2101-01-01", undefined, ["2026-10-19"]]) {
    assert.equal(isValidIsoDate(bad), false, String(bad));
  }
});

test("boundary instants: end is exclusive, next session's start is inclusive", () => {
  const at = (iso: string) => resolveActiveSession(ist(iso), sessions, 30)?.session.id;
  assert.equal(at("2026-10-20T14:29"), 1);
  assert.equal(at("2026-10-20T14:30"), 2);
  assert.equal(at("2026-10-20T20:59"), 2);
  assert.equal(at("2026-10-20T21:00"), 3);
});

test("a server running in another timezone still resolves building-time sessions", () => {
  // The same instant expressed in UTC: 20:00Z on 19 Oct is 01:00 PKT on 20 Oct.
  const r = resolveActiveSession(new Date("2026-10-19T20:00:00Z"), sessions, 30);
  assert.equal(r?.session.id, 3);
  assert.equal(r?.sessionDate, "2026-10-19");
});
