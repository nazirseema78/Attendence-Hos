// Integration tests: attendance attempts, corrections and reporting against a real (in-memory)
// Postgres with the real migrations. The face engine and file storage are test doubles that exist
// only here; production code never uses them (the real engine is tested in face-engine.test.mts).
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { startTestDb } from "../test/db-harness";

const harness = await startTestDb();
const { db, schema } = await import("@/db");
const { eq, and, sql } = await import("drizzle-orm");
const attempts = await import("./attempts");
const { applyCorrection } = await import("./corrections");
const { buildRegister } = await import("./reports");
const { registerFace, getActiveEnrollment } = await import("./enrollment");
const { giveConsent } = await import("./consent");
const { FACE_MODEL_ID, FaceImageError } = await import("./face-engine");
type FaceEngine = import("./face-engine").FaceEngine;
type Analysis = import("./face-engine").Analysis;
type AttemptDeps = import("./attempts").AttemptDeps;

after(() => harness.stop());

/** Instant from Pakistan (building) wall-clock time. */
const pk = (s: string) => new Date(`${s}+05:00`);
const BUILDING_IP = "203.0.113.7";
const REF = Array.from({ length: 128 }, (_, i) => (i % 7) / 10);
/** A descriptor at exactly `d` distance from REF. */
const at = (d: number) => REF.map((v, i) => (i === 0 ? v + d : v));
const goodFace = { score: 0.99, width: 300, height: 360, brightness: 120, sharpness: 40 };

class FakeEngine implements FaceEngine {
  model = FACE_MODEL_ID;
  next: () => Analysis | Promise<Analysis> = () => this.result([{ ...goodFace, descriptor: at(0.2) }]);
  calls = 0;
  result(faces: Analysis["faces"]): Analysis {
    return { width: 720, height: 960, faces, jpeg: Buffer.from("jpeg-bytes") };
  }
  async analyze() {
    this.calls++;
    return this.next();
  }
}

class FakeStorage {
  files = new Map<string, Uint8Array>();
  failUpload = false;
  private n = 0;
  async upload(image: Uint8Array) {
    if (this.failUpload) throw new Error("fake upload failure");
    const id = `selfie-${++this.n}`;
    this.files.set(id, image);
    return id;
  }
  async remove(ids: string[]) {
    for (const id of ids) this.files.delete(id);
  }
}

let engine: FakeEngine;
let storage: FakeStorage;
let clock: Date;
let deps: AttemptDeps;
let asha: string;
let ravi: string;
let adminId: string;
let s1: number;
let s3: number;
const IMG = new Uint8Array([1, 2, 3]);

const refEngine = () => {
  const e = new FakeEngine();
  e.next = () => e.result([{ ...goodFace, descriptor: REF }]);
  return e;
};

async function addStudent(name: string, phone: string, opts: { consent?: boolean; enrolled?: boolean } = {}) {
  const [s] = await db
    .insert(schema.students)
    .values({ name, phone, guardianPhone: "+923000000000", passwordHash: "x", createdAt: pk("2026-10-01T00:00") })
    .returning({ id: schema.students.id });
  if (opts.consent !== false) await giveConsent(s.id, BUILDING_IP);
  if (opts.enrolled !== false) {
    await registerFace({ studentId: s.id, imageId: `photo-${name}`, image: IMG, adminId: null, engine: refEngine(), minScore: 0.8 });
  }
  return s.id;
}

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE attendance_corrections, attendance, attendance_attempts, rejected_attempts, face_enrollments,
      biometric_consents, students, admins, attendance_sessions, allowed_ips, settings, login_failures RESTART IDENTITY CASCADE`,
  );
  const sessions = await db
    .insert(schema.attendanceSessions)
    .values([
      { name: "Session 1", startMinute: 480, endMinute: 870 },
      { name: "Session 2", startMinute: 870, endMinute: 1260 },
      { name: "Session 3", startMinute: 1260, endMinute: 480 },
    ])
    .returning();
  s1 = sessions[0].id;
  s3 = sessions[2].id;
  await db.insert(schema.settings).values({ id: 1, graceMinutes: 30 });
  await db.insert(schema.allowedIps).values({ cidr: BUILDING_IP });
  [{ id: adminId }] = await db.insert(schema.admins).values({ name: "Warden", username: "warden", passwordHash: "x" }).returning();
  asha = await addStudent("Asha", "+923001234567");
  ravi = await addStudent("Ravi", "+923111111111");

  engine = new FakeEngine();
  storage = new FakeStorage();
  clock = pk("2026-10-20T08:10");
  deps = { engine, storage, thresholds: { maxDistance: 0.5, minScore: 0.8 }, now: () => clock };
});

async function token(studentId = asha, ip = BUILDING_IP) {
  const r = await attempts.startAttempt(studentId, ip, deps);
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as Extract<typeof r, { ok: true }>).attemptId;
}
const submit = async (studentId = asha, ip = BUILDING_IP) => attempts.submitAttempt(studentId, await token(studentId), ip, IMG, deps);
const rows = async (studentId = asha) => db.select().from(schema.attendance).where(eq(schema.attendance.studentId, studentId));
const counted = async (studentId = asha) =>
  (
    await db
      .select()
      .from(schema.attendanceAttempts)
      .where(and(eq(schema.attendanceAttempts.studentId, studentId), eq(schema.attendanceAttempts.counted, true)))
  ).length;
const mismatch = () => (engine.next = () => engine.result([{ ...goodFace, descriptor: at(0.8) }]));

describe("successful attendance", () => {
  test("matching selfie creates one Present (on time) record with evidence and metadata", async () => {
    const id = await token();
    const r = await attempts.submitAttempt(asha, id, BUILDING_IP, IMG, deps);
    assert.equal(r.ok, true, JSON.stringify(r));
    const [row] = await rows();
    assert.equal(row.state, "present");
    assert.equal(row.status, "on_time");
    assert.equal(row.method, "self");
    assert.equal(row.sessionId, s1);
    assert.equal(row.sessionDate, "2026-10-20");
    assert.equal(row.attemptId, id);
    assert.equal(row.occurrenceStart?.toISOString(), pk("2026-10-20T08:00").toISOString());
    const v = row.verification as { distance: number; model: string; enrollmentVersion: number };
    assert.equal(v.distance, 0.2);
    assert.equal(v.model, FACE_MODEL_ID);
    assert.equal(JSON.stringify(v).includes("descriptor"), false, "no biometric template in record metadata");
    assert.ok(row.selfieId && storage.files.has(row.selfieId));
    const reg = await buildRegister({ from: "2026-10-20", to: "2026-10-20", sessionId: s1, now: clock });
    assert.equal(reg.find((x) => x.studentId === asha)?.status, "on_time");
    assert.equal(reg.find((x) => x.studentId === ravi)?.status, "pending");
  });

  test("late classification uses the server time the token was issued", async () => {
    clock = pk("2026-10-20T08:45");
    const r = await submit();
    assert.equal(r.ok && r.status, "late");
  });

  test("overnight: 01:00 belongs to the previous day's night session", async () => {
    clock = pk("2026-10-21T01:00");
    await submit();
    const [row] = await rows();
    assert.equal(row.sessionId, s3);
    assert.equal(row.sessionDate, "2026-10-20");
  });

  test("success ends further submissions", async () => {
    await submit();
    const r = await attempts.startAttempt(asha, BUILDING_IP, deps);
    assert.equal(!r.ok && r.code, "already_marked");
  });
});

describe("eligibility", () => {
  test("wrong network is refused before any try is used", async () => {
    const r = await attempts.startAttempt(asha, "198.51.100.1", deps);
    assert.equal(!r.ok && r.code, "network");
    assert.equal(await counted(), 0);
  });
  test("missing face registration → 'Face registration required'", async () => {
    const id = await addStudent("NoFace", "+923220000001", { enrolled: false });
    const r = await attempts.startAttempt(id, BUILDING_IP, deps);
    assert.equal(!r.ok && r.code, "no_face_registration");
    assert.match(!r.ok ? r.message : "", /Face registration required/);
  });
  test("a registration without a descriptor from the current model counts as missing", async () => {
    await db.update(schema.faceEnrollments).set({ model: "aws-rekognition" }).where(eq(schema.faceEnrollments.studentId, asha));
    const r = await attempts.startAttempt(asha, BUILDING_IP, deps);
    assert.equal(!r.ok && r.code, "no_face_registration");
  });
  test("no consent", async () => {
    const id = await addStudent("NoConsent", "+923220000002", { consent: false });
    const r = await attempts.startAttempt(id, BUILDING_IP, deps);
    assert.equal(!r.ok && r.code, "no_consent");
  });
  test("engine unavailable fails safe", async () => {
    const r = await attempts.startAttempt(asha, BUILDING_IP, { ...deps, engine: null });
    assert.equal(!r.ok && r.code, "verification_unavailable");
  });
  test("inactive student", async () => {
    await db.update(schema.students).set({ active: false }).where(eq(schema.students.id, asha));
    const r = await attempts.startAttempt(asha, BUILDING_IP, deps);
    assert.equal(!r.ok && r.code, "inactive");
  });
});

describe("biometric rejections use up tries", () => {
  const cases: [string, () => void, string][] = [
    ["face mismatch", mismatch, "face_mismatch"],
    ["no face", () => (engine.next = () => engine.result([])), "no_face"],
    ["several faces", () => (engine.next = () => engine.result([{ ...goodFace, descriptor: at(0.1) }, { ...goodFace, descriptor: at(0.9) }])), "multiple_faces"],
    ["poor quality (too dark)", () => (engine.next = () => engine.result([{ ...goodFace, brightness: 5, descriptor: at(0.1) }])), "too_dark"],
    ["face too small", () => (engine.next = () => engine.result([{ ...goodFace, width: 50, descriptor: at(0.1) }])), "too_small"],
  ];
  for (const [name, arrange, code] of cases) {
    test(name, async () => {
      arrange();
      const r = await submit();
      assert.equal(!r.ok && r.code, code, JSON.stringify(r));
      assert.equal(!r.ok && r.attemptsLeft, 2);
      assert.equal(await counted(), 1);
      assert.equal((await rows()).length, 0);
      assert.equal(storage.files.size, 0, "rejected images are not kept");
    });
  }

  test("three rejections lock self-marking; refresh/new device/new token can't reset it", async () => {
    mismatch();
    const left: (number | undefined)[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await submit();
      left.push(!r.ok ? r.attemptsLeft : -1);
    }
    assert.deepEqual(left, [2, 1, 0]);
    // "Another device" = just another call for the same student: still locked.
    const again = await attempts.startAttempt(asha, BUILDING_IP, deps);
    assert.equal(!again.ok && again.code, "locked");
    assert.match(!again.ok ? again.message : "", /warden/);
    // The lock is per occurrence: the next session starts fresh.
    clock = pk("2026-10-20T15:00");
    engine.next = () => engine.result([{ ...goodFace, descriptor: at(0.2) }]);
    assert.equal((await submit()).ok, true);
  });

  test("admin review after lockout: audited manual mark", async () => {
    mismatch();
    for (let i = 0; i < 3; i++) await submit();
    const r = await applyCorrection({ adminId, adminIp: null, studentId: asha, sessionId: s1, sessionDate: "2026-10-20", action: "present_late", reason: "Checked in person after 3 failed face checks", now: clock });
    assert.equal(r.ok, true);
    const subs = await attempts.attemptsFor(asha, s1, "2026-10-20");
    assert.equal(subs.filter((s) => s.counted).length, 3);
  });
});

describe("technical problems never use up a try", () => {
  test("engine crash", async () => {
    engine.next = () => {
      throw new Error("wasm out of memory");
    };
    const r = await submit();
    assert.equal(!r.ok && r.code, "internal");
    assert.equal(!r.ok && r.attemptsLeft, 3);
    assert.equal(await counted(), 0);
  });
  test("unreadable image", async () => {
    engine.next = () => {
      throw new FaceImageError("invalid_image", "The file is not a readable image.");
    };
    const r = await submit();
    assert.equal(!r.ok && r.code, "invalid_image");
    assert.equal(await counted(), 0);
  });
  test("storage upload failure", async () => {
    storage.failUpload = true;
    const r = await submit();
    assert.equal(!r.ok && r.code, "internal");
    assert.equal(await counted(), 0);
    assert.equal((await rows()).length, 0);
  });
  test("network changed between token and submit", async () => {
    const id = await token();
    const r = await attempts.submitAttempt(asha, id, "198.51.100.1", IMG, deps);
    assert.equal(!r.ok && r.code, "network");
    assert.equal(await counted(), 0);
  });
  test("cancel and expiry", async () => {
    const id = await token();
    await attempts.cancelAttempt(asha, id);
    const id2 = await token();
    clock = new Date(clock.getTime() + attempts.ATTEMPT_TTL_MS + 1000);
    const r = await attempts.submitAttempt(asha, id2, BUILDING_IP, IMG, deps);
    assert.equal(!r.ok && r.code, "attempt_expired");
    assert.equal(await counted(), 0);
  });
  test("session closes while checking", async () => {
    clock = pk("2026-10-20T14:29");
    const id = await token();
    let calls = 0;
    const d: AttemptDeps = { ...deps, now: () => (++calls > 1 ? pk("2026-10-20T14:30") : pk("2026-10-20T14:29")) };
    const r = await attempts.submitAttempt(asha, id, BUILDING_IP, IMG, d);
    assert.equal(r.ok, false);
    assert.equal(await counted(), 0);
    assert.equal((await rows()).length, 0);
    assert.equal(storage.files.size, 0, "uploaded image removed");
  });
  test("registration replaced mid-attempt", async () => {
    const id = await token();
    await registerFace({ studentId: asha, imageId: "photo-new", image: IMG, adminId, engine: refEngine(), minScore: 0.8 });
    const r = await attempts.submitAttempt(asha, id, BUILDING_IP, IMG, deps);
    assert.equal(!r.ok && r.code, "registration_changed");
    assert.equal(await counted(), 0);
  });
});

describe("tokens: single use, owned, concurrency-safe", () => {
  test("another student's token is rejected", async () => {
    const id = await token(asha);
    const r = await attempts.submitAttempt(ravi, id, BUILDING_IP, IMG, deps);
    assert.equal(!r.ok && r.code, "attempt_invalid");
    assert.equal(engine.calls, 0);
  });
  test("replaying a used token: success is idempotent, a failed one can't be reused", async () => {
    const ok = await token();
    await attempts.submitAttempt(asha, ok, BUILDING_IP, IMG, deps);
    const again = await attempts.submitAttempt(asha, ok, BUILDING_IP, IMG, deps);
    assert.equal(again.ok, true);
    assert.equal(engine.calls, 1, "verified once");
    assert.equal((await rows()).length, 1);

    mismatch();
    const bad = await token(ravi);
    await attempts.submitAttempt(ravi, bad, BUILDING_IP, IMG, deps);
    const replay = await attempts.submitAttempt(ravi, bad, BUILDING_IP, IMG, deps);
    assert.equal(!replay.ok && replay.code, "attempt_invalid");
    assert.equal(await counted(ravi), 1, "replay did not use another try");
  });
  test("concurrent submits of one token record once", async () => {
    const id = await token();
    const results = await Promise.all([1, 2, 3].map(() => attempts.submitAttempt(asha, id, BUILDING_IP, IMG, deps)));
    assert.ok(results.some((r) => r.ok));
    assert.equal((await rows()).length, 1);
  });
  test("parallel tokens can't exceed the 3-try limit", async () => {
    mismatch();
    await submit();
    await submit(); // 2 counted
    // Two live tokens (e.g. two devices) racing for the last try.
    const t1 = await token();
    const [base] = await db.select().from(schema.attendanceAttempts).where(eq(schema.attendanceAttempts.id, t1));
    const t2 = crypto.randomUUID();
    await db.insert(schema.attendanceAttempts).values({ ...base, id: t2 });
    await Promise.all([attempts.submitAttempt(asha, t1, BUILDING_IP, IMG, deps), attempts.submitAttempt(asha, t2, BUILDING_IP, IMG, deps)]);
    assert.ok((await counted()) <= 3);
  });
  test("sweep: stuck verifications become technical errors (not counted); orphaned images removed", async () => {
    const id = await token();
    await db.update(schema.attendanceAttempts).set({ state: "verifying" }).where(eq(schema.attendanceAttempts.id, id));
    const other = await token(ravi);
    await db
      .update(schema.attendanceAttempts)
      .set({ state: "error", verification: { pendingSelfieId: "orphan-1" } })
      .where(eq(schema.attendanceAttempts.id, other));
    storage.files.set("orphan-1", IMG);
    const res = await attempts.sweepAttempts(storage, new Date(clock.getTime() + 60 * 60_000));
    assert.equal(res.stuck, 1);
    assert.equal(res.orphanSelfiesRemoved, 1);
    const [a] = await db.select().from(schema.attendanceAttempts).where(eq(schema.attendanceAttempts.id, id));
    assert.equal(a.state, "error");
    assert.equal(a.counted, false);
  });
});

describe("corrections, reporting and registration", () => {
  test("correction keeps evidence and records who/why/before/after", async () => {
    await submit();
    const r = await applyCorrection({ adminId, adminIp: "10.0.0.1", studentId: asha, sessionId: s1, sessionDate: "2026-10-20", action: "absent", reason: "Proxy suspected", now: clock });
    assert.equal(r.ok, true);
    const [row] = await rows();
    assert.equal(row.state, "absent");
    assert.ok(row.selfieId);
    const [c] = await db.select().from(schema.attendanceCorrections);
    assert.deepEqual(c.previous, { state: "present", status: "on_time", method: "self" });
    assert.equal(c.reason, "Proxy suspected");
  });
  test("absence is derived only after closure and never overrides Present", async () => {
    await submit();
    const reg = await buildRegister({ from: "2026-10-20", to: "2026-10-20", sessionId: s1, now: pk("2026-10-20T15:00") });
    assert.equal(reg.find((x) => x.studentId === asha)?.status, "on_time");
    assert.equal(reg.find((x) => x.studentId === ravi)?.status, "absent");
  });
  test("a rejected photo keeps the previous registration; a good one replaces it; template stays server-side", async () => {
    const before = await getActiveEnrollment(asha);
    const bad = new FakeEngine();
    bad.next = () => bad.result([]);
    assert.equal((await registerFace({ studentId: asha, imageId: "blank", image: IMG, adminId, engine: bad, minScore: 0.8 })).status, "rejected");
    assert.equal((await getActiveEnrollment(asha))?.id, before?.id);
    assert.equal((await registerFace({ studentId: asha, imageId: "new", image: IMG, adminId, engine: refEngine(), minScore: 0.8 })).status, "active");
    const active = await db
      .select()
      .from(schema.faceEnrollments)
      .where(and(eq(schema.faceEnrollments.studentId, asha), eq(schema.faceEnrollments.status, "active")));
    assert.equal(active.length, 1);
    assert.equal(active[0].descriptor?.length, 128);
    assert.equal(JSON.stringify(active[0].quality).includes("descriptor"), false);
  });
  test("without the engine a registration waits as pending", async () => {
    const id = await addStudent("Pending", "+923220000003", { enrolled: false });
    const r = await registerFace({ studentId: id, imageId: "p", image: IMG, adminId, engine: null, minScore: 0.8 });
    assert.equal(r.status, "pending");
  });
});
