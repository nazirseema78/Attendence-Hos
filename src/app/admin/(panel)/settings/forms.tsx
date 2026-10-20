"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { addAllowedIp, registerPendingFaces, saveGraceMinutes, saveSessions, type SettingsState } from "./actions";

export function RegisterPendingFacesForm() {
  const [state, action, pending] = useActionState(registerPendingFaces, {});
  return (
    <form action={action} className="space-y-3">
      <Messages state={state} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Checking photos…" : "Check all unregistered photos"}
      </Button>
    </form>
  );
}

function Messages({ state }: { state: SettingsState }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.success) return <Alert tone="success">{state.success}</Alert>;
  return null;
}

export function AddIpForm({ currentIp }: { currentIp: string | null }) {
  const [state, action, pending] = useActionState(addAllowedIp, {});
  const [value, setValue] = useState("");

  return (
    <form action={action} className="space-y-3">
      <Messages state={state} />
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <Field label="IP address or range">
          <Input
            name="cidr"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="203.0.113.7"
            required
            className="font-mono"
          />
        </Field>
        <Field label="Label (optional)">
          <Input name="label" placeholder="Main building Wi-Fi" />
        </Field>
        <Button type="submit" disabled={pending}>
          Add
        </Button>
      </div>
      {currentIp && (
        <p className="text-sm text-muted">
          Your current IP is <code className="font-mono text-foreground">{currentIp}</code>.{" "}
          <button type="button" onClick={() => setValue(currentIp)} className="text-primary underline">
            Use it
          </button>{" "}
          (only if you are on the building Wi-Fi right now).
        </p>
      )}
    </form>
  );
}

export function GraceForm({ graceMinutes }: { graceMinutes: number }) {
  const [state, action, pending] = useActionState(saveGraceMinutes, {});
  return (
    <form action={action} className="space-y-3">
      <Messages state={state} />
      <div className="flex items-end gap-3">
        <Field label="On-time window (minutes from session start)">
          <Input name="graceMinutes" type="number" min={0} max={600} defaultValue={graceMinutes} className="w-32" required />
        </Field>
        <Button type="submit" variant="secondary" disabled={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}

type SessionRow = { key: string; id: number | null; name: string; start: string; end: string };

export function SessionsForm({ initial }: { initial: Omit<SessionRow, "key">[] }) {
  const [state, action, pending] = useActionState(saveSessions, {});
  const [rows, setRows] = useState<SessionRow[]>(() => initial.map((r, i) => ({ ...r, key: `s${r.id ?? i}` })));

  const update = (key: string, patch: Partial<SessionRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <form action={action} className="space-y-3">
      <Messages state={state} />
      <p className="text-xs text-muted">
        Times are India Standard Time. A session that ends earlier than it starts (e.g. 21:00 → 08:00) runs overnight.
        Sessions must not overlap.
      </p>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
            <input type="hidden" name="id" value={r.id ?? ""} />
            <Field label="Name">
              <Input name="name" value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} required />
            </Field>
            <Field label="Start">
              <Input name="start" type="time" value={r.start} onChange={(e) => update(r.key, { start: e.target.value })} required />
            </Field>
            <Field label="End">
              <Input name="end" type="time" value={r.end} onChange={(e) => update(r.key, { end: e.target.value })} required />
            </Field>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              disabled={rows.length === 1}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setRows((rs) => [...rs, { key: `new${Date.now()}`, id: null, name: `Session ${rs.length + 1}`, start: "", end: "" }])
          }
        >
          + Add session
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save sessions"}
        </Button>
      </div>
    </form>
  );
}
