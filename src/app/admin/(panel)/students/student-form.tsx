"use client";

import { useActionState, useState, useTransition, type FormEvent } from "react";
import { Alert, Button, Field, Input, inputClass } from "@/components/ui";
import { compressImage } from "@/lib/client-image";
import type { FormState } from "./actions";

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  mode: "create" | "edit";
  initial?: { name: string; phone: string; guardianPhone: string };
  hasPhoto?: boolean;
  hasIdCard?: boolean;
};

export function StudentForm({ action, mode, initial, hasPhoto, hasIdCard }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const [compressing, setCompressing] = useState(false);
  const [, startTransition] = useTransition();
  const busy = pending || compressing;
  const fe = state.fieldErrors ?? {};

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setCompressing(true);
    try {
      for (const key of ["photo", "idCard"]) {
        const file = formData.get(key);
        if (file instanceof File && file.size > 0) formData.set(key, await compressImage(file));
      }
    } finally {
      setCompressing(false);
    }
    // Dispatch in a fresh transition: updates after an `await` are not part of the earlier one.
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.success && <Alert tone="success">{state.success}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={fe.name}>
          <Input name="name" defaultValue={initial?.name} required maxLength={100} />
        </Field>
        <Field label="Phone number" hint="Used by the student to log in." error={fe.phone}>
          <Input name="phone" type="tel" inputMode="tel" defaultValue={initial?.phone} placeholder="0300 1234567" required />
        </Field>
        <Field label="Guardian phone number" error={fe.guardianPhone}>
          <Input name="guardianPhone" type="tel" inputMode="tel" defaultValue={initial?.guardianPhone} placeholder="0300 1234567" required />
        </Field>
        {mode === "create" && (
          <Field label="Password" hint="At least 8 characters. Give it to the student." error={fe.password}>
            <Input name="password" type="text" autoComplete="off" minLength={8} required />
          </Field>
        )}
        <Field
          label={hasPhoto ? "Replace photo" : "Photo"}
          hint="Clear, front-facing photo. JPG, PNG or WebP."
          error={fe.photo}
        >
          <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" className={`${inputClass} py-1.5`} />
        </Field>
        <Field
          label={hasIdCard ? "Replace ID card" : "ID card"}
          hint="Image or PDF, up to 3 MB."
          error={fe.idCard}
        >
          <input
            name="idCard"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className={`${inputClass} py-1.5`}
          />
        </Field>
      </div>

      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : mode === "create" ? "Add student" : "Save changes"}
      </Button>
    </form>
  );
}
