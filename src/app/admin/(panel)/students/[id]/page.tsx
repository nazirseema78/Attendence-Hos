import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { desc, eq } from "drizzle-orm";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Card, Skeleton, StatusBadge } from "@/components/ui";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { UUID_RE } from "@/lib/media";
import { formatPhone } from "@/lib/phone";
import { getConsentStatus, CONSENT_NOTICE_VERSION } from "@/lib/consent";
import { getActiveEnrollment, getLatestEnrollment } from "@/lib/enrollment";
import { faceConfigStatus } from "@/lib/face";
import { recheckFace, resetStudentDevice, setStudentActive, setStudentPassword, updateStudent } from "../actions";
import { StudentForm } from "../student-form";
import { PasswordForm } from "./password-form";
import { buildingFormat } from "@/lib/timezone";

export const metadata: Metadata = { title: "Student" };

const dateTime = buildingFormat({
  dateStyle: "medium",
  timeStyle: "short",
});



export default function StudentPage(props: PageProps<"/admin/students/[id]">) {
  return (
    <div className="space-y-4">
      <Link href="/admin/students" className="text-sm text-muted hover:text-foreground">
        ← Students
      </Link>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <StudentDetail params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function StudentDetail({
  params,
  searchParams,
}: Pick<PageProps<"/admin/students/[id]">, "params" | "searchParams">) {
  await requireAdmin();
  const { id } = await params;
  const { created } = await searchParams;
  if (!UUID_RE.test(id)) notFound();

  const [student] = await db.select().from(schema.students).where(eq(schema.students.id, id));
  if (!student) notFound();

  const recent = await db
    .select({
      id: schema.attendance.id,
      sessionDate: schema.attendance.sessionDate,
      status: schema.attendance.status,
      state: schema.attendance.state,
      method: schema.attendance.method,
      markedAt: schema.attendance.markedAt,
      sessionName: schema.attendanceSessions.name,
    })
    .from(schema.attendance)
    .innerJoin(schema.attendanceSessions, eq(schema.attendance.sessionId, schema.attendanceSessions.id))
    .where(eq(schema.attendance.studentId, id))
    .orderBy(desc(schema.attendance.markedAt))
    .limit(20);

  const [activeEnrollment, latestEnrollment, consent] = await Promise.all([
    getActiveEnrollment(id),
    getLatestEnrollment(id),
    getConsentStatus(id),
  ]);
  const faceReady = faceConfigStatus().configured;
  const consentActive = consent && !consent.withdrawnAt && consent.noticeVersion === CONSENT_NOTICE_VERSION;

  const isPdf = student.idCardFormat === "pdf";

  return (
    <div className="space-y-4">
      {created && <Alert tone="success">Student added. Share the phone number and password with them.</Alert>}

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{student.name}</h1>
        {!student.active && <span className="rounded-full bg-danger-bg px-2 py-0.5 text-xs text-danger">Inactive</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-3">
          <h2 className="font-medium">Photo & ID card</h2>
          <div className="grid grid-cols-2 gap-3">
            <MediaTile
              label="Photo"
              src={student.photoId ? `/api/media/students/${id}/photo` : null}
            />
            <MediaTile
              label={isPdf ? "ID card (PDF)" : "ID card"}
              src={student.idCardId ? `/api/media/students/${id}/id-card` : null}
            />
          </div>
          <dl className="space-y-1 pt-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Phone</dt>
              <dd>{formatPhone(student.phone)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Guardian</dt>
              <dd>{formatPhone(student.guardianPhone)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Added</dt>
              <dd>{dateTime.format(student.createdAt)}</dd>
            </div>
          </dl>
        </Card>

        <Card className="space-y-4 lg:col-span-2">
          <h2 className="font-medium">Details</h2>
          <StudentForm
            action={updateStudent.bind(null, id)}
            mode="edit"
            initial={{ name: student.name, phone: student.phone, guardianPhone: student.guardianPhone }}
            hasPhoto={Boolean(student.photoId)}
            hasIdCard={Boolean(student.idCardId)}
          />
        </Card>

        <Card className="space-y-3">
          <h2 className="font-medium">Face registration</h2>
          {activeEnrollment ? (
            <p className="text-sm">
              <span className="rounded-full bg-success-bg px-2 py-0.5 text-xs text-success">Registered</span>{" "}
              <span className="text-muted">
                version {activeEnrollment.version}, checked {activeEnrollment.checkedAt ? dateTime.format(activeEnrollment.checkedAt) : "—"}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted">Not registered. The student can&apos;t mark attendance until a clear photo is registered.</p>
          )}
          {latestEnrollment && latestEnrollment.status !== "active" && latestEnrollment.status !== "retired" && (
            <p className="text-sm text-warning">
              Latest photo (version {latestEnrollment.version}): {latestEnrollment.status === "pending" ? "waiting for the face check" : "rejected"}
              {latestEnrollment.statusReason && <> · {latestEnrollment.statusReason}</>}
            </p>
          )}
          {!faceReady && <p className="text-xs text-muted">Face verification is not available on the server. See Settings.</p>}
          {student.photoId && faceReady && (
            <form action={recheckFace.bind(null, id)}>
              <SubmitButton variant="secondary" pendingText="Checking…">
                Check current photo again
              </SubmitButton>
            </form>
          )}
          <p className="border-t border-border pt-2 text-xs text-muted">
            Face-check consent:{" "}
            {consentActive
              ? `given ${dateTime.format(consent.givenAt)}`
              : consent?.withdrawnAt
                ? `withdrawn ${dateTime.format(consent.withdrawnAt)}. Mark attendance manually.`
                : "not given yet (asked at the student's next attendance)."}
          </p>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-medium">Linked phone</h2>
          {student.deviceBoundAt ? (
            <>
              <p className="text-sm text-muted">
                Locked to the phone used on {dateTime.format(student.deviceBoundAt)}. Reset this if the student
                changed phones, cleared browser data or uses a different browser.
              </p>
              <form action={resetStudentDevice.bind(null, id)}>
                <ConfirmSubmit
                  variant="secondary"
                  message="Reset the linked phone? The student's next login will lock the account to whichever phone they use."
                >
                  Reset device
                </ConfirmSubmit>
              </form>
            </>
          ) : (
            <p className="text-sm text-muted">Not linked yet. It will lock to the first phone the student logs in from.</p>
          )}
        </Card>

        <Card className="space-y-3">
          <h2 className="font-medium">Password</h2>
          <PasswordForm action={setStudentPassword.bind(null, id)} />
        </Card>

        <Card className="space-y-3">
          <h2 className="font-medium">Account</h2>
          <p className="text-sm text-muted">
            {student.active
              ? "Deactivated students cannot log in or mark attendance. Their records are kept."
              : "This student cannot log in. Reactivate to allow attendance again."}
          </p>
          <form action={setStudentActive.bind(null, id, !student.active)}>
            <ConfirmSubmit
              variant={student.active ? "danger" : "secondary"}
              message={student.active ? `Deactivate ${student.name}?` : `Reactivate ${student.name}?`}
            >
              {student.active ? "Deactivate" : "Reactivate"}
            </ConfirmSubmit>
          </form>
        </Card>
      </div>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Recent attendance</h2>
          <Link href={`/admin/history?student=${id}`} className="text-sm text-primary">
            Full history →
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-muted">No attendance yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {r.sessionDate} · {r.sessionName}
                </span>
                <span className="flex items-center gap-2 text-muted">
                  {dateTime.format(r.markedAt)}
                  {r.method === "staff" && " · by staff"}
                  <StatusBadge status={r.state === "absent" || !r.status ? "absent" : r.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function MediaTile({ label, src }: { label: string; src: string | null }) {
  return (
    <div className="space-y-1">
      {src ? (
        <a href={src} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element -- private media served through our authenticated route */}
          <img src={`${src}?size=thumb`} alt={label} className="aspect-square w-full rounded-lg border border-border object-cover" />
        </a>
      ) : (
        <div className="grid aspect-square place-items-center rounded-lg border border-dashed border-border text-xs text-muted">
          No file
        </div>
      )}
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}
