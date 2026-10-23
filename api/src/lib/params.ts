import { invalidParameter, ApiError } from "./errors";

// Fixed allowlists. Values are matched case-insensitively and returned in canonical form.
export const REGIONS = ["Central", "East", "South", "West"] as const;
export const SEGMENTS = ["Consumer", "Corporate", "Home Office"] as const;
export const CATEGORIES = ["Furniture", "Office Supplies", "Technology"] as const;
export const SHIP_MODES = ["First Class", "Same Day", "Second Class", "Standard Class"] as const;

export const FILTER_PARAMS = ["start", "end", "region", "segment", "category", "shipMode"] as const;

const MAX_PARAM_LENGTH = 64;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

export interface Filters {
  start?: string;
  end?: string;
  region?: (typeof REGIONS)[number];
  segment?: (typeof SEGMENTS)[number];
  category?: (typeof CATEGORIES)[number];
  shipMode?: (typeof SHIP_MODES)[number];
}

/**
 * Return the query parameters as a plain map, rejecting unknown names, repeated
 * names and over-long values before any of them is interpreted.
 */
export function readParams(url: URL, allowed: readonly string[]): Map<string, string> {
  const params = new Map<string, string>();
  for (const [name, value] of url.searchParams) {
    if (!allowed.includes(name)) {
      throw new ApiError(400, "unknown_parameter", `Unknown query parameter '${truncate(name)}'.`, {
        parameter: truncate(name),
        allowed: [...allowed],
      });
    }
    if (params.has(name)) throw invalidParameter(name, `Parameter '${name}' must be given only once.`);
    if (value.length > MAX_PARAM_LENGTH) {
      throw invalidParameter(name, `Parameter '${name}' is longer than ${MAX_PARAM_LENGTH} characters.`);
    }
    params.set(name, value.trim());
  }
  return params;
}

function truncate(text: string): string {
  return text.length > MAX_PARAM_LENGTH ? `${text.slice(0, MAX_PARAM_LENGTH)}…` : text;
}

/** Match `value` case-insensitively against an allowlist; return the canonical member. */
export function parseEnum<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === "") return undefined;
  const match = allowed.find((option) => option.toLowerCase() === value.toLowerCase());
  if (!match) {
    throw invalidParameter(name, `Invalid value for '${name}'.`, { allowed: [...allowed] });
  }
  return match;
}

/** Parse a strict `YYYY-MM-DD` calendar date (rejects e.g. 2016-02-30). */
export function parseDate(name: string, value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  const match = DATE_PATTERN.exec(value);
  if (!match) throw invalidParameter(name, `'${name}' must be a date in YYYY-MM-DD format.`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!valid) throw invalidParameter(name, `'${name}' is not a valid calendar date.`);
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw invalidParameter(name, `'${name}' must be between ${MIN_YEAR} and ${MAX_YEAR}.`);
  }
  return value;
}

/** Parse a base-10 integer within [min, max], or return the default when absent. */
export function parseInteger(
  name: string,
  value: string | undefined,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): number {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw invalidParameter(name, `'${name}' must be a whole number.`);
  const number = Number(value);
  if (number < min || number > max) {
    throw invalidParameter(name, `'${name}' must be between ${min} and ${max}.`, { min, max });
  }
  return number;
}

/** Parse the shared time-period and dimension filters. */
export function parseFilters(params: Map<string, string>): Filters {
  const filters: Filters = {
    start: parseDate("start", params.get("start")),
    end: parseDate("end", params.get("end")),
    region: parseEnum("region", params.get("region"), REGIONS),
    segment: parseEnum("segment", params.get("segment"), SEGMENTS),
    category: parseEnum("category", params.get("category"), CATEGORIES),
    shipMode: parseEnum("shipMode", params.get("shipMode"), SHIP_MODES),
  };
  if (filters.start && filters.end && filters.start > filters.end) {
    throw invalidParameter("start", "'start' must be on or before 'end'.");
  }
  return Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)) as Filters;
}
