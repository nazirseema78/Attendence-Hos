import "server-only";
import { randomUUID } from "node:crypto";
import { and, count, eq, gt, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { deletePrivate, uploadPrivate } from "./cloudinary";
import { getAllowlist, getGraceMinutes, getSessions } from "./config";
import { hasActiveConsent } from "./consent";
import { getActiveEnrollment, type Enrollment } from "./enrollment";
import { faceConfigStatus, getVerifier } from "./face";
import { FaceImageError, type FaceEngine } from "./face-engine";
import { assessFaces, decideMatch, euclideanDistance, PRESENCE_SCORE, type Thresholds } from "./face-policy";
import { isIpAllowed } from "./ip";
import { resolveActiveSession, sessionEnd, sessionStart } from "./schedule";

/*
 * Attendance attempts: the only way a student marks their own attendance.
 *
 *   start   → server checks eligibility and issues a single-use token (5 min) bound to the
 *             student and the open session occurrence. Starting never uses up a try.
 *   (browser previews / captures / retakes locally; nothing is sent until Submit)
 *   submit  → server claims the token atomically, re-checks eligibility, analyses the image itself
 *             (face-api on the server), compares it 1:1 with the student's active registration,
 *             stores it privately, then writes attendance in a transaction guarded by the unique
 *             (student, session, session_date) index.
 *
 * At most MAX_FAILED_ATTEMPTS biometric rejections per student per occurrence ("counted" attempts).
 * Technical failures, invalid files, cancellations and expired tokens never count.
 * Identity comes from the authenticated session; the browser sends only the token and the image.
 */

export type Storage = {
  upload(image: Uint8Array, folder: string): Promise<string>;
  remove(ids: string[]): Promise<void>;
};

export type AttemptDeps = {
  engine: FaceEngine | null;
  storage: Storage;
  thresholds: Thresholds;
  now: () => Date;
};

export function defaultDeps(): AttemptDeps {
  return {
    engine: getVerifier(),
    storage: {
      upload: async (image, folder) => (await uploadPrivate(Buffer.from(image), folder)).public_id,
      remove: deletePrivate,
    },
    thresholds: faceConfigStatus().thresholds,
    now: () => new Date(),
  };
}

export const MAX_FAILED_ATTEMPTS = 3;
export const ATTEMPT_TTL_MS = 5 * 60_000;
/** Tokens a student may request per occurrence (anti-abuse; unrelated to the 3 counted tries). */
export const MAX_TOKENS_PER_OCCURRENCE = 30;
/** A verification older than this is treated as abandoned (crashed request). */
const STUCK_VERIFYING_MS = 3 * 60_000;

export type ProblemCode =
  | "inactive"
  | "network"
  | "no_session"
  | "already_marked"
  | "no_consent"
  | "no_face_registration"
  | "verification_unavailable"
  | "locked"
  | "too_many_requests"
  | "attempt_invalid"
  | "attempt_expired"
  | "in_progress"
  | "session_changed"
  | "session_closed"
  | "registration_changed"
  | "invalid_image"
  | "no_face"
  | "multiple_faces"
  | "unclear"
  | "too_small"
  | "too_dark"
  | "too_bright"
  | "too_blurry"
  | "face_mismatch"
  | "internal";

export type Problem = {
  ok: false;
  code: ProblemCode;
  message: string;
  retryable: boolean;
  /** Counted tries left for this occurrence, when known. */
  attemptsLeft?: number;
};

export type Marked = {
  ok: true;
  sessionName: string;
  sessionDate: string;
  status: "on_time" | "late";
  markedAt: string;
};

const problem = (code: ProblemCode, message: string, retryable = false, attemptsLeft?: number): Problem => ({
  ok: false,
  code,
  message,
  retryable,
  ...(attemptsLeft !== undefined && { attemptsLeft }),
});

const lockedMessage = () =>
  `You have used all ${MAX_FAILED_ATTEMPTS} face-check tries for this session. Ask the warden to review and mark your attendance.`;

type Occurrence = { sessionId: number; sessionName: string; sessionDate: string; start: Date; end: Date };
type Eligible = { ok: true; occurrence: Occurrence; enrollment: Enrollment; graceMinutes: number; attemptsLeft: number };

async function countedFailures(studentId: string, sessionId: number, sessionDate: string, conn: Pick<typeof db, "select"> = db) {
  const [{ n }] = await conn
    .select({ n: count() })
    .from(schema.attendanceAttempts)
    .where(
      and(
        eq(schema.attendanceAttempts.studentId, studentId),
        eq(schema.attendanceAttempts.sessionId, sessionId),
        eq(schema.attendanceAttempts.sessionDate, sessionDate),
        eq(schema.attendanceAttempts.counted, true),
      ),
    );
  return n;
}

/** Every rule a self-mark must satisfy. Runs before capture and again just before writing. */
export async function checkEligibility(
  studentId: string,
  ip: string | null,
  now: Date,
  deps: Pick<AttemptDeps, "engine">,
): Promise<Eligible | Problem> {
  const [student] = await db
    .select({ active: schema.students.active })
    .from(schema.students)
    .where(eq(schema.students.id, studentId));
  if (!student?.active) return problem("inactive", "Your account is not active. Contact the warden.");

  const allowlist = (await getAllowlist()).map((r) => r.cidr);
  if (allowlist.length === 0) {
    return problem("network", "The building network has not been configured yet. Ask the warden to add it in Settings.");
  }
  if (!ip || !isIpAllowed(ip, allowlist)) {
    return problem(
      "network",
      "You are not on the hostel Wi-Fi. Turn off mobile data, connect to the hostel Wi-Fi and try again.",
      true,
    );
  }

  const [sessions, graceMinutes] = await Promise.all([getSessions(), getGraceMinutes()]);
  const active = resolveActiveSession(now, sessions, graceMinutes);
  if (!active) return problem("no_session", "No attendance session is open right now.");
  const occurrence: Occurrence = {
    sessionId: active.session.id,
    sessionName: active.session.name,
    sessionDate: active.sessionDate,
    start: sessionStart(active.session, active.sessionDate),
    end: sessionEnd(active.session, active.sessionDate),
  };

  const [existing] = await db
    .select({ id: schema.attendance.id })
    .from(schema.attendance)
    .where(
      and(
        eq(schema.attendance.studentId, studentId),
        eq(schema.attendance.sessionId, occurrence.sessionId),
        eq(schema.attendance.sessionDate, occurrence.sessionDate),
      ),
    );
  if (existing) return problem("already_marked", `Attendance for ${occurrence.sessionName} is already recorded.`);

  if (!(await hasActiveConsent(studentId))) {
    return problem("no_consent", "Please read and accept the face-check notice first.");
  }
  const enrollment = await getActiveEnrollment(studentId);
  if (!enrollment) {
    return problem(
      "no_face_registration",
      "Face registration required. Ask the warden to upload a clear photo of you before marking attendance.",
    );
  }
  if (!deps.engine) {
    return problem(
      "verification_unavailable",
      "Face verification is not available right now, so attendance can't be marked here. Ask the warden to mark you.",
    );
  }
  const used = await countedFailures(studentId, occurrence.sessionId, occurrence.sessionDate);
  if (used >= MAX_FAILED_ATTEMPTS) return problem("locked", lockedMessage(), false, 0);

  return { ok: true, occurrence, enrollment, graceMinutes, attemptsLeft: MAX_FAILED_ATTEMPTS - used };
}

async function logRejection(studentId: string, ip: string | null, reason: string, attemptId?: string) {
  await db.insert(schema.rejectedAttempts).values({ studentId, ip: ip ?? "unknown", reason, attemptId });
}

export type Started = { ok: true; attemptId: string; expiresAt: string; attemptsLeft: number };

/** Issue a submission token. Never consumes one of the counted tries. */
export async function startAttempt(studentId: string, ip: string | null, deps: AttemptDeps): Promise<Started | Problem> {
  const now = deps.now();
  const e = await checkEligibility(studentId, ip, now, deps);
  if (!e.ok) {
    if (e.code !== "already_marked" && e.code !== "locked") await logRejection(studentId, ip, e.message);
    return e;
  }
  const { occurrence } = e;

  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.attendanceAttempts)
    .where(
      and(
        eq(schema.attendanceAttempts.studentId, studentId),
        eq(schema.attendanceAttempts.sessionId, occurrence.sessionId),
        eq(schema.attendanceAttempts.sessionDate, occurrence.sessionDate),
      ),
    );
  if (n >= MAX_TOKENS_PER_OCCURRENCE) {
    return problem("too_many_requests", "Too many tries for this session. Ask the warden to mark you.", false, e.attemptsLeft);
  }

  // One open token per student: a new one replaces any unused one (e.g. another tab or device).
  await db
    .update(schema.attendanceAttempts)
    .set({ state: "cancelled", finishedAt: now, failureReason: "Replaced by a new token" })
    .where(and(eq(schema.attendanceAttempts.studentId, studentId), eq(schema.attendanceAttempts.state, "created")));

  const attemptId = randomUUID();
  const expiresAt = new Date(now.getTime() + ATTEMPT_TTL_MS);
  await db.insert(schema.attendanceAttempts).values({
    id: attemptId,
    studentId,
    sessionId: occurrence.sessionId,
    sessionDate: occurrence.sessionDate,
    occurrenceStart: occurrence.start,
    occurrenceEnd: occurrence.end,
    enrollmentId: e.enrollment.id,
    ip: ip!,
    createdAt: now,
    expiresAt,
  });
  return { ok: true, attemptId, expiresAt: expiresAt.toISOString(), attemptsLeft: e.attemptsLeft };
}

type AttemptRow = typeof schema.attendanceAttempts.$inferSelect;
type Claim = { ok: true; attempt: AttemptRow } | { ok: false; result: Marked | Problem };

/** Atomically turn a live token into a verification, enforcing ownership, expiry, single use and the try limit. */
async function claim(studentId: string, attemptId: string, now: Date): Promise<Claim> {
  const r = await claimInTransaction(studentId, attemptId, now);
  // Explaining an already-used token reads other tables: do it after the transaction (and its lock) ends.
  if ("used" in r) return { ok: false, result: await explainUsed(r.used) };
  return r;
}

async function claimInTransaction(studentId: string, attemptId: string, now: Date): Promise<Claim | { used: AttemptRow }> {
  return db.transaction(async (tx) => {
    // Serialise all claims of one student (several tabs/devices) so the try limit can't be raced.
    await tx.execute(sql`SELECT 1 FROM ${schema.students} WHERE ${schema.students.id} = ${studentId} FOR UPDATE`);

    const [a] = await tx
      .select()
      .from(schema.attendanceAttempts)
      .where(and(eq(schema.attendanceAttempts.id, attemptId), eq(schema.attendanceAttempts.studentId, studentId)));
    if (!a) return { ok: false as const, result: problem("attempt_invalid", "This check was not found. Please start again.", true) };
    if (a.state !== "created") return { used: a };
    if (a.expiresAt <= now) {
      await tx
        .update(schema.attendanceAttempts)
        .set({ state: "expired", finishedAt: now })
        .where(eq(schema.attendanceAttempts.id, a.id));
      return { ok: false as const, result: problem("attempt_expired", "This check expired. Please submit again.", true) };
    }

    const [inFlight] = await tx
      .select({ id: schema.attendanceAttempts.id })
      .from(schema.attendanceAttempts)
      .where(
        and(
          eq(schema.attendanceAttempts.studentId, studentId),
          eq(schema.attendanceAttempts.state, "verifying"),
          gt(schema.attendanceAttempts.createdAt, new Date(now.getTime() - ATTEMPT_TTL_MS - STUCK_VERIFYING_MS)),
        ),
      )
      .limit(1);
    if (inFlight) {
      return { ok: false as const, result: problem("in_progress", "Another face check is still running. Please wait a moment.", true) };
    }

    const used = await countedFailures(studentId, a.sessionId, a.sessionDate, tx);
    if (used >= MAX_FAILED_ATTEMPTS) {
      await tx
        .update(schema.attendanceAttempts)
        .set({ state: "cancelled", finishedAt: now, failureReason: "Try limit reached" })
        .where(eq(schema.attendanceAttempts.id, a.id));
      return { ok: false as const, result: problem("locked", lockedMessage(), false, 0) };
    }

    const [claimed] = await tx
      .update(schema.attendanceAttempts)
      .set({ state: "verifying" })
      .where(and(eq(schema.attendanceAttempts.id, a.id), eq(schema.attendanceAttempts.state, "created")))
      .returning();
    return { ok: true as const, attempt: claimed };
  });
}

/** Result for a token that was already used: idempotent success, or why it can't be reused. */
async function explainUsed(a: AttemptRow): Promise<Marked | Problem> {
  if (a.state === "succeeded") {
    const [rec] = await db
      .select({ status: schema.attendance.status, markedAt: schema.attendance.markedAt, sessionName: schema.attendanceSessions.name })
      .from(schema.attendance)
      .innerJoin(schema.attendanceSessions, eq(schema.attendance.sessionId, schema.attendanceSessions.id))
      .where(eq(schema.attendance.attemptId, a.id));
    if (rec?.status) {
      return { ok: true, sessionName: rec.sessionName, sessionDate: a.sessionDate, status: rec.status, markedAt: rec.markedAt.toISOString() };
    }
  }
  if (a.state === "verifying") return problem("in_progress", "This face check is still running. Please wait a moment.", true);
  return problem("attempt_invalid", "This check has already been used. Please submit again.", true);
}

/**
 * Verify one submitted image. `image` must already be size/type-checked by the caller; its real
 * content is decoded and validated again here.
 */
export async function submitAttempt(
  studentId: string,
  attemptId: string,
  ip: string | null,
  image: Uint8Array,
  deps: AttemptDeps,
): Promise<Marked | Problem> {
  const now = deps.now();
  const c = await claim(studentId, attemptId, now);
  if (!c.ok) return c.result;
  const attempt = c.attempt;

  let uploaded: string | null = null;
  const left = async () =>
    Math.max(0, MAX_FAILED_ATTEMPTS - (await countedFailures(studentId, attempt.sessionId, attempt.sessionDate)));

  /** End the attempt. `counted` = a biometric rejection that uses up a try. */
  const finish = async (p: Problem, opts: { counted: boolean; state: "failed" | "error"; verification?: unknown }) => {
    await db
      .update(schema.attendanceAttempts)
      .set({
        state: opts.state,
        counted: opts.counted,
        finishedAt: deps.now(),
        failureReason: p.message,
        ...(opts.verification ? { verification: opts.verification } : {}),
      })
      .where(eq(schema.attendanceAttempts.id, attempt.id));
    await logRejection(studentId, ip, p.message, attempt.id);
    if (uploaded) await deps.storage.remove([uploaded]).catch(() => {});
    const attemptsLeft = await left();
    if (opts.counted && attemptsLeft === 0) return problem(p.code, `${p.message} ${lockedMessage()}`, false, 0);
    return { ...p, attemptsLeft };
  };
  const technical = (p: Problem, verification?: unknown) => finish(p, { counted: false, state: "error", verification });
  const rejected = (p: Problem, verification: unknown) => finish(p, { counted: true, state: "failed", verification });
  // Filled in as checks run, so even a later technical failure keeps the evidence for admin review.
  let meta: Record<string, unknown> | undefined;

  try {
    const e = await checkEligibility(studentId, ip, now, deps);
    if (!e.ok) return technical(e);
    if (e.occurrence.sessionId !== attempt.sessionId || e.occurrence.sessionDate !== attempt.sessionDate) {
      return technical(problem("session_changed", "The session changed. Please submit again for the new session.", true));
    }
    if (e.enrollment.id !== attempt.enrollmentId) {
      return technical(problem("registration_changed", "Your face registration changed. Please submit again.", true));
    }

    let analysis;
    try {
      analysis = await deps.engine!.analyze(image);
    } catch (err) {
      if (err instanceof FaceImageError) return technical(problem("invalid_image", err.message, true));
      throw err;
    }

    const faces = analysis.faces.map(({ descriptor: _d, ...f }) => f); // eslint-disable-line @typescript-eslint/no-unused-vars
    meta = {
      model: deps.engine!.model,
      thresholds: deps.thresholds,
      enrollmentId: e.enrollment.id,
      enrollmentVersion: e.enrollment.version,
      image: { width: analysis.width, height: analysis.height },
      faces,
    };

    const check = assessFaces(analysis.faces, analysis, "attendance", deps.thresholds.minScore);
    if (!check.ok) return rejected(problem(check.code, check.message, true), meta);

    const face = analysis.faces.find((f) => f.score >= PRESENCE_SCORE)!;
    const distance = euclideanDistance(face.descriptor, e.enrollment.descriptor!);
    meta.distance = Number(distance.toFixed(4));
    meta.decidedAt = deps.now().toISOString();
    const decision = decideMatch(distance, deps.thresholds);
    if (!decision.ok) return rejected(problem(decision.code, decision.message, true), meta);

    // Store the server-normalised JPEG (no EXIF/GPS metadata) as private evidence.
    uploaded = await deps.storage.upload(analysis.jpeg, `attendance/selfies/${attempt.sessionDate}`);
    await db
      .update(schema.attendanceAttempts)
      .set({ verification: { ...meta, pendingSelfieId: uploaded } })
      .where(eq(schema.attendanceAttempts.id, attempt.id));

    const punctuality: "on_time" | "late" =
      attempt.createdAt.getTime() - attempt.occurrenceStart.getTime() < e.graceMinutes * 60_000 ? "on_time" : "late";

    const outcome = await db.transaction(async (tx) => {
      const writeNow = deps.now();
      if (writeNow >= attempt.occurrenceEnd) return { kind: "closed" as const };
      const inserted = await tx
        .insert(schema.attendance)
        .values({
          studentId,
          sessionId: attempt.sessionId,
          sessionDate: attempt.sessionDate,
          state: "present",
          status: punctuality,
          method: "self",
          attemptId: attempt.id,
          occurrenceStart: attempt.occurrenceStart,
          occurrenceEnd: attempt.occurrenceEnd,
          verification: meta,
          markedAt: writeNow,
          ip: ip!,
          selfieId: uploaded,
        })
        .onConflictDoNothing()
        .returning({ markedAt: schema.attendance.markedAt });
      if (inserted.length === 0) return { kind: "duplicate" as const };
      await tx
        .update(schema.attendanceAttempts)
        .set({ state: "succeeded", finishedAt: writeNow, verification: meta })
        .where(eq(schema.attendanceAttempts.id, attempt.id));
      return { kind: "ok" as const, markedAt: inserted[0].markedAt };
    });

    if (outcome.kind === "closed") {
      return technical(problem("session_closed", `${e.occurrence.sessionName} closed before the check finished.`), meta);
    }
    if (outcome.kind === "duplicate") {
      return technical(problem("already_marked", `Attendance for ${e.occurrence.sessionName} is already recorded.`), meta);
    }
    return {
      ok: true,
      sessionName: e.occurrence.sessionName,
      sessionDate: attempt.sessionDate,
      status: punctuality,
      markedAt: outcome.markedAt.toISOString(),
    };
  } catch (err) {
    console.error(`[attempt ${attempt.id}] verification error`, errorName(err));
    return technical(
      problem("internal", "The face check could not finish because of a server problem. This did not use up a try. Please submit again.", true),
      meta,
    );
  }
}

/** The browser stopped (Cancel, left the page). Only an unused token owned by the student changes. */
export async function cancelAttempt(studentId: string, attemptId: string, now = new Date()) {
  await db
    .update(schema.attendanceAttempts)
    .set({ state: "cancelled", finishedAt: now, failureReason: "Cancelled by the student" })
    .where(
      and(
        eq(schema.attendanceAttempts.id, attemptId),
        eq(schema.attendanceAttempts.studentId, studentId),
        eq(schema.attendanceAttempts.state, "created"),
      ),
    );
}

/** For the student page: counted tries left in the currently open occurrence. */
export async function attemptsLeftFor(studentId: string, sessionId: number, sessionDate: string): Promise<number> {
  return Math.max(0, MAX_FAILED_ATTEMPTS - (await countedFailures(studentId, sessionId, sessionDate)));
}

/** For admin review: every submission for one student and occurrence. */
export async function attemptsFor(studentId: string, sessionId: number, sessionDate: string) {
  return db
    .select({
      id: schema.attendanceAttempts.id,
      state: schema.attendanceAttempts.state,
      counted: schema.attendanceAttempts.counted,
      createdAt: schema.attendanceAttempts.createdAt,
      finishedAt: schema.attendanceAttempts.finishedAt,
      reason: schema.attendanceAttempts.failureReason,
      distance: sql<number | null>`(${schema.attendanceAttempts.verification}->>'distance')::float`,
    })
    .from(schema.attendanceAttempts)
    .where(
      and(
        eq(schema.attendanceAttempts.studentId, studentId),
        eq(schema.attendanceAttempts.sessionId, sessionId),
        eq(schema.attendanceAttempts.sessionDate, sessionDate),
        inArray(schema.attendanceAttempts.state, ["succeeded", "failed", "error"]),
      ),
    )
    .orderBy(schema.attendanceAttempts.createdAt)
    .limit(50);
}

/** Housekeeping (daily cron): expire unused tokens, close crashed verifications, remove orphaned images. */
export async function sweepAttempts(storage: Pick<Storage, "remove">, now = new Date()) {
  const expired = await db
    .update(schema.attendanceAttempts)
    .set({ state: "expired", finishedAt: now })
    .where(and(eq(schema.attendanceAttempts.state, "created"), lt(schema.attendanceAttempts.expiresAt, now)))
    .returning({ id: schema.attendanceAttempts.id });
  const stuck = await db
    .update(schema.attendanceAttempts)
    .set({ state: "error", finishedAt: now, failureReason: "Verification did not finish" })
    .where(
      and(
        eq(schema.attendanceAttempts.state, "verifying"),
        lt(schema.attendanceAttempts.createdAt, new Date(now.getTime() - ATTEMPT_TTL_MS - STUCK_VERIFYING_MS)),
      ),
    )
    .returning({ id: schema.attendanceAttempts.id });

  const orphans = await db
    .select({ id: schema.attendanceAttempts.id, selfie: sql<string>`${schema.attendanceAttempts.verification}->>'pendingSelfieId'` })
    .from(schema.attendanceAttempts)
    .where(
      and(
        inArray(schema.attendanceAttempts.state, ["failed", "error", "cancelled", "expired"]),
        isNotNull(sql`${schema.attendanceAttempts.verification}->>'pendingSelfieId'`),
        sql`NOT EXISTS (SELECT 1 FROM ${schema.attendance} WHERE ${schema.attendance.attemptId} = ${schema.attendanceAttempts.id})`,
      ),
    )
    .limit(200);
  if (orphans.length) {
    await storage.remove(orphans.map((o) => o.selfie));
    await db
      .update(schema.attendanceAttempts)
      .set({ verification: sql`${schema.attendanceAttempts.verification} - 'pendingSelfieId'` })
      .where(inArray(schema.attendanceAttempts.id, orphans.map((o) => o.id)));
  }
  return { expired: expired.length, stuck: stuck.length, orphanSelfiesRemoved: orphans.length };
}

/** Error class name only, so image data and internals never reach logs. */
function errorName(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : "unknown error";
}
