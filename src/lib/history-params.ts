import { UUID_RE } from "./media";
import type { RegisterStatus } from "./reports";
import { addDays, dateRange, isValidIsoDate, localToday } from "./schedule";

export const MAX_RANGE_DAYS = 62;
const STATUSES = ["on_time", "late", "absent", "pending"] as const;

export type HistoryFilters = {
  from: string;
  to: string;
  studentId?: string;
  status?: RegisterStatus;
  error?: string;
};

/** Parse and clamp history/export filters from query params. Defaults to the last 7 days. */
export function parseHistoryFilters(get: (key: string) => string | null | undefined, now = new Date()): HistoryFilters {
  const today = localToday(now);
  let to = get("to") ?? "";
  let from = get("from") ?? "";
  if (!isValidIsoDate(to)) to = today;
  if (!isValidIsoDate(from)) from = addDays(to, -6);
  let error: string | undefined;
  if (from > to) [from, to] = [to, from];
  if (dateRange(from, to).length > MAX_RANGE_DAYS) {
    from = addDays(to, -(MAX_RANGE_DAYS - 1));
    error = `Showing the last ${MAX_RANGE_DAYS} days of the range (maximum).`;
  }
  const student = get("student") ?? "";
  const status = get("status") ?? "";
  return {
    from,
    to,
    studentId: UUID_RE.test(student) ? student : undefined,
    status: (STATUSES as readonly string[]).includes(status) ? (status as RegisterStatus) : undefined,
    error,
  };
}
