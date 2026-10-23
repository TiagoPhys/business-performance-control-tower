import { ArrowDownRight, ArrowUpRight, Info, Minus } from "lucide-react";
import type { Change, Comparison, KpiKey, Kpis } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COMPARISON_NOTE, KPI_DEFINITIONS, type KpiDefinition } from "@/lib/definitions";
import { formatDateRange, formatPointChange, formatSignedDays, formatSignedPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

function changeText(definition: KpiDefinition, change: Change): string {
  if (definition.change === "points") return formatPointChange(change.absolute);
  if (definition.change === "days") return formatSignedDays(change.absolute);
  return formatSignedPercent(change.percent);
}

function ChangeBadge({ definition, change }: { definition: KpiDefinition; change: Change }) {
  const value = definition.change === "percent" ? change.percent : change.absolute;
  if (value === null) {
    return <span className="text-xs text-muted-foreground">No comparable value</span>;
  }
  const direction = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const good = direction === "flat" ? null : (direction === "up") === definition.higherIsBetter;
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium",
        good === true && "text-[var(--status-good-text)]",
        good === false && "text-[var(--status-critical-text)]",
        good === null && "text-muted-foreground",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {changeText(definition, change)}
      <span className="sr-only">{good === null ? "(no change)" : good ? "(improvement)" : "(deterioration)"}</span>
    </span>
  );
}

export function KpiCard({
  definition,
  value,
  comparison,
}: {
  definition: KpiDefinition;
  value: number | null;
  comparison: Comparison;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="flex flex-row items-start justify-between gap-2 px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">{definition.label}</CardTitle>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="-mt-1.5 -mr-2 size-7"
              aria-label={`How is ${definition.label.toLowerCase()} calculated?`}>
              <Info className="size-4" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 text-sm">
            <p className="font-medium">{definition.label}</p>
            <p className="mt-1 text-muted-foreground">{definition.formula}</p>
            <p className="mt-2 text-xs text-muted-foreground">{COMPARISON_NOTE}</p>
          </PopoverContent>
        </Popover>
      </CardHeader>
      <CardContent className="space-y-1 px-4">
        <p className="text-2xl font-semibold tabular-nums">{definition.format(value)}</p>
        {comparison.available ? (
          <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <ChangeBadge definition={definition} change={comparison.change[definition.key]} />
            <span>vs {formatDateRange(comparison.period)}</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {comparison.reason === "insufficient_history"
              ? "No comparison: not enough history before this period"
              : "No comparison available"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function KpiGrid({ kpis, comparison, keys }: { kpis: Kpis; comparison: Comparison; keys?: KpiKey[] }) {
  const definitions = keys ? KPI_DEFINITIONS.filter((d) => keys.includes(d.key)) : KPI_DEFINITIONS;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {definitions.map((definition) => (
        <KpiCard key={definition.key} definition={definition} value={kpis[definition.key]} comparison={comparison} />
      ))}
    </div>
  );
}
