"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { createSession, destroySession, ensureDeviceToken, getDeviceToken } from "@/lib/auth";
import { sha256, verifyPassword } from "@/lib/crypto";
import { normalizePhone } from "@/lib/phone";
import { getClientIp } from "@/lib/request-ip";
import { clearLoginFailures, isLoginLocked, LOCKED_MESSAGE, recordLoginFailure } from "@/lib/throttle";

export type LoginState = { error?: string; phone?: string };

const LOCKED_TO_OTHER_PHONE =
  "This account is locked to another phone. Ask the admin to reset your device, then log in again.";

export async function studentLogin(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const rawPhone = String(formData.get("phone") ?? "");
  const password = String(formData.get("password") ?? "");
  const phone = normalizePhone(rawPhone);

  const throttleKey = `student:${phone ?? rawPhone.trim()}`;
  if (await isLoginLocked(throttleKey)) return { error: LOCKED_MESSAGE, phone: rawPhone };

  const [student] = phone
    ? await db.select().from(schema.students).where(eq(schema.students.phone, phone))
    : [];

  const passwordOk = await verifyPassword(password, student?.passwordHash);
  if (!student || !passwordOk) {
    await recordLoginFailure(throttleKey, await getClientIp());
    return { error: "Wrong phone number or password.", phone: rawPhone };
  }
  await clearLoginFailures(throttleKey);
  if (!student.active) {
    return { error: "This account is deactivated. Contact the admin.", phone: rawPhone };
  }

  if (student.deviceTokenHash) {
    // Already bound: only that phone may log in.
    const deviceToken = await getDeviceToken();
    if (!deviceToken || sha256(deviceToken) !== student.deviceTokenHash) {
      return { error: LOCKED_TO_OTHER_PHONE, phone: rawPhone };
    }
  } else {
    // First login: bind this phone, unless it's already bound to a different student.
    const tokenHash = sha256(await ensureDeviceToken());
    const [owner] = await db
      .select({ id: schema.students.id })
      .from(schema.students)
      .where(eq(schema.students.deviceTokenHash, tokenHash));
    if (owner && owner.id !== student.id) {
      return {
        error: "This phone is already registered to another student. Each student must use their own phone.",
        phone: rawPhone,
      };
    }
    await db
      .update(schema.students)
      .set({ deviceTokenHash: tokenHash, deviceBoundAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.students.id, student.id));
  }

  await createSession("student", student.id);
  redirect("/");
}

export async function studentLogout() {
  await destroySession("student");
  redirect("/login");
}
