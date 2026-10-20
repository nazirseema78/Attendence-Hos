import { Suspense } from "react";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Button, Card, cx, Skeleton, StatusBadge } from "@/components/ui";
import { getStudentHistory, getStudentToday } from "@/lib/attendance";
import { attemptsLeftFor } from "@/lib/attempts";
import { requireStudent } from "@/lib/auth";
import { CONSENT_NOTICE, hasActiveConsent } from "@/lib/consent";
import { getActiveEnrollment } from "@/lib/enrollment";
import { faceConfigStatus } from "@/lib/face";
import { buildingFormat } from "@/lib/timezone";
import { acceptConsent, revokeConsent } from "./attendance-actions";
import { AttendanceFlow } from "./attendance-flow";
import { studentLogout } from "./login/actions";

export default function StudentHomePage() {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
      <Suspense fallback={<HomeSkeleton />}>
        <StudentHome />
      </Suspense>
    </main>
  );
}

const timeFormat = buildingFormat({ hour: "numeric", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("en-PK", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });

type Rec = { state: "present" | "absent"; status: "on_time" | "late" | null };
const badgeOf = (r: Rec) => (r.state === "absent" || !r.status ? "absent" : r.status);

async function StudentHome() {
  const student = await requireStudent();
  const [today, consented, enrollment, history] = await Promise.all([
    getStudentToday(student.id),
    hasActiveConsent(student.id),
    getActiveEnrollment(student.id),
    getStudentHistory(student.id),
  ]);
  const { active, record } = today;
  const verification = faceConfigStatus();
  const attemptsLeft = active ? await attemptsLeftFor(student.id, active.sessionId, active.sessionDate) : 0;

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Welcome</p>
          <h1 className="text-xl font-semibold">{student.name}</h1>
        </div>
        <form action={studentLogout}>
          <Button variant="secondary" type="submit">
            Log out
          </Button>
        </form>
      </header>

      <section aria-label="Today's sessions" className="space-y-2">
        <p className="text-sm text-muted">{dayFormat.format(new Date(`${today.dayDate}T00:00:00Z`))}</p>
        <ul className="grid gap-2">
          {today.day.map((s) => (
            <li
              key={s.sessionId}
              aria-current={s.state === "open" ? "true" : undefined}
              className={cx(
                "flex items-center justify-between gap-3 rounded-xl border bg-surface px-4 py-3",
                s.state === "open" ? "border-primary ring-2 ring-primary/20" : "border-border",
              )}
            >
              <div>
                <p className="font-medium">{s.name}</p>
                <p className="text-xs text-muted">{s.window}</p>
              </div>
              {s.record ? (
                <StatusBadge status={badgeOf(s.record)} />
              ) : s.state === "open" ? (
                <span className="rounded-full bg-success-bg px-2 py-0.5 text-xs text-success">Open now</span>
              ) : s.state === "upcoming" ? (
                <span className="text-xs text-muted">Not started</span>
              ) : (
                <StatusBadge status="absent" />
              )}
            </li>
          ))}
        </ul>
      </section>

      {!active && <Alert tone="warning">No attendance session is open right now.</Alert>}

      {active && record && (
        <Card className="space-y-2 text-center" role="status">
          {record.state === "present" && record.status ? (
            <>
              <p className="text-lg font-semibold">Attendance marked ✓</p>
              <p className="text-sm text-muted">
                {active.name} · {timeFormat.format(record.markedAt)}
                {record.method === "staff" && " · recorded by the warden"}
              </p>
              <StatusBadge status={record.status} />
            </>
          ) : (
            <p className="text-sm">The warden has recorded you as absent for this session. Contact them if this is wrong.</p>
          )}
        </Card>
      )}

      {active && !record && (
        <Card className="space-y-1">
          <p className="text-sm">
            {active.status === "on_time" ? (
              <>
                Mark before <strong>{active.onTimeUntil}</strong> to be on time.
              </>
            ) : (
              <span className="text-warning">The on-time window has passed. You can still mark as late.</span>
            )}
          </p>
        </Card>
      )}

      {active && !record && !consented && (
        <Card className="space-y-3">
          <h2 className="font-medium">Face check notice</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {CONSENT_NOTICE.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <form action={acceptConsent}>
            <SubmitButton className="w-full">I agree</SubmitButton>
          </form>
          <p className="text-xs text-muted">If you don&apos;t agree, the warden can mark your attendance manually instead.</p>
        </Card>
      )}

      {active && !record && consented && !enrollment && (
        <Alert tone="warning">
          Face registration required: the warden has not registered a clear photo of you yet, so you can&apos;t mark
          attendance here. Ask them to upload one.
        </Alert>
      )}

      {active && !record && consented && enrollment && !verification.configured && (
        <Alert tone="warning">
          Face verification is not available on the server right now, so attendance can&apos;t be marked here. Ask the
          warden to mark you.
        </Alert>
      )}

      {active && !record && consented && enrollment && verification.configured && attemptsLeft === 0 && (
        <Alert tone="danger">
          You have used all 3 face-check tries for {active.name}. Ask the warden to review and mark your attendance.
        </Alert>
      )}

      {active && !record && consented && enrollment && verification.configured && attemptsLeft > 0 && (
        <AttendanceFlow key={`${active.sessionId}-${active.sessionDate}`} sessionName={active.name} attemptsLeft={attemptsLeft} />
      )}

      {history.length > 0 && (
        <section aria-label="My attendance" className="space-y-2">
          <h2 className="font-medium">My attendance</h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 px-4 py-2">
                <span>
                  {h.sessionDate} · {h.sessionName}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  {timeFormat.format(h.markedAt)}
                  <StatusBadge status={badgeOf(h)} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {consented && (
        <form action={revokeConsent} className="pt-2 text-center">
          <ConfirmSubmit
            variant="secondary"
            className="h-8 text-xs"
            message="Withdraw consent for face checks? You won't be able to mark attendance yourself until you agree again."
          >
            Withdraw face-check consent
          </ConfirmSubmit>
        </form>
      )}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-12 w-1/2" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
