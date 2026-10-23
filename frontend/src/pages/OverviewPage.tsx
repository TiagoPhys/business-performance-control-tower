import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { ChartCard, ColumnChart, SignedLegend, TrendAreaChart } from "@/components/charts/Charts";
import { KpiGrid } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/AppLayout";
import { NoResults, QueryBoundary } from "@/components/states/States";
import { Button } from "@/components/ui/button";
import { InsightsPanel } from "@/features/insights/InsightCard";
import { useInsights, useOverview, useTrends } from "@/hooks/useApi";
import { useFilters } from "@/hooks/useFilters";
import { filterSearch } from "@/lib/filters";
import { formatBucket, formatCurrency, formatDateRange } from "@/lib/format";

const compact = (value: number) => formatCurrency(value, { compact: true });

export function OverviewPage() {
  const { filters } = useFilters();
  const overview = useOverview(filters);
  const trends = useTrends(filters, "month");
  const insights = useInsights();

  return (
    <>
      <PageHeader
        title="Overview"
        description="Headline sales, profit and order KPIs for the selected filters, compared with the previous period of the same length."
      />

      <section aria-label="Key performance indicators" className="space-y-2">
        <QueryBoundary query={overview} loadingRows={4}>
          {({ data }) =>
            data.kpis.orders === 0 ? (
              <NoResults what="orders" />
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Period: {formatDateRange(data.period)}</p>
                <KpiGrid kpis={data.kpis} comparison={data.comparison} />
              </>
            )
          }
        </QueryBoundary>
      </section>

      <section aria-label="Monthly evolution" className="grid gap-4 xl:grid-cols-2">
        <QueryBoundary query={trends} loadingRows={6}>
          {({ data }) => {
            if (data.points.every((p) => p.orders === 0)) return <NoResults what="monthly data" />;
            const sales = data.points.map((p) => ({ label: p.period, value: p.sales }));
            const profit = data.points.map((p) => ({ label: p.period, value: p.profit }));
            return (
              <>
                <ChartCard
                  title="Monthly sales"
                  summary={`Sales by month from ${formatBucket(sales[0]!.label)} to ${formatBucket(sales.at(-1)!.label)}.`}
                  data={sales}
                  format={(v) => formatCurrency(v)}
                  labelFormat={formatBucket}
                  valueHeader="Sales"
                >
                  <TrendAreaChart data={sales} format={(v) => formatCurrency(v)} axisFormat={compact} labelFormat={formatBucket} />
                </ChartCard>
                <ChartCard
                  title="Monthly profit"
                  summary="Profit by month; months with a loss are shown in red."
                  data={profit}
                  format={(v) => formatCurrency(v)}
                  labelFormat={formatBucket}
                  valueHeader="Profit"
                  footer={<SignedLegend />}
                >
                  <ColumnChart data={profit} signed format={(v) => formatCurrency(v)} axisFormat={compact} labelFormat={formatBucket} />
                </ChartCard>
              </>
            );
          }}
        </QueryBoundary>
      </section>

      <QueryBoundary query={insights}>
        {({ data }) => {
          const top = data.items.filter((i) => i.severity !== "info").slice(0, 4);
          return top.length === 0 ? null : (
            <div className="space-y-3">
              <InsightsPanel insights={top} title="Priority insights" />
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link to={`/drivers${filterSearch(filters)}`}>
                    Performance drivers <ArrowRight aria-hidden />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link to={`/products${filterSearch(filters)}`}>
                    Product performance <ArrowRight aria-hidden />
                  </Link>
                </Button>
              </div>
            </div>
          );
        }}
      </QueryBoundary>
    </>
  );
}
