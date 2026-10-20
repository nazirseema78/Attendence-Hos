"use server";

import { refresh } from "next/cache";
import { getStudent } from "@/lib/auth";
import { cancelAttempt, defaultDeps, startAttempt, submitAttempt, type Marked, type Problem, type Started } from "@/lib/attempts";
import { giveConsent, withdrawConsent } from "@/lib/consent";
import { MAX_SELFIE_BYTES, readUpload } from "@/lib/files";
import { UUID_RE } from "@/lib/media";
import { getClientIp } from "@/lib/request-ip";

// Every action derives the student from the session cookie and the bound device.
// The browser sends only a token and the image: never identity, descriptors, scores or results.

const loggedOut: Problem = { ok: false, code: "attempt_invalid", message: "Your login has expired. Please log in again.", retryable: false };

/** Eligibility + a single-use submission token. Never uses up a try. */
export async function startAttendance(): Promise<Started | Problem> {
  const student = await getStudent();
  if (!student) return loggedOut;
  return startAttempt(student.id, await getClientIp(), defaultDeps());
}

export async function submitAttendance(formData: FormData): Promise<Marked | Problem> {
  const student = await getStudent();
  if (!student) return loggedOut;
  const attemptId = formData.get("attemptId");
  if (typeof attemptId !== "string" || !UUID_RE.test(attemptId)) {
    return { ok: false, code: "attempt_invalid", message: "Invalid request. Please try again.", retryable: true };
  }
  // Cheap checks before claiming the token, so a bad file never consumes it.
  const file = await readUpload(formData.get("selfie"), ["jpeg", "png", "webp"], MAX_SELFIE_BYTES);
  if (!file || !file.ok) {
    return {
      ok: false,
      code: "invalid_image",
      message: file ? file.error : "No photo was received. Please capture again.",
      retryable: true,
    };
  }
  const result = await submitAttempt(student.id, attemptId, await getClientIp(), file.buffer, defaultDeps());
  if (result.ok) refresh();
  return result;
}

export async function cancelAttendance(attemptId: string): Promise<void> {
  const student = await getStudent();
  if (!student || typeof attemptId !== "string" || !UUID_RE.test(attemptId)) return;
  await cancelAttempt(student.id, attemptId);
}

export async function acceptConsent(): Promise<void> {
  const student = await getStudent();
  if (!student) return;
  await giveConsent(student.id, await getClientIp());
  refresh();
}

export async function revokeConsent(): Promise<void> {
  const student = await getStudent();
  if (!student) return;
  await withdrawConsent(student.id);
  refresh();
}
