import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";

/** Bump when the notice text below changes; students are then asked to consent again. */
export const CONSENT_NOTICE_VERSION = 2;

export const CONSENT_NOTICE = [
  "To mark attendance, this app compares your selfie with the photo the warden registered for you.",
  "The comparison runs on the hostel app's own server (no outside face-recognition company). It stores a numeric face template from your registered photo. Attendance selfies are deleted after 90 days; your registered photo and template are kept while you are a resident.",
  "This check confirms the face matches; it cannot prove you are physically present or that the picture isn't a photo of a photo, so the warden may review records.",
  "Only hostel admins can see your images. You can withdraw consent at any time; the warden will then mark your attendance manually instead.",
];

export async function hasActiveConsent(studentId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.biometricConsents.id })
    .from(schema.biometricConsents)
    .where(
      and(
        eq(schema.biometricConsents.studentId, studentId),
        eq(schema.biometricConsents.noticeVersion, CONSENT_NOTICE_VERSION),
        isNull(schema.biometricConsents.withdrawnAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function getConsentStatus(studentId: string) {
  const [row] = await db
    .select()
    .from(schema.biometricConsents)
    .where(eq(schema.biometricConsents.studentId, studentId))
    .orderBy(desc(schema.biometricConsents.givenAt))
    .limit(1);
  return row ?? null;
}

export async function giveConsent(studentId: string, ip: string | null): Promise<void> {
  if (await hasActiveConsent(studentId)) return;
  await db.insert(schema.biometricConsents).values({ studentId, noticeVersion: CONSENT_NOTICE_VERSION, ip });
}

export async function withdrawConsent(studentId: string): Promise<void> {
  await db
    .update(schema.biometricConsents)
    .set({ withdrawnAt: new Date() })
    .where(and(eq(schema.biometricConsents.studentId, studentId), isNull(schema.biometricConsents.withdrawnAt)));
}
