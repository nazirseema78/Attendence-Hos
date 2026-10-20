import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveActiveSession, sessionEnd, sessionStart } from "./schedule";
import { BUILDING_TIME_ZONE, wallClock, zonedTimeToUtc } from "./timezone";

const iso = (d: Date) => d.toISOString();
const night = { id: 3, name: "Night", startMinute: 21 * 60, endMinute: 8 * 60 };

test("the building zone defaults to Pakistan", () => {
  assert.equal(BUILDING_TIME_ZONE, "Asia/Karachi");
});

test("Pakistan wall time converts at UTC+5", () => {
  assert.equal(iso(zonedTimeToUtc("2026-10-20", 8 * 60, "Asia/Karachi")), "2026-10-20T03:00:00.000Z");
  assert.deepEqual(wallClock(new Date("2026-10-19T20:00:00Z"), "Asia/Karachi"), { date: "2026-10-20", minute: 60, second: 0 });
});

test("India would differ by 30 minutes (guards against the earlier hard-coded IST)", () => {
  assert.equal(iso(zonedTimeToUtc("2026-10-20", 8 * 60, "Asia/Kolkata")), "2026-10-20T02:30:00.000Z");
});

test("DST: overnight session across the US spring-forward is one hour shorter", () => {
  const z = "America/New_York";
  // 2026-03-08 02:00 EST jumps to 03:00 EDT.
  assert.equal(iso(sessionStart(night, "2026-03-07", z)), "2026-03-08T02:00:00.000Z"); // 21:00 EST
  assert.equal(iso(sessionEnd(night, "2026-03-07", z)), "2026-03-08T12:00:00.000Z"); // 08:00 EDT
  const hours = (sessionEnd(night, "2026-03-07", z).getTime() - sessionStart(night, "2026-03-07", z).getTime()) / 3_600_000;
  assert.equal(hours, 10);
});

test("DST: overnight session across the US fall-back is one hour longer", () => {
  const z = "America/New_York";
  // 2026-11-01 02:00 EDT falls back to 01:00 EST.
  const hours = (sessionEnd(night, "2026-10-31", z).getTime() - sessionStart(night, "2026-10-31", z).getTime()) / 3_600_000;
  assert.equal(hours, 12);
});

test("DST: a wall time inside the spring-forward gap shifts forward", () => {
  // 02:30 does not exist in New York on 2026-03-08; it resolves to 03:30 EDT.
  assert.equal(iso(zonedTimeToUtc("2026-03-08", 2 * 60 + 30, "America/New_York")), "2026-03-08T07:30:00.000Z");
});

test("DST: a repeated wall time resolves to its first occurrence", () => {
  // 01:30 happens twice in New York on 2026-11-01; the first is 01:30 EDT = 05:30Z.
  assert.equal(iso(zonedTimeToUtc("2026-11-01", 90, "America/New_York")), "2026-11-01T05:30:00.000Z");
});

test("DST: lateness is measured in real minutes", () => {
  const z = "Europe/London";
  // 2026-03-29 01:00 GMT jumps to 02:00 BST. 21:00 the previous evening + 30 min grace.
  const r = resolveActiveSession(new Date("2026-03-29T01:15:00Z"), [night], 30, z); // 02:15 BST
  assert.equal(r?.sessionDate, "2026-03-28");
  assert.equal(r?.minutesIntoSession, 255); // 21:00 GMT → 01:15Z is 4h15m
});
