"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import type { FormState } from "../actions";

export function PasswordForm({ action }: { action: (prev: FormState, formData: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      {state.success && <Alert tone="success">{state.success}</Alert>}
      <Field label="New password" hint="At least 8 characters." error={state.fieldErrors?.password}>
        <Input name="password" type="text" autoComplete="off" minLength={8} required />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Set password"}
      </Button>
    </form>
  );
}
