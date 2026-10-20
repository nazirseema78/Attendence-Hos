"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { createSession, destroySession } from "@/lib/auth";
import { verifyPassword } from "@/lib/crypto";
import { getClientIp } from "@/lib/request-ip";
import { clearLoginFailures, isLoginLocked, LOCKED_MESSAGE, recordLoginFailure } from "@/lib/throttle";

export type AdminLoginState = { error?: string; username?: string };

export async function adminLogin(_prev: AdminLoginState, formData: FormData): Promise<AdminLoginState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const throttleKey = `admin:${username}`;
  if (await isLoginLocked(throttleKey)) return { error: LOCKED_MESSAGE, username };

  const [admin] = username
    ? await db.select().from(schema.admins).where(eq(schema.admins.username, username))
    : [];

  if (!(await verifyPassword(password, admin?.passwordHash)) || !admin) {
    await recordLoginFailure(throttleKey, await getClientIp());
    return { error: "Wrong username or password.", username };
  }
  await clearLoginFailures(throttleKey);

  await createSession("admin", admin.id);
  redirect("/admin");
}

export async function adminLogout() {
  await destroySession("admin");
  redirect("/admin/login");
}
