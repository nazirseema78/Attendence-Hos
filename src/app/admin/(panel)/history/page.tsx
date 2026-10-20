import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { asc } from "drizzle-orm";
import { Alert, buttonClass, Card, Field, Input, inputClass, Skeleton, StatusBadge } from "@/components/ui";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { parseHistoryFilters } from "@/lib/history-params";
import { buildRegister } from "@/lib/reports";
import { buildingFormat } from "@/lib/timezone";

export const metadata: Metadata = { title: "History" };

const MAX_ROWS = 1000;
const dateTime = buildingFormat({ day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function HistoryPage(props: PageProps<"/admin/history">) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">History</h1>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <History searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function History({ searchParams }: Pick<PageProps<"/admin/history">, "searchParams">) {
  await requireAdmin();
  const sp = await searchParams;
  const filters = parseHistoryFilters((k) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined));

  const [students, register] = await Promise.all([
    db.select({ id: schema.students.id, name: schema.students.name }).from(schema.students).orderBy(asc(schema.students.name)),
    buildRegister({ from: filters.from, to: filters.to, studentId: filters.studentId }),
  ]);

  const rows = register
    .filter((r) => !filters.status || r.status === filters.status)
    .sort((a, b) => (a.sessionDate === b.sessionDate ? 0 : a.sessionDate < b.sessionDate ? 1 : -1));
  const totals = { on_time: 0, late: 0, absent: 0, pending: 0 };
  for (const r of register) totals[r.status]++;

  const exportQuery = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    ...(filters.studentId && { student: filters.studentId }),
    ...(filters.status && { status: filters.status }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_1fr_auto] sm:items-end">
          <Field label="From">
            <Input type="date" name="from" defaultValue={filters.from} />
          </Field>
          <Field label="To">
            <Input type="date" name="to" defaultValue={filters.to} />
          </Field>
          <Field label="Student">
            <select name="student" defaultValue={filters.studentId ?? ""} className={inputClass}>
              <option value="">All students</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select name="status" defaultValue={filters.status ?? ""} className={inputClass}>
              <option value="">Any</option>
              <option value="on_time">On time</option>
              <option value="late">Late</option>
              <option value="absent">Absent</option>
              <option value="pending">Not marked yet</option>
            </select>
          </Field>
          <button className={buttonClass()}>Show</button>
        </form>
      </Card>

      {filters.error && <Alert tone="warning">{filters.error}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className="text-success">{totals.on_time} on time</span> · <span className="text-warning">{totals.late} late</span> ·{" "}
          <span className="text-danger">{totals.absent} absent</span>
        </p>
        <a href={`/api/admin/export?${exportQuery}`} className={buttonClass("secondary")}>
          Download CSV
        </a>
      </div>

      <Card className="overflow-x-auto p-0 sm:p-0">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">No records for these filters.</p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Session</th>
                <th className="px-4 py-2 font-medium">Student</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Marked at</th>
                <th className="px-4 py-2 font-medium">Selfie</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.slice(0, MAX_ROWS).map((r) => (
                <tr key={`${r.sessionDate}-${r.sessionId}-${r.studentId}`}>
                  <td className="px-4 py-2 whitespace-nowrap">{r.sessionDate}</td>
                  <td className="px-4 py-2">{r.sessionName}</td>
                  <td className="px-4 py-2">
                    <Link href={`/admin/students/${r.studentId}`} className="hover:text-primary">
                      {r.studentName}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-muted">{r.markedAt ? dateTime.format(r.markedAt) : "—"}</td>
                  <td className="px-4 py-2">
                    {r.hasSelfie ? (
                      <a href={`/api/media/attendance/${r.attendanceId}`} target="_blank" rel="noreferrer" className="text-primary">
                        View
                      </a>
                    ) : r.attendanceId ? (
                      <span className="text-xs text-muted">Expired</span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length > MAX_ROWS && (
          <p className="border-t border-border p-3 text-center text-xs text-muted">
            Showing the first {MAX_ROWS} of {rows.length} rows. Download the CSV for everything.
          </p>
        )}
      </Card>
    </div>
  );
}
