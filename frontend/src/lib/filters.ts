/** Global filters live in the URL so every view can be bookmarked and shared. */
import type { Filters } from "@/api/types";

export const FILTER_KEYS = ["start", "end", "region", "segment", "category", "shipMode"] as const;

export type PeriodPreset = { kind: "all" } | { kind: "year"; year: number } | { kind: "custom" };

export function readFilters(params: URLSearchParams): Filters {
  const filters: Filters = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(key)?.trim();
    if (value) filters[key] = value;
  }
  return filters;
}

/** Replace the filter keys in `params`, keeping any page-specific parameters. */
export function writeFilters(params: URLSearchParams, filters: Filters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}

export function clearFilters(params: URLSearchParams): URLSearchParams {
  return writeFilters(params, {});
}

export function hasActiveFilters(filters: Filters): boolean {
  return FILTER_KEYS.some((key) => Boolean(filters[key]));
}

export function yearRange(year: number): Pick<Filters, "start" | "end"> {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

/** Recognise the period selector's state from start/end. */
export function periodPreset(filters: Filters): PeriodPreset {
  if (!filters.start && !filters.end) return { kind: "all" };
  const year = filters.start?.slice(0, 4);
  if (year && filters.start === `${year}-01-01` && filters.end === `${year}-12-31`) {
    return { kind: "year", year: Number(year) };
  }
  return { kind: "custom" };
}

/** Only the filter keys, as a query string to carry across pages ("?region=East"). */
export function filterSearch(filters: Filters): string {
  const query = writeFilters(new URLSearchParams(), filters).toString();
  return query ? `?${query}` : "";
}
