/** One place for every user-visible number and date format. Missing values render as an em dash. */

export const MISSING = "—";
const LOCALE = "en-US";

const currency = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const currencyCents = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const currencyCompact = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat(LOCALE, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const monthFormat = new Intl.DateTimeFormat(LOCALE, { year: "numeric", month: "short", timeZone: "UTC" });

type Maybe = number | null | undefined;
const isMissing = (value: Maybe): value is null | undefined => value === null || value === undefined || Number.isNaN(value);

export function formatCurrency(value: Maybe, { cents = false, compact = false } = {}): string {
  if (isMissing(value)) return MISSING;
  if (compact) return currencyCompact.format(value);
  return (cents ? currencyCents : currency).format(value);
}

export function formatNumber(value: Maybe): string {
  return isMissing(value) ? MISSING : integer.format(value);
}

/** A ratio (0.1247) as a percentage ("12.5%"). */
export function formatPercent(value: Maybe, digits = 1): string {
  if (isMissing(value)) return MISSING;
  return `${(value * 100).toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/** A ratio change with an explicit sign ("+20.4%", "−3.1%"). */
export function formatSignedPercent(value: Maybe, digits = 1): string {
  if (isMissing(value)) return MISSING;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatPercent(Math.abs(value), digits)}`;
}

/** A change in a ratio, in percentage points ("+1.2 pp"). */
export function formatPointChange(value: Maybe): string {
  if (isMissing(value)) return MISSING;
  const points = value * 100;
  const sign = points > 0 ? "+" : points < 0 ? "−" : "";
  return `${sign}${Math.abs(points).toFixed(1)} pp`;
}

export function formatDays(value: Maybe, digits = 1): string {
  if (isMissing(value)) return MISSING;
  const text = value.toLocaleString(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  return `${text} ${value === 1 ? "day" : "days"}`;
}

export function formatSignedDays(value: Maybe): string {
  if (isMissing(value)) return MISSING;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatDays(Math.abs(value), 2)}`;
}

/** An ISO date ("2017-01-01") as "Jan 1, 2017", independent of the viewer's time zone. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return MISSING;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? MISSING : dateFormat.format(date);
}

export function formatDateRange(period: { start: string; end: string } | null | undefined): string {
  if (!period) return MISSING;
  return `${formatDate(period.start)} – ${formatDate(period.end)}`;
}

/** Trend bucket labels: "2016-01" -> "Jan 2016"; quarters and years pass through. */
export function formatBucket(bucket: string): string {
  if (/^\d{4}-\d{2}$/.test(bucket)) return monthFormat.format(new Date(`${bucket}-01T00:00:00Z`));
  return bucket.replace("-Q", " Q");
}
