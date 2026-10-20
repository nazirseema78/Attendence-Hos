"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { adminLogin, type AdminLoginState } from "./actions";

export function AdminLoginForm() {
  const [state, action, pending] = useActionState<AdminLoginState, FormData>(adminLogin, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label="Username">
        <Input name="username" autoComplete="username" defaultValue={state.username} required />
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
