import "server-only";
import { and, desc, eq, max, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { FACE_MODEL_ID, type Analysis, type FaceEngine } from "./face-engine";
import { assessFaces, PRESENCE_SCORE } from "./face-policy";

export type Enrollment = typeof schema.faceEnrollments.$inferSelect;

/**
 * The student's usable face reference: active, with a descriptor from the current model.
 * Server-only (contains the biometric template); never pass it to client components.
 */
export async function getActiveEnrollment(studentId: string): Promise<Enrollment | null> {
  const [row] = await db
    .select()
    .from(schema.faceEnrollments)
    .where(and(eq(schema.faceEnrollments.studentId, studentId), eq(schema.faceEnrollments.status, "active")));
  if (!row || !row.descriptor || row.model !== FACE_MODEL_ID) return null;
  return row;
}

export async function getLatestEnrollment(studentId: string): Promise<Enrollment | null> {
  const [row] = await db
    .select()
    .from(schema.faceEnrollments)
    .where(eq(schema.faceEnrollments.studentId, studentId))
    .orderBy(desc(schema.faceEnrollments.version))
    .limit(1);
  return row ?? null;
}

export type RegisterResult =
  | { status: "active"; version: number }
  | { status: "pending"; version: number; reason: string }
  | { status: "rejected"; version: number; reason: string };

/**
 * Register `imageId` (already stored privately) as the student's face reference, as a new version.
 * Only admin actions call this; the attendance flow can never change a reference.
 *
 * - Engine available + exactly one clear face → "active" with its descriptor; the previous active
 *   version is retired.
 * - Engine available + bad photo → "rejected"; the previous active version (if any) stays active.
 * - Engine unavailable → "pending"; it is checked later from Settings or the student page.
 */
export async function registerFace(opts: {
  studentId: string;
  imageId: string;
  image: Uint8Array;
  adminId: string | null;
  engine: FaceEngine | null;
  minScore: number;
  /** Analysis already made for this exact image (avoids analysing twice). */
  analysis?: Analysis;
}): Promise<RegisterResult> {
  let status: "active" | "pending" | "rejected" = "pending";
  let reason: string | null = "Face verification is not available on the server yet.";
  let quality: unknown = null;
  let descriptor: number[] | null = null;

  if (opts.engine) {
    const analysis = opts.analysis ?? (await opts.engine.analyze(opts.image));
    const faces = analysis.faces.map(({ descriptor: _d, ...f }) => f); // eslint-disable-line @typescript-eslint/no-unused-vars
    quality = { model: opts.engine.model, width: analysis.width, height: analysis.height, faces };
    const check = assessFaces(analysis.faces, analysis, "registration", opts.minScore);
    status = check.ok ? "active" : "rejected";
    reason = check.ok ? null : check.message;
    if (check.ok) descriptor = analysis.faces.find((f) => f.score >= PRESENCE_SCORE)!.descriptor;
  }

  return db.transaction(async (tx) => {
    // Serialise registrations for one student so version numbers and the single-active rule hold.
    await tx.execute(sqlLockStudent(opts.studentId));
    const [{ v }] = await tx
      .select({ v: max(schema.faceEnrollments.version) })
      .from(schema.faceEnrollments)
      .where(eq(schema.faceEnrollments.studentId, opts.studentId));
    const version = (v ?? 0) + 1;
    const now = new Date();

    if (status === "active") {
      await tx
        .update(schema.faceEnrollments)
        .set({ status: "retired", retiredAt: now })
        .where(and(eq(schema.faceEnrollments.studentId, opts.studentId), eq(schema.faceEnrollments.status, "active")));
    }
    if (status !== "rejected") {
      // Older pending versions are superseded by this one.
      await tx
        .update(schema.faceEnrollments)
        .set({ status: "retired", retiredAt: now })
        .where(and(eq(schema.faceEnrollments.studentId, opts.studentId), eq(schema.faceEnrollments.status, "pending")));
    }
    await tx.insert(schema.faceEnrollments).values({
      studentId: opts.studentId,
      version,
      imageId: opts.imageId,
      status,
      statusReason: reason,
      quality,
      descriptor,
      model: descriptor ? opts.engine!.model : null,
      createdByAdminId: opts.adminId,
      checkedAt: opts.engine ? now : null,
    });

    return status === "active" ? { status, version } : { status, version, reason: reason! };
  });
}

function sqlLockStudent(studentId: string) {
  return sql`SELECT 1 FROM ${schema.students} WHERE ${schema.students.id} = ${studentId} FOR UPDATE`;
}
