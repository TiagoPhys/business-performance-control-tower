import { FilterX } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { Filters } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMeta } from "@/hooks/useApi";
import { useFilters } from "@/hooks/useFilters";
import { periodPreset, yearRange } from "@/lib/filters";

const ALL = "all";
const CUSTOM = "custom";

type DimensionKey = "region" | "segment" | "category" | "shipMode";
const DIMENSIONS: { key: DimensionKey; label: string; allLabel: string }[] = [
  { key: "region", label: "Region", allLabel: "All regions" },
  { key: "segment", label: "Segment", allLabel: "All segments" },
  { key: "category", label: "Category", allLabel: "All categories" },
  { key: "shipMode", label: "Ship mode", allLabel: "All ship modes" },
];

function FilterSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex min-w-36 flex-1 flex-col gap-1.5 sm:flex-none">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full sm:w-44">
          <SelectValue>{options.find((option) => option.value === value)?.label ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function CustomRange({
  filters,
  bounds,
  onApply,
}: {
  filters: Filters;
  bounds: { minDate: string; maxDate: string } | null;
  onApply: (range: Pick<Filters, "start" | "end">) => void;
}) {
  const startId = useId();
  const endId = useId();
  const [start, setStart] = useState(filters.start ?? bounds?.minDate ?? "");
  const [end, setEnd] = useState(filters.end ?? bounds?.maxDate ?? "");
  useEffect(() => {
    setStart(filters.start ?? bounds?.minDate ?? "");
    setEnd(filters.end ?? bounds?.maxDate ?? "");
  }, [filters.start, filters.end, bounds]);
  const invalid = Boolean(start && end && start > end);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={startId} className="text-xs text-muted-foreground">
          From
        </Label>
        <Input id={startId} type="date" value={start} min={bounds?.minDate} max={bounds?.maxDate}
          onChange={(e) => setStart(e.target.value)} aria-invalid={invalid} className="w-40" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={endId} className="text-xs text-muted-foreground">
          To
        </Label>
        <Input id={endId} type="date" value={end} min={bounds?.minDate} max={bounds?.maxDate}
          onChange={(e) => setEnd(e.target.value)} aria-invalid={invalid} className="w-40" />
      </div>
      <Button variant="secondary" disabled={invalid || !start || !end} onClick={() => onApply({ start, end })}>
        Apply
      </Button>
      {invalid && (
        <p role="alert" className="w-full text-xs text-destructive">
          The start date must be on or before the end date.
        </p>
      )}
    </div>
  );
}

export function FilterBar() {
  const { filters, updateFilter, reset, active } = useFilters();
  const meta = useMeta();
  const preset = periodPreset(filters);
  const [customOpen, setCustomOpen] = useState(preset.kind === "custom");
  useEffect(() => {
    if (preset.kind === "custom") setCustomOpen(true);
  }, [preset.kind]);

  const periodValue = customOpen ? CUSTOM : preset.kind === "year" ? String(preset.year) : ALL;
  const years = meta.data?.data.years ?? [];
  const options = meta.data?.data.filters;
  const bounds = meta.data?.data.dataset ?? null;

  const onPeriodChange = (value: string) => {
    if (value === CUSTOM) {
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    updateFilter(value === ALL ? { start: undefined, end: undefined } : yearRange(Number(value)));
  };

  return (
    <section aria-label="Filters" className="flex flex-wrap items-end gap-3">
      <FilterSelect
        label="Period"
        value={periodValue}
        onChange={onPeriodChange}
        disabled={meta.isPending}
        options={[
          { value: ALL, label: "All time" },
          ...years.map((year) => ({ value: String(year), label: String(year) })),
          { value: CUSTOM, label: "Custom range…" },
        ]}
      />
      {customOpen && <CustomRange filters={filters} bounds={bounds} onApply={(range) => updateFilter(range)} />}
      {DIMENSIONS.map(({ key, label, allLabel }) => (
        <FilterSelect
          key={key}
          label={label}
          value={filters[key] ?? ALL}
          disabled={!options}
          onChange={(value) => updateFilter({ [key]: value === ALL ? undefined : value })}
          options={[{ value: ALL, label: allLabel }, ...(options?.[key] ?? []).map((v) => ({ value: v, label: v }))]}
        />
      ))}
      <Button
        variant="ghost"
        onClick={() => {
          setCustomOpen(false);
          reset();
        }}
        disabled={!active}
      >
        <FilterX aria-hidden /> Clear filters
      </Button>
      {meta.error ? (
        <p role="alert" className="w-full text-xs text-destructive">
          Filter options could not be loaded from the API.
        </p>
      ) : null}
    </section>
  );
}
