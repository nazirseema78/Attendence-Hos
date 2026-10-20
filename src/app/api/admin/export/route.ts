import { getAdmin } from "@/lib/auth";
import { BUILDING_TIME_ZONE } from "@/lib/timezone";
import { parseHistoryFilters } from "@/lib/history-params";
import { buildRegister } from "@/lib/reports";

const STATUS_LABEL = { on_time: "On time", late: "Late", absent: "Absent", pending: "Not marked yet" } as const;

const localDateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUILDING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Quote a CSV cell and neutralise spreadsheet formula injection (cells starting with = + - @). */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  if (!(await getAdmin())) return new Response("Unauthorized", { status: 401 });

  const params = new URL(request.url).searchParams;
  const filters = parseHistoryFilters((k) => params.get(k));
  const rows = (await buildRegister({ from: filters.from, to: filters.to, studentId: filters.studentId })).filter(
    (r) => !filters.status || r.status === filters.status,
  );

  const header = ["Date", "Session", "Student", "Phone", "Status", `Marked at (${BUILDING_TIME_ZONE})`, "IP"];
  const lines = [header.map(cell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.sessionDate,
        r.sessionName,
        r.studentName,
        r.phone,
        STATUS_LABEL[r.status],
        r.markedAt ? localDateTime.format(r.markedAt) : "",
        r.ip ?? "",
      ]
        .map(cell)
        .join(","),
    );
  }

  // BOM so Excel opens UTF-8 names correctly.
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="attendance_${filters.from}_to_${filters.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
