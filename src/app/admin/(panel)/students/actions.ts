"use server";

import { and, eq, ne } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { destroyAllStudentSessions, requireAdmin } from "@/lib/auth";
import { deletePrivate, fetchPrivateImage, uploadPrivate } from "@/lib/cloudinary";
import { registerFace } from "@/lib/enrollment";
import { faceConfigStatus, getVerifier } from "@/lib/face";
import { FaceImageError, type Analysis } from "@/lib/face-engine";
import { assessFaces } from "@/lib/face-policy";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/crypto";
import { readUpload } from "@/lib/files";
import { normalizePhone } from "@/lib/phone";

export type FormState = {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "phone" | "guardianPhone" | "password" | "photo" | "idCard", string>>;
  success?: string;
};

const phoneField = z.string().transform((v, ctx) => {
  const phone = normalizePhone(v);
  if (!phone) {
    ctx.addIssue({ code: "custom", message: "Enter a valid phone number, e.g. 0300 1234567." });
    return z.NEVER;
  }
  return phone;
});

const detailsSchema = z.object({
  name: z.string().trim().min(2, "Enter the full name.").max(100),
  phone: phoneField,
  guardianPhone: phoneField,
});

const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH, `At least ${MIN_PASSWORD_LENGTH} characters.`).max(200);

function fieldErrors(error: z.ZodError): FormState["fieldErrors"] {
  const out: FormState["fieldErrors"] = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as keyof NonNullable<FormState["fieldErrors"]>;
    out[key] ??= issue.message;
  }
  return out;
}

async function phoneTaken(phone: string, exceptId?: string) {
  const [row] = await db
    .select({ id: schema.students.id })
    .from(schema.students)
    .where(exceptId ? and(eq(schema.students.phone, phone), ne(schema.students.id, exceptId)) : eq(schema.students.phone, phone));
  return Boolean(row);
}

/** Validate and upload the optional photo / ID card. Uploaded ids are returned so failures can clean up. */
async function handleFiles(formData: FormData) {
  const photo = await readUpload(formData.get("photo"), ["jpeg", "png", "webp"]);
  const idCard = await readUpload(formData.get("idCard"), ["jpeg", "png", "webp", "pdf"]);
  const errors: FormState["fieldErrors"] = {};
  if (photo && !photo.ok) errors.photo = photo.error;
  if (idCard && !idCard.ok) errors.idCard = idCard.error;
  if (Object.keys(errors).length) return { errors } as const;

  // When face verification is configured, refuse a photo that can't serve as a face reference,
  // so the stored photo always matches the active registration.
  const engine = getVerifier();
  const minScore = faceConfigStatus().thresholds.minScore;
  let photoAnalysis: Analysis | undefined;
  if (photo?.ok && engine) {
    try {
      photoAnalysis = await engine.analyze(photo.buffer);
    } catch (e) {
      if (e instanceof FaceImageError) return { errors: { photo: e.message } } as const;
      console.error("Face check of uploaded photo failed", e instanceof Error ? e.name : e);
      return { errors: { photo: "Could not check the photo for a face. Try again." } } as const;
    }
    const check = assessFaces(photoAnalysis.faces, photoAnalysis, "registration", minScore);
    if (!check.ok) return { errors: { photo: check.message } } as const;
  }

  let photoUpload, idCardUpload;
  try {
    photoUpload = photo?.ok ? await uploadPrivate(photo.buffer, "students/photos") : null;
    idCardUpload = idCard?.ok ? await uploadPrivate(idCard.buffer, "students/id-cards") : null;
  } catch (e) {
    console.error("Student file upload failed", e);
    if (photoUpload) await deletePrivate([photoUpload.public_id]).catch(() => {});
    return { uploadError: "Could not upload the files to storage. Check the Cloudinary keys and try again." } as const;
  }
  return {
    photoId: photoUpload?.public_id,
    idCardId: idCardUpload?.public_id,
    idCardFormat: idCard?.ok ? idCard.kind : undefined,
    photoBuffer: photo?.ok ? photo.buffer : undefined,
    photoAnalysis,
    engine,
    minScore,
    uploaded: [photoUpload?.public_id, idCardUpload?.public_id].filter((x): x is string => Boolean(x)),
  } as const;
}

export async function createStudent(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();

  const details = detailsSchema.safeParse(Object.fromEntries(formData));
  const password = passwordSchema.safeParse(formData.get("password"));
  if (!details.success || !password.success) {
    return {
      fieldErrors: {
        ...(details.success ? {} : fieldErrors(details.error)),
        ...(password.success ? {} : { password: password.error.issues[0].message }),
      },
    };
  }
  if (await phoneTaken(details.data.phone)) {
    return { fieldErrors: { phone: "Another student already uses this phone number." } };
  }

  const files = await handleFiles(formData);
  if ("errors" in files) return { fieldErrors: files.errors };
  if ("uploadError" in files) return { error: files.uploadError };

  let id: string;
  try {
    const [row] = await db
      .insert(schema.students)
      .values({
        ...details.data,
        passwordHash: await hashPassword(password.data),
        photoId: files.photoId,
        idCardId: files.idCardId,
        idCardFormat: files.idCardFormat,
      })
      .returning({ id: schema.students.id });
    id = row.id;
  } catch (e) {
    await deletePrivate(files.uploaded).catch(() => {});
    throw e;
  }
  if (files.photoId && files.photoBuffer) {
    await registerFace({ studentId: id, imageId: files.photoId, image: files.photoBuffer, adminId: admin.id, engine: files.engine, minScore: files.minScore, analysis: files.photoAnalysis });
  }
  redirect(`/admin/students/${id}?created=1`);
}

export async function updateStudent(studentId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();

  const details = detailsSchema.safeParse(Object.fromEntries(formData));
  if (!details.success) return { fieldErrors: fieldErrors(details.error) };
  if (await phoneTaken(details.data.phone, studentId)) {
    return { fieldErrors: { phone: "Another student already uses this phone number." } };
  }

  const [current] = await db.select().from(schema.students).where(eq(schema.students.id, studentId));
  if (!current) return { error: "Student not found." };

  const files = await handleFiles(formData);
  if ("errors" in files) return { fieldErrors: files.errors };
  if ("uploadError" in files) return { error: files.uploadError };

  try {
    await db
      .update(schema.students)
      .set({
        ...details.data,
        ...(files.photoId && { photoId: files.photoId }),
        ...(files.idCardId && { idCardId: files.idCardId, idCardFormat: files.idCardFormat }),
        updatedAt: new Date(),
      })
      .where(eq(schema.students.id, studentId));
  } catch (e) {
    await deletePrivate(files.uploaded).catch(() => {});
    throw e;
  }

  if (files.photoId && files.photoBuffer) {
    await registerFace({ studentId, imageId: files.photoId, image: files.photoBuffer, adminId: admin.id, engine: files.engine, minScore: files.minScore, analysis: files.photoAnalysis });
  }
  // Replaced ID cards are removed. Replaced photos are kept: earlier face-registration versions
  // (and the attendance verified against them) still refer to them.
  if (files.idCardId && current.idCardId) await deletePrivate([current.idCardId]).catch(() => {});

  refresh();
  return { success: "Student details saved." };
}

export async function setStudentPassword(studentId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const password = passwordSchema.safeParse(formData.get("password"));
  if (!password.success) return { fieldErrors: { password: password.error.issues[0].message } };

  await db
    .update(schema.students)
    .set({ passwordHash: await hashPassword(password.data), updatedAt: new Date() })
    .where(eq(schema.students.id, studentId));
  await destroyAllStudentSessions(studentId);
  return { success: "Password changed. The student must log in again with the new password." };
}

export async function resetStudentDevice(studentId: string): Promise<void> {
  await requireAdmin();
  await db
    .update(schema.students)
    .set({ deviceTokenHash: null, deviceBoundAt: null, updatedAt: new Date() })
    .where(eq(schema.students.id, studentId));
  await destroyAllStudentSessions(studentId);
  refresh();
}

export async function setStudentActive(studentId: string, active: boolean): Promise<void> {
  await requireAdmin();
  await db.update(schema.students).set({ active, updatedAt: new Date() }).where(eq(schema.students.id, studentId));
  if (!active) await destroyAllStudentSessions(studentId);
  refresh();
}

/** Re-run face registration on the student's current photo (e.g. after the photo check failed for a technical reason). */
export async function recheckFace(studentId: string): Promise<void> {
  const admin = await requireAdmin();
  const [student] = await db.select({ photoId: schema.students.photoId }).from(schema.students).where(eq(schema.students.id, studentId));
  if (!student?.photoId) return;
  const image = await fetchPrivateImage(student.photoId);
  await registerFace({ studentId, imageId: student.photoId, image, adminId: admin.id, engine: getVerifier(), minScore: faceConfigStatus().thresholds.minScore });
  refresh();
}
