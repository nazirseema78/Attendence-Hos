// The building's time zone. Session times (e.g. 08:00) are wall-clock times in this zone; all
// stored timestamps are absolute instants. Shared by server and browser code.

const DEFAULT_TIME_ZONE = "Asia/Karachi";

function assertTimeZone(zone: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    throw new Error(`NEXT_PUBLIC_BUILDING_TIMEZONE "${zone}" is not a valid IANA time zone (e.g. Asia/Karachi).`);
  }
}

/** IANA zone, e.g. "Asia/Karachi". Set NEXT_PUBLIC_BUILDING_TIMEZONE to change it (requires a rebuild). */
export const BUILDING_TIME_ZONE = assertTimeZone(process.env.NEXT_PUBLIC_BUILDING_TIMEZONE || DEFAULT_TIME_ZONE);

const LOCALE = "en-PK";
const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string) {
  let f = partsFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(zone, f);
  }
  return f;
}

/** Wall-clock date (YYYY-MM-DD) and minute-of-day of `instant` in `zone`. */
export function wallClock(instant: Date, zone = BUILDING_TIME_ZONE): { date: string; minute: number; second: number } {
  const p = Object.fromEntries(partsFormatter(zone).formatToParts(instant).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minute: Number(p.hour) * 60 + Number(p.minute),
    second: Number(p.second),
  };
}

/** Offset of `zone` from UTC at `utcMs`, in milliseconds. */
function offsetMs(utcMs: number, zone: string): number {
  const w = wallClock(new Date(utcMs), zone);
  const [y, m, d] = w.date.split("-").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, 0, w.minute, w.second);
  return wallAsUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `zone` shows `date` + `minute`.
 * Daylight-saving edge cases: a wall time skipped by a spring-forward is shifted forward by the
 * gap (e.g. 02:30 → 03:30); a repeated wall time (fall-back) resolves to its first occurrence.
 */
export function zonedTimeToUtc(date: string, minute: number, zone = BUILDING_TIME_ZONE): Date {
  const [y, m, d] = date.split("-").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, 0, minute);
  const first = wallAsUtc - offsetMs(wallAsUtc, zone);
  const second = wallAsUtc - offsetMs(first, zone);
  // The passes only disagree inside a spring-forward gap; the later instant is the shifted time.
  return new Date(Math.max(first, second));
}

/** Today's date (YYYY-MM-DD) at the building. */
export function buildingToday(now: Date = new Date()): string {
  return wallClock(now).date;
}

/** Intl formatter fixed to the building's time zone. */
export function buildingFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: BUILDING_TIME_ZONE, ...options });
}
