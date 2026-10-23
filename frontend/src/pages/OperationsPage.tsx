import type { ColumnDef } from "@tanstack/react-table";
import { Info } from "lucide-react";
import type { Operations } from "@/api/types";
import { ChartCard, ColumnChart, RankedBarChart } from "@/components/charts/Charts";
import { DataTable, ExportButton } from "@/components/data/DataTable";
import { PageHeader } from "@/components/layout/AppLayout";
import { NoResults, QueryBoundary } from "@/components/states/States";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOperations } from "@/hooks/useApi";
import { useFilters } from "@/hooks/useFilters";
import type { CsvColumn } from "@/lib/csv";
import { formatDateRange, formatDays, formatNumber, formatPercent } from "@/lib/format";

type ShipModeRow = Operations["byShipMode"][number];
type MatrixRow = Operations["matrix"][number];

const dayAxis = (value: number) => `${value}d`;

const shipModeColumns: ColumnDef<ShipModeRow, any>[] = [
  { accessorKey: "shipMode", header: "Ship mode" },
  { accessorKey: "orders", header: "Orders", cell: (c) => formatNumber(c.getValue()), meta: { align: "right" } },
  { accessorKey: "shareOfOrders", header: "Share of orders", cell: (c) => formatPercent(c.getValue()), meta: { align: "right" } },
  { accessorKey: "averageShippingDays", header: "Average", cell: (c) => formatDays(c.getValue(), 2), meta: { align: "right" } },
  { accessorKey: "medianShippingDays", header: "Median", cell: (c) => formatDays(c.getValue()), meta: { align: "right" } },
  { accessorKey: "minShippingDays", header: "Fastest", cell: (c) => formatDays(c.getValue()), meta: { align: "right" } },
  { accessorKey: "maxShippingDays", header: "Slowest", cell: (c) => formatDays(c.getValue()), meta: { align: "right" } },
];

const shipModeCsv: CsvColumn<ShipModeRow>[] = [
  { header: "Ship mode", value: (r) => r.shipMode },
  { header: "Orders", value: (r) => r.orders },
  { header: "Share of orders", value: (r) => r.shareOfOrders },
  { header: "Average days to ship", value: (r) => r.averageShippingDays },
  { header: "Median days to ship", value: (r) => r.medianShippingDays },
  { header: "Fastest (days)", value: (r) => r.minShippingDays },
  { header: "Slowest (days)", value: (r) => r.maxShippingDays },
];

const matrixCsv: CsvColumn<MatrixRow>[] = [
  { header: "Region", value: (r) => r.region },
  { header: "Ship mode", value: (r) => r.shipMode },
  { header: "Orders", value: (r) => r.orders },
  { header: "Average days to ship", value: (r) => r.averageShippingDays },
];

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function RegionModeMatrix({ data }: { data: Operations }) {
  const modes = data.byShipMode.map((m) => m.shipMode);
  const regions = data.byRegion.map((r) => r.region);
  const cell = (region: string, mode: string) => data.matrix.find((m) => m.region === region && m.shipMode === mode);
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableCaption className="sr-only">Average days to ship by region and ship mode</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Region</TableHead>
            {modes.map((mode) => (
              <TableHead key={mode} scope="col" className="text-right">{mode}</TableHead>
            ))}
            <TableHead scope="col" className="text-right">All modes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {regions.map((region) => {
            const total = data.byRegion.find((r) => r.region === region);
            return (
              <TableRow key={region}>
                <TableHead scope="row" className="font-medium">{region}</TableHead>
                {modes.map((mode) => {
                  const value = cell(region, mode);
                  return (
                    <TableCell key={mode} className="text-right tabular-nums">
                      {value ? (
                        <>
                          {formatDays(value.averageShippingDays, 2)}
                          <span className="block text-xs text-muted-foreground">{formatNumber(value.orders)} orders</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">No orders</span>
                      )}
                    </TableCell>
                  );
                })}
                <TableCell className="text-right font-medium tabular-nums">{formatDays(total?.averageShippingDays, 2)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function OperationsPage() {
  const { filters } = useFilters();
  const operations = useOperations(filters);

  return (
    <>
      <PageHeader
        title="Operations"
        description="How long orders take to ship (ship date minus order date), by region and ship mode."
      />
      <Alert>
        <Info aria-hidden />
        <AlertTitle>Why there is no on-time delivery rate</AlertTitle>
        <AlertDescription>
          The dataset records when each order shipped but not when it was promised or delivered. Without a promised date, on-time
          performance cannot be measured, so this page reports time to ship only.
        </AlertDescription>
      </Alert>

      <QueryBoundary query={operations} loadingRows={6}>
        {({ data }) => {
          if (data.summary.orders === 0) return <NoResults what="orders" />;
          const byMode = data.byShipMode.map((m) => ({ label: m.shipMode, value: m.averageShippingDays }));
          const byRegion = data.byRegion.map((r) => ({ label: r.region, value: r.averageShippingDays }));
          const distribution = data.distribution.map((d) => ({ label: String(d.shippingDays), value: d.orders }));
          return (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Period: {formatDateRange(data.period)}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Orders shipped" value={formatNumber(data.summary.orders)} />
                <Stat label="Average days to ship" value={formatDays(data.summary.averageShippingDays, 2)} />
                <Stat label="Median days to ship" value={formatDays(data.summary.medianShippingDays)} />
                <Stat label="Range" value={`${formatNumber(data.summary.minShippingDays)}–${formatDays(data.summary.maxShippingDays)}`}
                  hint="Fastest to slowest order" />
              </div>
              <div className="grid gap-4 xl:grid-cols-3">
                <ChartCard title="Average days to ship by ship mode" summary={`Fastest: ${byMode[0]?.label ?? "n/a"}.`}
                  data={byMode} format={(v) => formatDays(v, 2)} valueHeader="Average days">
                  <RankedBarChart data={byMode} format={(v) => formatDays(v, 2)} axisFormat={dayAxis} />
                </ChartCard>
                <ChartCard title="Average days to ship by region" summary="Average order-to-ship time per region."
                  data={byRegion} format={(v) => formatDays(v, 2)} valueHeader="Average days">
                  <RankedBarChart data={byRegion} format={(v) => formatDays(v, 2)} axisFormat={dayAxis} />
                </ChartCard>
                <ChartCard title="Orders by days to ship" description="Distribution of order-to-ship time"
                  summary="Number of orders by whole days between order and shipment." data={distribution}
                  format={(v) => `${formatNumber(v)} orders`} labelFormat={(l) => formatDays(Number(l))} valueHeader="Orders">
                  <ColumnChart data={distribution} format={(v) => `${formatNumber(v)} orders`} axisFormat={(v) => formatNumber(v)}
                    labelFormat={(l) => `${l}d`} />
                </ChartCard>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Region × ship mode</CardTitle>
                  <CardDescription>Average days to ship, with the number of orders in each cell.</CardDescription>
                  <CardAction>
                    <ExportButton rows={data.matrix} columns={matrixCsv} filename="operations-region-ship-mode.csv" />
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <RegionModeMatrix data={data} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">By ship mode</CardTitle>
                  <CardAction>
                    <ExportButton rows={data.byShipMode} columns={shipModeCsv} filename="operations-ship-mode.csv" />
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <DataTable columns={shipModeColumns} data={data.byShipMode} caption="Days to ship by ship mode"
                    getRowId={(r) => r.shipMode} />
                </CardContent>
              </Card>
            </div>
          );
        }}
      </QueryBoundary>
    </>
  );
}
