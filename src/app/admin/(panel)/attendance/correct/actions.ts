"use server";

import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { applyCorrection, isCorrectionAction } from "@/lib/corrections";
import { UUID_RE } from "@/lib/media";
import { getClientIp } from "@/lib/request-ip";
import { isValidIsoDate } from "@/lib/schedule";

export type CorrectionState = { error?: string; success?: string };

export async function correctAttendance(_prev: CorrectionState, formData: FormData): Promise<CorrectionState> {
  const admin = await requireAdmin();
  const studentId = String(formData.get("studentId") ?? "");
  const sessionId = Number(formData.get("sessionId"));
  const sessionDate = String(formData.get("sessionDate") ?? "");
  const action = formData.get("action");
  const reason = String(formData.get("reason") ?? "");

  if (!UUID_RE.test(studentId) || !Number.isInteger(sessionId) || !isValidIsoDate(sessionDate)) {
    return { error: "Invalid student, session or date." };
  }
  if (!isCorrectionAction(action)) return { error: "Choose what to record." };

  const result = await applyCorrection({
    adminId: admin.id,
    adminIp: await getClientIp(),
    studentId,
    sessionId,
    sessionDate,
    action,
    reason,
  });
  if (!result.ok) return { error: result.message };
  refresh();
  return { success: "Saved. The change is recorded in the history below." };
}
