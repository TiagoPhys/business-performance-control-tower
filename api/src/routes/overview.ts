import { queryBatch, queryFirst, statement } from "../lib/db";
import { compareKpis, EMPTY_RAW_KPIS, type Kpis, type RawKpis, toKpis } from "../lib/metrics";
import { FILTER_PARAMS, type Filters, parseFilters, readParams } from "../lib/params";
import { comparisonFor, loadBounds, type Period, resolvePeriod, summaryYearKey } from "../lib/period";
import { lineSource, orderSource, summaryDimensions, whereClause } from "../lib/scope";
import { ok } from "../lib/http";
import type { RouteContext, Source } from "./types";

const SUMMARY_SQL =
  "SELECT sales, profit, units, orders, customers, avg_shipping_days FROM kpi_summary " +
  "WHERE order_year = ? AND region = ? AND segment = ? AND category = ?";

/** Headline KPIs from `kpi_summary`: a single primary-key read. */
export async function overviewPrecomputed(db: D1Database, filters: Filters, yearKey: string): Promise<Kpis> {
  const dims = summaryDimensions(filters);
  const row = await queryFirst<RawKpis>(statement(db, SUMMARY_SQL, [yearKey, dims.region, dims.segment, dims.category]));
  return toKpis(row ?? EMPTY_RAW_KPIS);
}

/**
 * Headline KPIs from row-level tables. Order measures are counted in `orders`; sales,
 * profit and quantity are summed in `order_lines`. Both run in one D1 round trip.
 */
export async function overviewLive(db: D1Database, filters: Filters, period: Period | null): Promise<Kpis> {
  const orders = orderSource(filters, period);
  const lines = lineSource(filters, period);
  const [orderRows, lineRows] = await queryBatch(db, [
    statement(
      db,
      "SELECT COUNT(*) AS orders, COUNT(DISTINCT o.customer_id) AS customers, " +
        `AVG(o.shipping_days) AS avg_shipping_days FROM ${orders.from}${whereClause(orders.clauses)}`,
      orders.params,
    ),
    statement(
      db,
      "SELECT SUM(l.sales) AS sales, SUM(l.profit) AS profit, SUM(l.quantity) AS units " +
        `FROM ${lines.from}${whereClause(lines.clauses)}`,
      lines.params,
    ),
  ]);
  return toKpis({ ...EMPTY_RAW_KPIS, ...(orderRows?.[0] as object), ...(lineRows?.[0] as object) });
}

export async function overview({ db, url }: RouteContext): Promise<Response> {
  const filters = parseFilters(readParams(url, FILTER_PARAMS));
  const bounds = await loadBounds(db);
  const period = resolvePeriod(filters, bounds);
  const yearKey = filters.shipMode ? null : summaryYearKey(period, bounds);
  const source: Source = yearKey === null ? "live" : "precomputed";
  const kpis =
    yearKey === null ? await overviewLive(db, filters, period) : await overviewPrecomputed(db, filters, yearKey);

  const comparison = comparisonFor(period, bounds);
  let comparisonBody: Record<string, unknown> = comparison;
  if (comparison.available) {
    // The previous period rarely aligns with calendar years, so it is always computed live.
    const previous = await overviewLive(db, filters, comparison.period);
    comparisonBody = { ...comparison, kpis: previous, change: compareKpis(kpis, previous) };
  }
  return ok({ period, kpis, comparison: comparisonBody }, { filters, source, dataset: bounds });
}
