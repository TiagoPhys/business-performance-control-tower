import type { ColumnDef } from "@tanstack/react-table";
import { useSearchParams } from "react-router";
import type { BreakdownRow, Dimension } from "@/api/types";
import { ChartCard, RankedBarChart, SignedLegend } from "@/components/charts/Charts";
import { DataTable, ExportButton } from "@/components/data/DataTable";
import { PageHeader } from "@/components/layout/AppLayout";
import { NoResults, QueryBoundary } from "@/components/states/States";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InsightsPanel } from "@/features/insights/InsightCard";
import { useBreakdowns, useInsights } from "@/hooks/useApi";
import { useFilters } from "@/hooks/useFilters";
import type { CsvColumn } from "@/lib/csv";
import { formatCurrency, formatDays, formatNumber, formatPercent } from "@/lib/format";

export const DIMENSIONS: { value: Dimension; label: string }[] = [
  { value: "region", label: "Region" },
  { value: "segment", label: "Segment" },
  { value: "category", label: "Category" },
  { value: "subcategory", label: "Sub-category" },
];

const compact = (value: number) => formatCurrency(value, { compact: true });

export function breakdownColumns(dimension: Dimension): ColumnDef<BreakdownRow, any>[] {
  const label = DIMENSIONS.find((d) => d.value === dimension)?.label ?? "Member";
  const columns: ColumnDef<BreakdownRow, any>[] = [{ accessorKey: "key", header: label }];
  if (dimension === "subcategory") columns.push({ accessorKey: "category", header: "Category" });
  columns.push(
    { accessorKey: "sales", header: "Sales", cell: (c) => formatCurrency(c.getValue()), meta: { align: "right" } },
    { accessorKey: "shareOfSales", header: "Share of sales", cell: (c) => formatPercent(c.getValue()), meta: { align: "right" } },
    { accessorKey: "profit", header: "Profit", cell: (c) => formatCurrency(c.getValue()), meta: { align: "right" } },
    { accessorKey: "profitMargin", header: "Margin", cell: (c) => formatPercent(c.getValue()), meta: { align: "right" } },
    { accessorKey: "orders", header: "Orders", cell: (c) => formatNumber(c.getValue()), meta: { align: "right" } },
    { accessorKey: "averageOrderValue", header: "Avg. order", cell: (c) => formatCurrency(c.getValue(), { cents: true }), meta: { align: "right" } },
    { accessorKey: "unitsSold", header: "Units", cell: (c) => formatNumber(c.getValue()), meta: { align: "right" } },
    { accessorKey: "customers", header: "Customers", cell: (c) => formatNumber(c.getValue()), meta: { align: "right" } },
  );
  if (dimension !== "subcategory") {
    columns.push({ accessorKey: "averageShippingDays", header: "Avg. days to ship", cell: (c) => formatDays(c.getValue(), 2), meta: { align: "right" } });
  }
  return columns;
}

const csvColumns: CsvColumn<BreakdownRow>[] = [
  { header: "Member", value: (r) => r.key },
  { header: "Category", value: (r) => r.category },
  { header: "Sales", value: (r) => r.sales },
  { header: "Share of sales", value: (r) => r.shareOfSales },
  { header: "Profit", value: (r) => r.profit },
  { header: "Profit margin", value: (r) => r.profitMargin },
  { header: "Orders", value: (r) => r.orders },
  { header: "Average order value", value: (r) => r.averageOrderValue },
  { header: "Units", value: (r) => r.unitsSold },
  { header: "Customers", value: (r) => r.customers },
  { header: "Average days to ship", value: (r) => r.averageShippingDays },
];

export function DriversPage() {
  const { filters } = useFilters();
  const [params, setParams] = useSearchParams();
  const raw = params.get("dimension");
  const dimension: Dimension = DIMENSIONS.some((d) => d.value === raw) ? (raw as Dimension) : "region";
  const breakdowns = useBreakdowns(filters, dimension);
  const insights = useInsights({ section: "drivers" });
  const label = DIMENSIONS.find((d) => d.value === dimension)!.label.toLowerCase();

  return (
    <>
      <PageHeader
        title="Performance Drivers"
        description="Compare sales, profit and margin across regions, segments, categories and sub-categories for the selected filters."
      />
      <Tabs
        value={dimension}
        onValueChange={(value) => setParams((p) => { const next = new URLSearchParams(p); next.set("dimension", value); return next; })}
      >
        <TabsList aria-label="Compare by">
          {DIMENSIONS.map((d) => (
            <TabsTrigger key={d.value} value={d.value}>
              {d.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={dimension} className="mt-2">
      <QueryBoundary query={breakdowns} loadingRows={6}>
        {({ data }) => {
          if (data.rows.length === 0) return <NoResults what={`${label} results`} />;
          const sales = data.rows.map((r) => ({ label: r.key, value: r.sales }));
          const profit = [...data.rows].sort((a, b) => b.profit - a.profit).map((r) => ({ label: r.key, value: r.profit }));
          return (
            <div className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-2">
                <ChartCard title={`Sales by ${label}`} summary={`Largest: ${sales[0]!.label}.`} data={sales}
                  format={(v) => formatCurrency(v)} valueHeader="Sales">
                  <RankedBarChart data={sales} format={(v) => formatCurrency(v)} axisFormat={compact} />
                </ChartCard>
                <ChartCard title={`Profit by ${label}`} summary="Losses are shown in red." data={profit}
                  format={(v) => formatCurrency(v)} valueHeader="Profit" footer={<SignedLegend />}>
                  <RankedBarChart data={profit} signed format={(v) => formatCurrency(v)} axisFormat={compact} />
                </ChartCard>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Comparison by {label}</CardTitle>
                  <CardDescription>
                    {dimension === "category" || dimension === "subcategory"
                      ? "An order with lines in several categories counts once in each, so order counts can add up to more than the total."
                      : "Each order belongs to exactly one member."}
                  </CardDescription>
                  <CardAction>
                    <ExportButton rows={data.rows} columns={csvColumns} filename={`breakdown-${dimension}.csv`} />
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <DataTable columns={breakdownColumns(dimension)} data={data.rows} caption={`Comparison by ${label}`}
                    initialSorting={[{ id: "sales", desc: true }]} getRowId={(r) => r.key} />
                </CardContent>
              </Card>
            </div>
          );
        }}
      </QueryBoundary>
        </TabsContent>
      </Tabs>

      <QueryBoundary query={insights}>
        {({ data }) => (data.items.length ? <InsightsPanel insights={data.items} title="Driver insights" /> : null)}
      </QueryBoundary>
    </>
  );
}
