import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { Alert, Card, Skeleton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getAllowlist, getGraceMinutes, getSessions } from "@/lib/config";
import { isIpAllowed } from "@/lib/ip";
import { getClientIp } from "@/lib/request-ip";
import { minuteToTimeInput } from "@/lib/schedule";
import { removeAllowedIp } from "./actions";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { faceConfigStatus } from "@/lib/face";
import { AddIpForm, GraceForm, RegisterPendingFacesForm, SessionsForm } from "./forms";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Settings />
      </Suspense>
    </div>
  );
}

async function Settings() {
  await requireAdmin();
  const [allowlist, sessions, graceMinutes, currentIp] = await Promise.all([
    getAllowlist(),
    getSessions(),
    getGraceMinutes(),
    getClientIp(),
  ]);
  const currentAllowed = currentIp ? isIpAllowed(currentIp, allowlist.map((a) => a.cidr)) : false;
  const face = faceConfigStatus();
  const [counts] = await db
    .select({
      withPhoto: sql<number>`count(*) filter (where ${schema.students.photoId} is not null)::int`,
      withoutPhoto: sql<number>`count(*) filter (where ${schema.students.photoId} is null)::int`,
      registered: sql<number>`count(*) filter (where exists (select 1 from ${schema.faceEnrollments} f where f.student_id = ${schema.students.id} and f.status = 'active' and f.descriptor is not null))::int`,
    })
    .from(schema.students)
    .where(eq(schema.students.active, true));
  const faceCounts = counts ?? { withPhoto: 0, withoutPhoto: 0, registered: 0 };

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div>
          <h2 className="font-medium">Building network</h2>
          <p className="text-sm text-muted">
            Attendance is accepted only from these IPs. Add the building&apos;s static public IP. If the internet provider
            also gives IPv6, add its IPv6 range too (open this page on a phone connected to the Wi-Fi to see it).
          </p>
        </div>

        {allowlist.length === 0 && (
          <Alert tone="warning">No IPs added yet, so nobody can mark attendance.</Alert>
        )}
        {currentIp && currentAllowed && (
          <Alert tone="success">You are on an allowed network right now ({currentIp}).</Alert>
        )}

        {allowlist.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {allowlist.map((ip) => (
              <li key={ip.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm">{ip.cidr}</p>
                  {ip.label && <p className="text-xs text-muted">{ip.label}</p>}
                </div>
                <form action={removeAllowedIp.bind(null, ip.id)}>
                  <ConfirmSubmit variant="secondary" className="h-8 px-3" message={`Remove ${ip.cidr}?`}>
                    Remove
                  </ConfirmSubmit>
                </form>
              </li>
            ))}
          </ul>
        )}

        <AddIpForm currentIp={currentAllowed ? null : currentIp} />
      </Card>

      <Card className="space-y-3">
        <div>
          <h2 className="font-medium">Face verification</h2>
          <p className="text-sm text-muted">
            Selfies are compared on this server (face-api, no paid service) with each student&apos;s registered photo.
            Students get 3 counted tries per session; after that, review and mark them from the Today page. A face
            match does not prove the person is physically present or that the picture is live.
          </p>
        </div>
        {face.configured ? (
          <Alert tone="success">
            Active. A selfie matches when its face distance is ≤ {face.thresholds.maxDistance} (lower = stricter); the
            face must be detected with confidence ≥ {face.thresholds.minScore}.
          </Alert>
        ) : (
          <Alert tone="warning">
            Not available, so students can&apos;t mark attendance themselves. {face.error}
          </Alert>
        )}
        <p className="text-sm">
          {faceCounts.registered} of {faceCounts.withPhoto} students with a photo have a registered face
          {faceCounts.withoutPhoto > 0 && <> · {faceCounts.withoutPhoto} active students have no photo</>}.
        </p>
        {face.configured && faceCounts.registered < faceCounts.withPhoto && <RegisterPendingFacesForm />}
      </Card>

      <Card className="space-y-4">
        <h2 className="font-medium">Attendance sessions</h2>
        <SessionsForm
          initial={sessions.map((s) => ({
            id: s.id,
            name: s.name,
            start: minuteToTimeInput(s.startMinute),
            end: minuteToTimeInput(s.endMinute),
          }))}
        />
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="font-medium">Late marking</h2>
          <p className="text-sm text-muted">
            Marks within this many minutes of a session starting are &quot;on time&quot;. Later marks in the same session are
            &quot;late&quot;.
          </p>
        </div>
        <GraceForm graceMinutes={graceMinutes} />
      </Card>
    </div>
  );
}
