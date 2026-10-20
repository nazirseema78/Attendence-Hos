import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, ChevronLeft, ChevronRight, Clock3, Filter, ImageOff, ShieldAlert, Users } from "lucide-react";
import { Suspense } from "react";
import { PendingLink } from "@/components/pending-link";
import { Alert, buttonClass, Card, cx, EmptyState, Input, PageHeader, Skeleton, StatusBadge } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getGraceMinutes, getSessions } from "@/lib/config";
import { buildRegister, getRejectedAttempts, type RegisterRow, type RegisterStatus } from "@/lib/reports";
import {
  addDays,
  formatMinute,
  isValidIsoDate,
  localToday,
  resolveActiveSession,
  sessionEnd,
  sessionStart,
} from "@/lib/schedule";
import { buildingFormat } from "@/lib/timezone";

export const metadata: Metadata = { title: "Today" };

const time = buildingFormat({ hour: "numeric", minute: "2-digit" });
const dateTime = buildingFormat({
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
const longDate = new Intl.DateTimeFormat("en-PK", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

type Filter = RegisterStatus | "all";
const STATUS_FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "on_time", label: "On time" },
  { key: "late", label: "Late" },
  { key: "absent", label: "Absent" },
  { key: "pending", label: "Not marked yet" },
];

type OccurrenceState = "not_started" | "open" | "closed";

export default function DashboardPage(props: PageProps<"/admin">) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Dashboard({ searchParams }: Pick<PageProps<"/admin">, "searchParams">) {
  await requireAdmin();
  const sp = await searchParams;
  const now = new Date();

  const [sessions, graceMinutes] = await Promise.all([getSessions(), getGraceMinutes()]);
  if (sessions.length === 0) {
    return (
      <Card>
        <p className="text-sm">
          No attendance sessions are set up.{" "}
          <Link href="/admin/settings" className="text-primary">
            Add them in Settings →
          </Link>
        </p>
      </Card>
    );
  }

  // --- Validate URL state. Bad values fall back to defaults with a visible notice, never a crash.
  const notices: string[] = [];
  const active = resolveActiveSession(now, sessions, graceMinutes);

  let date = active?.sessionDate ?? localToday(now);
  if (sp.date !== undefined) {
    if (isValidIsoDate(sp.date)) date = sp.date;
    else notices.push("The date in the link is not valid, so today is shown instead.");
  }

  const defaultSession = active && active.sessionDate === date ? active.session : sessions[0];
  let session = defaultSession;
  if (sp.session !== undefined) {
    const found = sessions.find((s) => String(s.id) === sp.session);
    if (found) session = found;
    else notices.push(`That session doesn't exist (it may have been removed), so ${defaultSession.name} is shown instead.`);
  }

  let filter: Filter = "all";
  if (sp.status !== undefined) {
    const found = STATUS_FILTERS.find((f) => f.key === sp.status);
    if (found) filter = found.key;
    else notices.push("Unknown status filter in the link; showing everyone.");
  }

  // --- Load data for this date (all sessions, for the card counts) and the selected occurrence.
  const occStart = sessionStart(session, date);
  const occEnd = sessionEnd(session, date);
  const [register, rejected] = await Promise.all([
    buildRegister({ from: date, to: date, now, sessions }),
    occStart <= now ? getRejectedAttempts(occStart, occEnd) : Promise.resolve([]),
  ]);

  const stateOf = (s: (typeof sessions)[number]): OccurrenceState =>
    now < sessionStart(s, date) ? "not_started" : now >= sessionEnd(s, date) ? "closed" : "open";
  const countsOf = (sessionId: number) => {
    const c: Record<RegisterStatus, number> = { on_time: 0, late: 0, absent: 0, pending: 0 };
    for (const r of register) if (r.sessionId === sessionId) c[r.status]++;
    return c;
  };

  const state = stateOf(session);
  const eligible = register.filter((r) => r.sessionId === session.id);
  const rows = filter === "all" ? eligible : eligible.filter((r) => r.status === filter);

  const href = (params: { date?: string; session?: number; status?: Filter }) =>
    `/admin?${new URLSearchParams({
      date: params.date ?? date,
      session: String(params.session ?? session.id),
      status: params.status ?? filter,
    })}`;

  return (
    <div className="space-y-5">
      {notices.map((n) => (
        <Alert key={n} tone="warning">
          {n}
        </Alert>
      ))}

      <PageHeader
        icon={CalendarCheck}
        title={date === localToday(now) || date === active?.sessionDate ? "Today" : "Attendance"}
        description={longDate.format(new Date(`${date}T00:00:00Z`))}
        actions={
          <>
            <PendingLink href={href({ date: addDays(date, -1) })} className={buttonClass("secondary", "px-3")} aria-label="Previous day">
              <ChevronLeft aria-hidden className="h-4 w-4" />
              <span className="hidden sm:inline">Prev</span>
            </PendingLink>
            <form className="flex gap-2" aria-label="Go to date">
              <input type="hidden" name="session" value={session.id} />
              <input type="hidden" name="status" value={filter} />
              <label className="sr-only" htmlFor="dashboard-date">
                Date
              </label>
              <Input id="dashboard-date" type="date" name="date" defaultValue={date} min="2000-01-01" max="2100-12-31" className="w-40" />
              <button className={buttonClass("secondary")}>Go</button>
            </form>
            <PendingLink href={href({ date: addDays(date, 1) })} className={buttonClass("secondary", "px-3")} aria-label="Next day">
              <span className="hidden sm:inline">Next</span>
              <ChevronRight aria-hidden className="h-4 w-4" />
            </PendingLink>
            {date !== (active?.sessionDate ?? localToday(now)) && (
              <PendingLink href="/admin" className={buttonClass("ghost")}>
                Back to today
              </PendingLink>
            )}
          </>
        }
      />

      <nav aria-label="Sessions" className="grid gap-3 sm:grid-cols-3">
        {sessions.map((s) => {
          const c = countsOf(s.id);
          const st = stateOf(s);
          const selected = s.id === session.id;
          const hours = `${formatMinute(s.startMinute)} – ${formatMinute(s.endMinute)}`;
          return (
            <PendingLink
              key={s.id}
              href={href({ session: s.id, status: "all" })}
              aria-current={selected ? "page" : undefined}
              className={cx(
                "block rounded-xl border bg-surface p-4 shadow-sm transition-colors",
                selected ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/40",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">{s.name}</span>
                {st === "open" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
                    Open now
                  </span>
                )}
                {st === "closed" && <span className="text-xs text-muted">Closed</span>}
              </span>
              <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                <Clock3 aria-hidden className="h-3.5 w-3.5" />
                {hours}
              </span>
              <span className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium">
                {st === "not_started" ? (
                  <span className="text-muted">Not started yet</span>
                ) : (
                  <>
                    <span className="text-success">{c.on_time} on time</span>
                    <span className="text-warning">{c.late} late</span>
                    <span className="text-danger">{c.absent} absent</span>
                    {c.pending > 0 && <span className="text-muted">{c.pending} not marked yet</span>}
                  </>
                )}
              </span>
            </PendingLink>
          );
        })}
      </nav>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-foreground">{session.name}</h2>
            <p className="text-xs text-muted">
              {dateTime.format(occStart)} → {dateTime.format(occEnd)} · on time until{" "}
              {time.format(new Date(occStart.getTime() + graceMinutes * 60_000))}
            </p>
          </div>
          {state !== "not_started" && (
            <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((f) => {
                const n = f.key === "all" ? eligible.length : eligible.filter((r) => r.status === f.key).length;
                return (
                  <PendingLink
                    key={f.key}
                    href={href({ status: f.key })}
                    aria-current={filter === f.key ? "true" : undefined}
                    className={cx(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      filter === f.key
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-surface text-muted hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    {f.label}
                    <span className="sr-only">,</span> <span className="opacity-75">{n}</span>
                  </PendingLink>
                );
              })}
            </nav>
          )}
        </div>

        {state === "not_started" ? (
          <EmptyState icon={Clock3}>This session hasn&apos;t started yet. It opens at {dateTime.format(occStart)}.</EmptyState>
        ) : eligible.length === 0 ? (
          <EmptyState icon={Users}>
            No eligible students for this session.{" "}
            <Link href="/admin/students/new" className="font-medium text-primary">
              Add a student →
            </Link>
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState icon={Filter}>
            No records match this filter.{" "}
            <PendingLink href={href({ status: "all" })} className="font-medium text-primary">
              Show everyone
            </PendingLink>
          </EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <RosterCard key={r.studentId} row={r} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert aria-hidden className="h-4 w-4 text-warning" />
          <h2 className="font-semibold text-foreground">Rejected attempts · {session.name}</h2>
        </div>
        <p className="text-xs text-muted">
          Attempts refused during this session. Many &quot;not on building Wi-Fi&quot; rejections from one IP may mean the
          building&apos;s IP changed. Check Settings.
        </p>
        {state === "not_started" ? (
          <p className="text-sm text-muted">The session hasn&apos;t started yet.</p>
        ) : rejected.length === 0 ? (
          <p className="text-sm text-muted">None.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {rejected.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-3 gap-y-1 py-2">
                <span className="w-20 shrink-0 text-muted">{time.format(a.at)}</span>
                <span className="font-medium">{a.studentName ?? "Unknown"}</span>
                <span className="text-muted">{a.reason}</span>
                <span className="ml-auto font-mono text-xs text-muted">{a.ip}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function RosterCard({ row }: { row: RegisterRow }) {
  return (
    <li className="flex gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex shrink-0 gap-1.5">
        <Thumb src={row.hasPhoto ? `/api/media/students/${row.studentId}/photo` : null} label="Registered photo" />
        <Thumb src={row.hasSelfie ? `/api/media/attendance/${row.attendanceId}` : null} label="Selfie" />
      </div>
      <div className="min-w-0 space-y-1">
        <Link href={`/admin/students/${row.studentId}`} className="block truncate font-medium hover:text-primary">
          {row.studentName}
        </Link>
        <StatusBadge status={row.status} />
        {row.markedAt && (
          <p className="text-xs text-muted">
            {time.format(row.markedAt)}
            {row.method === "staff" && " · by staff"}
            {row.distance !== null && ` · face distance ${row.distance.toFixed(2)}`}
          </p>
        )}
        {row.method === "self" && !row.hasSelfie && <p className="text-xs text-muted">Selfie expired</p>}
        <Link
          href={`/admin/attendance/correct?${new URLSearchParams({ student: row.studentId, session: String(row.sessionId), date: row.sessionDate })}`}
          className="text-xs text-primary"
        >
          Correct…
        </Link>
      </div>
    </li>
  );
}

function Thumb({ src, label }: { src: string | null; label: string }) {
  if (!src) {
    return (
      <div title={`${label}: none`} className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-border text-subtle">
        <ImageOff aria-hidden className="h-4 w-4" />
        <span className="sr-only">{label}: none</span>
      </div>
    );
  }
  return (
    <a href={src} target="_blank" rel="noreferrer" title={`${label}, open full size`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- private media served through our authenticated route */}
      <img src={`${src}?size=thumb`} alt={label} loading="lazy" className="h-16 w-16 rounded-md object-cover" />
    </a>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading attendance">
      <Skeleton className="h-12 w-64" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}
