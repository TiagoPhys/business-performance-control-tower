import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import type { Filters } from "@/api/types";
import { clearFilters, hasActiveFilters, readFilters, writeFilters } from "@/lib/filters";

/** Global filters, read from and written to the URL query string. */
export function useFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);

  const setFilters = useCallback(
    (next: Filters) =>
      setParams((current) => {
        const updated = writeFilters(current, next);
        updated.delete("page"); // a new filter invalidates the current page
        return updated;
      }),
    [setParams],
  );

  const updateFilter = useCallback(
    (patch: Partial<Filters>) => setFilters({ ...filters, ...patch }),
    [filters, setFilters],
  );

  const reset = useCallback(
    () =>
      setParams((current) => {
        const updated = clearFilters(current);
        updated.delete("page");
        return updated;
      }),
    [setParams],
  );

  return { filters, setFilters, updateFilter, reset, active: hasActiveFilters(filters) };
}
