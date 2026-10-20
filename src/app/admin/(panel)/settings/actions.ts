"use server";

import { and, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import sharp from "sharp";
import { BRANDING_TAG } from "@/lib/branding";
import { deletePrivate, fetchPrivateImage, uploadPrivate } from "@/lib/cloudinary";
import { validatePrimaryColor } from "@/lib/color";
import { registerFace } from "@/lib/enrollment";
import { faceConfigStatus, getVerifier } from "@/lib/face";
import { readUpload } from "@/lib/files";
import { refresh, updateTag } from "next/cache";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { normalizeCidr } from "@/lib/ip";
import { findOverlap, timeInputToMinute } from "@/lib/schedule";

export type SettingsState = { error?: string; success?: string };

const LOGO_MAX_BYTES = 1024 * 1024;

/** Institution name, primary colour and logo. Admin only; validated server-side. */
export async function saveBranding(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const admin = await requireAdmin();

  const orgName = String(formData.get("orgName") ?? "").trim().replace(/\s+/g, " ");
  if (orgName.length < 2 || orgName.length > 60) return { error: "The institution name must be 2–60 characters." };

  const color = validatePrimaryColor(String(formData.get("primaryColor") ?? ""));
  if (!color.ok) return { error: color.message };

  const removeLogo = formData.get("removeLogo") === "on";
  const file = await readUpload(formData.get("logo"), ["png", "jpeg", "webp"], LOGO_MAX_BYTES);
  if (file && !file.ok) return { error: `Logo: ${file.error}` };

  let newLogoId: string | null = null;
  if (file?.ok) {
    // Re-encode server-side: real image check, size limit, no metadata, no SVG/script content.
    let png: Buffer;
    try {
      const meta = await sharp(file.buffer, { limitInputPixels: 25_000_000 }).metadata();
      if (Math.min(meta.width ?? 0, meta.height ?? 0) < 32) return { error: "Logo: the image is too small (minimum 32px)." };
      png = await sharp(file.buffer).rotate().resize(512, 512, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    } catch {
      return { error: "Logo: the file is not a readable image." };
    }
    try {
      newLogoId = (await uploadPrivate(png, "branding")).public_id;
    } catch (e) {
      console.error("Logo upload failed", e instanceof Error ? e.name : e);
      return { error: "Could not upload the logo to storage. Try again." };
    }
  }

  const [current] = await db.select().from(schema.branding).where(eq(schema.branding.id, 1));
  const logoId = newLogoId ?? (removeLogo ? null : (current?.logoId ?? null));
  const values = { orgName, primaryColor: color.hex, logoId, updatedAt: new Date(), updatedByAdminId: admin.id };
  try {
    await db.insert(schema.branding).values({ id: 1, ...values }).onConflictDoUpdate({ target: schema.branding.id, set: values });
  } catch (e) {
    if (newLogoId) await deletePrivate([newLogoId]).catch(() => {});
    throw e;
  }
  // Remove the replaced/removed logo only after the new branding is saved.
  if (current?.logoId && current.logoId !== logoId) await deletePrivate([current.logoId]).catch(() => {});

  updateTag(BRANDING_TAG);
  return { success: "Branding saved. It now shows across the app." };
}

/** Check every student whose photo has no active face registration (e.g. photos added before face matching existed). */
export async function registerPendingFaces(): Promise<SettingsState> {
  const admin = await requireAdmin();
  const engine = getVerifier();
  if (!engine) return { error: faceConfigStatus().error ?? "Face verification is not available." };
  const minScore = faceConfigStatus().thresholds.minScore;

  const candidates = await db
    .select({ id: schema.students.id, photoId: schema.students.photoId })
    .from(schema.students)
    .where(
      and(
        eq(schema.students.active, true),
        isNotNull(schema.students.photoId),
        sql`NOT EXISTS (SELECT 1 FROM ${schema.faceEnrollments} f WHERE f.student_id = ${schema.students.id} AND f.status = 'active' AND f.descriptor IS NOT NULL)`,
      ),
    )
    .limit(50);

  const tally = { active: 0, rejected: 0, failed: 0 };
  for (const c of candidates) {
    try {
      const image = await fetchPrivateImage(c.photoId!);
      const r = await registerFace({ studentId: c.id, imageId: c.photoId!, image, adminId: admin.id, engine, minScore });
      tally[r.status === "active" ? "active" : "rejected"]++;
    } catch (e) {
      console.error("Face registration failed", e instanceof Error ? e.name : e);
      tally.failed++;
    }
  }
  refresh();
  if (candidates.length === 0) return { success: "Every student with a photo is already registered." };
  return {
    success: `Checked ${candidates.length}: ${tally.active} registered, ${tally.rejected} photos need replacing, ${tally.failed} could not be checked.${candidates.length === 50 ? " Run again for more." : ""}`,
  };
}

export async function addAllowedIp(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireAdmin();
  const cidr = normalizeCidr(String(formData.get("cidr") ?? ""));
  const label = String(formData.get("label") ?? "").trim().slice(0, 100) || null;
  if (!cidr) {
    return { error: "Enter a valid IP address (e.g. 203.0.113.7) or range (e.g. 2401:4900:1c2a:5e10::/64)." };
  }
  if (cidr === "0.0.0.0/0" || cidr === "::/0") {
    return { error: "That range would allow every network in the world. Enter the building's IP." };
  }
  const inserted = await db.insert(schema.allowedIps).values({ cidr, label }).onConflictDoNothing().returning();
  refresh();
  return inserted.length ? { success: `Added ${cidr}.` } : { error: `${cidr} is already in the list.` };
}

export async function removeAllowedIp(id: number): Promise<void> {
  await requireAdmin();
  await db.delete(schema.allowedIps).where(eq(schema.allowedIps.id, id));
  refresh();
}

export async function saveGraceMinutes(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireAdmin();
  const graceMinutes = Number(formData.get("graceMinutes"));
  if (!Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 600) {
    return { error: "Enter a whole number of minutes between 0 and 600." };
  }
  await db
    .insert(schema.settings)
    .values({ id: 1, graceMinutes })
    .onConflictDoUpdate({ target: schema.settings.id, set: { graceMinutes } });
  refresh();
  return { success: "Saved." };
}

export async function saveSessions(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireAdmin();
  const ids = formData.getAll("id").map(String);
  const names = formData.getAll("name").map((v) => String(v).trim());
  const starts = formData.getAll("start").map((v) => timeInputToMinute(String(v)));
  const ends = formData.getAll("end").map((v) => timeInputToMinute(String(v)));

  if (names.length === 0) return { error: "Keep at least one session." };
  if (names.length > 10) return { error: "At most 10 sessions." };

  const sessions = names.map((name, i) => ({
    id: ids[i] ? Number(ids[i]) : null,
    name,
    startMinute: starts[i],
    endMinute: ends[i],
  }));
  for (const s of sessions) {
    if (!s.name || s.name.length > 50) return { error: "Every session needs a name (up to 50 characters)." };
    if (s.startMinute === null || s.endMinute === null) return { error: `Enter valid times for "${s.name}".` };
  }
  const valid = sessions as { id: number | null; name: string; startMinute: number; endMinute: number }[];
  const overlap = findOverlap(valid.map((s, i) => ({ ...s, id: s.id ?? -i })));
  if (overlap) return { error: overlap };

  const keptIds = valid.map((s) => s.id).filter((id): id is number => id !== null);

  // Sessions removed from the form: only delete ones that have no attendance history.
  const removed = await db
    .select({ id: schema.attendanceSessions.id, name: schema.attendanceSessions.name })
    .from(schema.attendanceSessions)
    .where(keptIds.length ? notInArray(schema.attendanceSessions.id, keptIds) : undefined);
  if (removed.length) {
    const used = await db
      .selectDistinct({ sessionId: schema.attendance.sessionId })
      .from(schema.attendance)
      .where(inArray(schema.attendance.sessionId, removed.map((r) => r.id)));
    if (used.length) {
      const name = removed.find((r) => r.id === used[0].sessionId)?.name;
      return { error: `"${name}" already has attendance records and can't be removed. Rename or retime it instead.` };
    }
  }

  await db.transaction(async (tx) => {
    if (removed.length) {
      await tx.delete(schema.attendanceSessions).where(inArray(schema.attendanceSessions.id, removed.map((r) => r.id)));
    }
    for (const s of valid) {
      const values = { name: s.name, startMinute: s.startMinute, endMinute: s.endMinute };
      if (s.id === null) await tx.insert(schema.attendanceSessions).values(values);
      else await tx.update(schema.attendanceSessions).set(values).where(eq(schema.attendanceSessions.id, s.id));
    }
  });

  refresh();
  return { success: "Sessions saved." };
}
