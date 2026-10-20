"use client";

import { useActionState } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { correctAttendance, type CorrectionState } from "./actions";

const OPTIONS = [
  { value: "present_on_time", label: "Present · on time" },
  { value: "present_late", label: "Present · late" },
  { value: "absent", label: "Absent" },
] as const;

export function CorrectionForm({ studentId, sessionId, sessionDate }: { studentId: string; sessionId: number; sessionDate: string }) {
  const [state, action, pending] = useActionState<CorrectionState, FormData>(correctAttendance, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.success && <Alert tone="success">{state.success}</Alert>}
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="sessionDate" value={sessionDate} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Record as</legend>
        {OPTIONS.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input type="radio" name="action" value={o.value} required className="h-4 w-4" />
            {o.label}
          </label>
        ))}
      </fieldset>
      <Field label="Reason (required)" hint="e.g. Phone broken, checked in person at the warden's desk.">
        <textarea name="reason" required minLength={5} maxLength={500} rows={3} className={`${inputClass} h-auto py-2`} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save correction"}
      </Button>
    </form>
  );
}
