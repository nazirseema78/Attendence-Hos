import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { and, eq } from "drizzle-orm";
import { Alert, Card, Skeleton, StatusBadge } from "@/components/ui";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { attemptsFor, MAX_FAILED_ATTEMPTS } from "@/lib/attempts";
import { getCorrections } from "@/lib/corrections";
import { UUID_RE } from "@/lib/media";
import { formatPhone } from "@/lib/phone";
import { isValidIsoDate, sessionEnd, sessionStart } from "@/lib/schedule";
import { CorrectionForm } from "./correction-form";
import { buildingFormat } from "@/lib/timezone";

export const metadata: Metadata = { title: "Correct attendance" };

const dateTime = buildingFormat({
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type Snapshot = { state: string; status: string | null; method: string } | null;
const describe = (s: Snapshot) =>
  !s ? "Nothing recorded" : s.state === "absent" ? "Absent" : `Present · ${s.status === "late" ? "late" : "on time"}`;

export default function CorrectPage(props: PageProps<"/admin/attendance/correct">) {
  return (
    <div className="space-y-4">
      <Link href="/admin" className="text-sm text-muted hover:text-foreground">
        ← Today
      </Link>
      <h1 className="text-2xl font-semibold">Correct attendance</h1>
      <Suspense fallback={<Skeleton className="h-80 w-full" />}>
        <Correct searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function Correct({ searchParams }: Pick<PageProps<"/admin/attendance/correct">, "searchParams">) {
  await requireAdmin();
  const sp = await searchParams;
  const studentId = typeof sp.student === "string" ? sp.student : "";
  const sessionId = Number(sp.session);
  const date = sp.date;
  if (!UUID_RE.test(studentId) || !Number.isInteger(sessionId) || !isValidIsoDate(date)) {
    return <Alert tone="danger">This link is incomplete or invalid. Open the student from the Today page.</Alert>;
  }

  const [[student], [session], [record], history] = await Promise.all([
    db.select().from(schema.students).where(eq(schema.students.id, studentId)),
    db.select().from(schema.attendanceSessions).where(eq(schema.attendanceSessions.id, sessionId)),
    db
      .select()
      .from(schema.attendance)
      .where(
        and(
          eq(schema.attendance.studentId, studentId),
          eq(schema.attendance.sessionId, sessionId),
          eq(schema.attendance.sessionDate, date),
        ),
      ),
    getCorrections(studentId, sessionId, date),
  ]);
  const submissions = await attemptsFor(studentId, sessionId, date);
  const countedFailures = submissions.filter((s) => s.counted).length;
  if (!student || !session) return <Alert tone="danger">Student or session not found.</Alert>;

  const start = record?.occurrenceStart ?? sessionStart(session, date);
  const end = record?.occurrenceEnd ?? sessionEnd(session, date);
  const started = start <= new Date();
  const v = (record?.verification ?? null) as { distance?: number; enrollmentVersion?: number } | null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3">
        <div>
          <Link href={`/admin/students/${student.id}`} className="font-medium hover:text-primary">
            {student.name}
          </Link>
          <p className="text-sm text-muted">{formatPhone(student.phone)}</p>
        </div>
        <p className="text-sm">
          {session.name} · {dateTime.format(start)} → {dateTime.format(end)}
        </p>
        <div className="text-sm">
          Current:{" "}
          {record ? (
            <StatusBadge status={record.state === "absent" || !record.status ? "absent" : record.status} />
          ) : (
            <span className="text-muted">nothing recorded</span>
          )}
          {record && (
            <span className="text-muted">
              {" "}
              · {record.method === "staff" ? "recorded by staff" : "self-marked"} at {dateTime.format(record.markedAt)}
            </span>
          )}
        </div>
        {v && (
          <p className="text-xs text-muted">
            Face distance {v.distance?.toFixed(3)} (lower = closer) · registration v
            {v.enrollmentVersion}
          </p>
        )}
        <div className="flex gap-2">
          {student.photoId && (
            // eslint-disable-next-line @next/next/no-img-element -- private media via authenticated route
            <img src={`/api/media/students/${student.id}/photo?size=thumb`} alt="Registered photo" className="h-24 w-24 rounded-md object-cover" />
          )}
          {record?.selfieId && (
            // eslint-disable-next-line @next/next/no-img-element -- private media via authenticated route
            <img src={`/api/media/attendance/${record.id}?size=thumb`} alt="Attendance image" className="h-24 w-24 rounded-md object-cover" />
          )}
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-medium">Record a correction</h2>
        {started ? (
          <CorrectionForm studentId={student.id} sessionId={session.id} sessionDate={date} />
        ) : (
          <p className="text-sm text-muted">This session hasn&apos;t started yet.</p>
        )}
      </Card>

      <Card className="space-y-3 lg:col-span-2">
        <h2 className="font-medium">Face-check submissions</h2>
        {countedFailures >= MAX_FAILED_ATTEMPTS && (
          <Alert tone="warning">
            This student used all {MAX_FAILED_ATTEMPTS} tries and can&apos;t self-mark this session. Check them in person,
            then record the result above with a reason.
          </Alert>
        )}
        {submissions.length === 0 ? (
          <p className="text-sm text-muted">No face-check submissions for this session.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {submissions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="w-32 shrink-0 text-muted">{dateTime.format(s.finishedAt ?? s.createdAt)}</span>
                <span className="font-medium">
                  {s.state === "succeeded" ? "Matched" : s.counted ? "Rejected (counted)" : "Technical problem (not counted)"}
                </span>
                {s.distance !== null && <span className="text-muted">distance {s.distance.toFixed(3)}</span>}
                {s.state !== "succeeded" && s.reason && <span className="text-muted">{s.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-3 lg:col-span-2">
        <h2 className="font-medium">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted">No corrections for this session.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {history.map((h) => (
              <li key={h.id} className="space-y-0.5 py-2">
                <p>
                  <strong>{h.adminName}</strong> · {dateTime.format(h.createdAt)}
                </p>
                <p className="text-muted">
                  {describe(h.previous as Snapshot)} → {describe(h.next as Snapshot)}
                </p>
                <p>&ldquo;{h.reason}&rdquo;</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
