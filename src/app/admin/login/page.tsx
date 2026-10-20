"use client";

import { useActionState } from "react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { adminLogin, type AdminLoginState } from "./actions";

export default function AdminLoginPage() {
  const [state, action, pending] = useActionState<AdminLoginState, FormData>(adminLogin, {});

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Admin login</h1>
      <Card>
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
      </Card>
    </main>
  );
}
