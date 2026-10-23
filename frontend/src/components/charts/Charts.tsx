/**
 * Chart primitives. One measure per chart (never a dual axis); colours come from the
 * --viz-* tokens in index.css (validated palette, light and dark steps). Signed
 * measures such as profit use the diverging pair: blue for gains, red for losses,
 * always explained in a text legend so colour never carries meaning alone.
 */
import { type ReactNode, useId, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface Datum {
  label: string;
  value: number | null;
}

interface ChartProps {
  data: Datum[];
  /** Full-precision format for tooltips and the table view. */
  format: (value: number | null) => string;
  /** Short format for axis ticks. */
  axisFormat: (value: number) => string;
  labelFormat?: (label: string) => string;
  /** Colour bars by sign (gains vs losses). */
  signed?: boolean;
  height?: number;
}

const AXIS = { stroke: "var(--viz-axis)", fontSize: 12, tickLine: false } as const;
const fillFor = (value: number | null, signed?: boolean) =>
  signed && (value ?? 0) < 0 ? "var(--viz-negative)" : "var(--viz-series-1)";

/** The subset of Recharts tooltip props this tooltip reads. */
interface TooltipState {
  active?: boolean;
  payload?: readonly { value?: unknown }[];
  label?: unknown;
}

function ChartTooltip({
  active,
  payload,
  label,
  format,
  labelFormat,
}: TooltipState & Pick<ChartProps, "format" | "labelFormat">) {
  if (!active || !payload?.length) return null;
  const raw = payload[0]?.value;
  const value = typeof raw === "number" ? raw : null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="text-muted-foreground">{labelFormat ? labelFormat(String(label)) : String(label ?? "")}</p>
      <p className="font-medium tabular-nums">{format(value)}</p>
    </div>
  );
}

export function TrendAreaChart({ data, format, axisFormat, labelFormat, height = 260 }: ChartProps) {
  const gradientId = useId().replace(/:/g, "");
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--viz-series-1)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--viz-series-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
        <XAxis dataKey="label" {...AXIS} tickFormatter={labelFormat} minTickGap={24} />
        <YAxis {...AXIS} width={64} tickFormatter={axisFormat} axisLine={false} />
        <Tooltip
          cursor={{ stroke: "var(--viz-axis)", strokeDasharray: "3 3" }}
          content={(props) => <ChartTooltip {...props} format={format} labelFormat={labelFormat} />}
        />
        <Area type="monotone" dataKey="value" stroke="var(--viz-series-1)" strokeWidth={2}
          fill={`url(#${gradientId})`} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
          isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ColumnChart({ data, format, axisFormat, labelFormat, signed, height = 260 }: ChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
        <XAxis dataKey="label" {...AXIS} tickFormatter={labelFormat} minTickGap={16} />
        <YAxis {...AXIS} width={64} tickFormatter={axisFormat} axisLine={false} />
        <Tooltip cursor={{ fill: "var(--viz-hover)" }}
          content={(props) => <ChartTooltip {...props} format={format} labelFormat={labelFormat} />} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.label} fill={fillFor(d.value, signed)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars for comparing members of a dimension (labels stay readable). */
export function RankedBarChart({ data, format, axisFormat, signed }: ChartProps) {
  const height = Math.max(120, data.length * 34 + 40);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }} barCategoryGap={4}>
        <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
        <XAxis type="number" {...AXIS} tickFormatter={axisFormat} />
        <YAxis type="category" dataKey="label" {...AXIS} width={120} axisLine={false} />
        <Tooltip cursor={{ fill: "var(--viz-hover)" }} content={(props) => <ChartTooltip {...props} format={format} />} />
        <Bar dataKey="value" radius={4} maxBarSize={24} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.label} fill={fillFor(d.value, signed)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SignedLegend() {
  return (
    <p className="flex items-center gap-4 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-[var(--viz-series-1)]" aria-hidden /> Profit
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-[var(--viz-negative)]" aria-hidden /> Loss
      </span>
    </p>
  );
}

/**
 * Card around a chart with a "Show table" toggle: the table is the accessible and
 * exact view of the same numbers.
 */
export function ChartCard({
  title,
  description,
  summary,
  data,
  format,
  labelFormat,
  valueHeader = "Value",
  footer,
  children,
}: {
  title: string;
  description?: string;
  /** One-sentence text alternative for screen readers. */
  summary: string;
  data: Datum[];
  format: (value: number | null) => string;
  labelFormat?: (label: string) => string;
  valueHeader?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        <CardAction>
          <Button variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
            {showTable ? "Show chart" : "Show table"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {showTable ? (
          <div className="max-h-80 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead className="text-right">{valueHeader}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((d) => (
                  <TableRow key={d.label}>
                    <TableCell>{labelFormat ? labelFormat(d.label) : d.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{format(d.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <figure role="img" aria-label={`${title}. ${summary}`} className="m-0">
            {children}
          </figure>
        )}
        {footer}
      </CardContent>
    </Card>
  );
}
