import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { randomToken, sha256 } from "./crypto";

export const ADMIN_COOKIE = "ah_admin";
export const STUDENT_COOKIE = "ah_student";
export const DEVICE_COOKIE = "ah_device";

const ADMIN_SESSION_HOURS = 12;
const STUDENT_SESSION_DAYS = 30;
const DEVICE_COOKIE_DAYS = 400; // browsers cap cookie lifetime at ~400 days

type UserType = "admin" | "student";

const cookieName = (type: UserType) => (type === "admin" ? ADMIN_COOKIE : STUDENT_COOKIE);

function baseCookie(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Create a login session and set its cookie. Call only from a Server Action or Route Handler. */
export async function createSession(userType: UserType, userId: string): Promise<void> {
  const token = randomToken();
  const maxAge = userType === "admin" ? ADMIN_SESSION_HOURS * 3600 : STUDENT_SESSION_DAYS * 86400;
  await db.insert(schema.authSessions).values({
    tokenHash: sha256(token),
    userType,
    userId,
    expiresAt: new Date(Date.now() + maxAge * 1000),
  });
  (await cookies()).set(cookieName(userType), token, baseCookie(maxAge));
}

export async function destroySession(userType: UserType): Promise<void> {
  const store = await cookies();
  const token = store.get(cookieName(userType))?.value;
  if (token) {
    await db.delete(schema.authSessions).where(eq(schema.authSessions.tokenHash, sha256(token)));
  }
  store.delete(cookieName(userType));
}

/** Log a student out everywhere, e.g. after a password change or device reset. */
export async function destroyAllStudentSessions(studentId: string): Promise<void> {
  await db
    .delete(schema.authSessions)
    .where(and(eq(schema.authSessions.userType, "student"), eq(schema.authSessions.userId, studentId)));
}

/** Hash of this request's session cookie for the given role, or null. */
async function sessionTokenHash(userType: UserType): Promise<string | null> {
  // Session checks compare against the current time, so they must run per request,
  // never inside a prefetch prerender.
  await connection();
  const token = (await cookies()).get(cookieName(userType))?.value;
  return token ? sha256(token) : null;
}

const validSession = (tokenHash: string, userType: UserType) =>
  and(
    eq(schema.authSessions.tokenHash, tokenHash),
    eq(schema.authSessions.userType, userType),
    gt(schema.authSessions.expiresAt, new Date()),
  );

export type CurrentAdmin = { id: string; name: string };
export type CurrentStudent = { id: string; name: string; phone: string };

// Session + user are read in one joined query: each database round trip is ~200 ms.
export const getAdmin = cache(async (): Promise<CurrentAdmin | null> => {
  const tokenHash = await sessionTokenHash("admin");
  if (!tokenHash) return null;
  const [admin] = await db
    .select({ id: schema.admins.id, name: schema.admins.name })
    .from(schema.authSessions)
    .innerJoin(schema.admins, eq(schema.admins.id, schema.authSessions.userId))
    .where(validSession(tokenHash, "admin"));
  return admin ?? null;
});

/** The logged-in student, only if the account is active AND this is the phone it is bound to. */
export const getStudent = cache(async (): Promise<CurrentStudent | null> => {
  const tokenHash = await sessionTokenHash("student");
  if (!tokenHash) return null;
  const [student] = await db
    .select({
      id: schema.students.id,
      name: schema.students.name,
      phone: schema.students.phone,
      active: schema.students.active,
      deviceTokenHash: schema.students.deviceTokenHash,
    })
    .from(schema.authSessions)
    .innerJoin(schema.students, eq(schema.students.id, schema.authSessions.userId))
    .where(validSession(tokenHash, "student"));
  if (!student?.active || !student.deviceTokenHash) return null;

  const deviceToken = await getDeviceToken();
  if (!deviceToken || sha256(deviceToken) !== student.deviceTokenHash) return null;

  return { id: student.id, name: student.name, phone: student.phone };
});

export async function requireAdmin(): Promise<CurrentAdmin> {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

export async function requireStudent(): Promise<CurrentStudent> {
  const student = await getStudent();
  if (!student) redirect("/login");
  return student;
}

export async function getDeviceToken(): Promise<string | null> {
  return (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
}

/** Returns this browser's device token, creating the cookie if it doesn't exist yet. */
export async function ensureDeviceToken(): Promise<string> {
  const existing = await getDeviceToken();
  if (existing) return existing;
  const token = randomToken();
  (await cookies()).set(DEVICE_COOKIE, token, baseCookie(DEVICE_COOKIE_DAYS * 86400));
  return token;
}
