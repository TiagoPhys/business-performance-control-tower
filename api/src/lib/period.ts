import { queryAll, statement } from "./db";
import type { Filters } from "./params";

export interface DatasetBounds {
  minDate: string;
  maxDate: string;
}

export interface Period {
  start: string;
  end: string;
  days: number;
}

export type Comparison =
  | { available: true; period: Period }
  | { available: false; reason: "no_data" | "insufficient_history"; period?: Period };

const DAY_MS = 86_400_000;

/** First and last order date, from the pipeline's metadata (two primary-key reads). */
export async function loadBounds(db: D1Database): Promise<DatasetBounds | null> {
  const rows = await queryAll<{ key: string; value: string }>(
    statement(db, "SELECT key, value FROM dataset_metadata WHERE key IN ('min_order_date', 'max_order_date')"),
  );
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const minDate = values.get("min_order_date");
  const maxDate = values.get("max_order_date");
  return minDate && maxDate ? { minDate, maxDate } : null;
}

function toUtc(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  return new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function makePeriod(start: string, end: string): Period {
  return { start, end, days: Math.round((toUtc(end) - toUtc(start)) / DAY_MS) + 1 };
}

/**
 * The period a request covers. Missing `start`/`end` default to the first/last order
 * date. Returns null only when the dataset is empty and no explicit range was given.
 */
export function resolvePeriod(filters: Filters, bounds: DatasetBounds | null): Period | null {
  let start = filters.start ?? bounds?.minDate;
  let end = filters.end ?? bounds?.maxDate;
  if (!start || !end) return null;
  // A one-sided range outside the data: keep it valid (and empty) rather than inverted.
  if (start > end) {
    if (!filters.start) start = end;
    else end = start;
  }
  return makePeriod(start, end);
}

/** The period of the same length that ends the day before `period` starts. */
export function previousPeriod(period: Period): Period {
  const end = addDays(period.start, -1);
  return makePeriod(addDays(end, -(period.days - 1)), end);
}

/**
 * The comparison period, if the data can support it. Coverage is taken to start on the
 * first day of the month of the earliest order (the data is monthly in nature: the
 * first order falls a few days into January), so a previous period starting before
 * that has insufficient history.
 */
export function comparisonFor(period: Period | null, bounds: DatasetBounds | null): Comparison {
  if (!period || !bounds) return { available: false, reason: "no_data" };
  const previous = previousPeriod(period);
  const coverageStart = `${bounds.minDate.slice(0, 7)}-01`;
  if (previous.start < coverageStart) {
    return { available: false, reason: "insufficient_history", period: previous };
  }
  return { available: true, period: previous };
}

/**
 * The `order_year` key of the pre-computed tables that matches `period` exactly:
 * `ALL` for a period covering all data, `YYYY` for a full calendar year, else null.
 */
export function summaryYearKey(period: Period | null, bounds: DatasetBounds | null): string | null {
  if (!period) return "ALL";
  if (bounds && period.start <= bounds.minDate && period.end >= bounds.maxDate) return "ALL";
  const year = period.start.slice(0, 4);
  if (period.start === `${year}-01-01` && period.end === `${year}-12-31`) return year;
  return null;
}

function lastDayOfMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

/**
 * The month range matching `period` exactly, for pre-computed monthly data: null if
 * the period starts or ends mid-month (unless it covers all data anyway).
 */
export function monthRange(
  period: Period | null,
  bounds: DatasetBounds | null,
): { from: string; to: string } | null {
  if (!period) return { from: "0000-01", to: "9999-12" };
  if (bounds && period.start <= bounds.minDate && period.end >= bounds.maxDate) {
    return { from: "0000-01", to: "9999-12" };
  }
  const from = period.start.slice(0, 7);
  const to = period.end.slice(0, 7);
  if (period.start !== `${from}-01` || period.end !== lastDayOfMonth(to)) return null;
  return { from, to };
}

export type Granularity = "month" | "quarter" | "year";

/** Every bucket label between two dates, so trends have no silent gaps. */
export function bucketsBetween(start: string, end: string, granularity: Granularity): string[] {
  const labels: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const endYear = Number(end.slice(0, 4));
  const endMonth = Number(end.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    labels.push(bucketLabel(year, month, granularity));
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return [...new Set(labels)];
}

function bucketLabel(year: number, month: number, granularity: Granularity): string {
  if (granularity === "year") return String(year);
  if (granularity === "quarter") return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
  return `${year}-${String(month).padStart(2, "0")}`;
}
