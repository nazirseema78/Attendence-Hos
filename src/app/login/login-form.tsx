"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { studentLogin, type LoginState } from "./actions";

export function StudentLoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(studentLogin, {});

  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label="Phone number">
        <Input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0300 1234567"
          defaultValue={state.phone}
          required
        />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Logging in…" : "Log in"}
      </Button>
    </form>
  );
}
