import { queryAll, queryBatch, statement } from "../lib/db";
import { ok } from "../lib/http";
import { money, ratio } from "../lib/metrics";
import { FILTER_PARAMS, type Filters, parseEnum, parseFilters, readParams } from "../lib/params";
import {
  bucketsBetween,
  type DatasetBounds,
  type Granularity,
  loadBounds,
  monthRange,
  type Period,
  resolvePeriod,
} from "../lib/period";
import { lineSource, orderSource, summaryDimensions, whereClause } from "../lib/scope";
import type { RouteContext, Source } from "./types";

const PARAMS = [...FILTER_PARAMS, "granularity"] as const;
const GRANULARITIES = ["month", "quarter", "year"] as const;

// Fixed SQL expressions per granularity; never built from input.
const quarterOf = (date: string) =>
  `substr(${date}, 1, 4) || '-Q' || ((CAST(substr(${date}, 6, 2) AS INTEGER) + 2) / 3)`;
const SUMMARY_BUCKET: Record<Granularity, string> = {
  month: "order_month",
  quarter: quarterOf("order_month"),
  year: "substr(order_month, 1, 4)",
};
const LIVE_BUCKET: Record<Granularity, string> = {
  month: "substr(o.order_date, 1, 7)",
  quarter: quarterOf("o.order_date"),
  year: "substr(o.order_date, 1, 4)",
};

export interface BucketRow {
  bucket: string;
  sales: number | null;
  profit: number | null;
  units: number | null;
  orders: number | null;
}

/** Trend from `kpi_monthly`. Orders are additive over time: each order has one date. */
export async function trendsPrecomputed(
  db: D1Database,
  filters: Filters,
  granularity: Granularity,
  months: { from: string; to: string },
): Promise<BucketRow[]> {
  const dims = summaryDimensions(filters);
  const bucket = SUMMARY_BUCKET[granularity];
  return queryAll<BucketRow>(
    statement(
      db,
      `SELECT ${bucket} AS bucket, SUM(sales) AS sales, SUM(profit) AS profit, SUM(units) AS units, ` +
        "SUM(orders) AS orders FROM kpi_monthly " +
        "WHERE region = ? AND segment = ? AND category = ? AND order_month BETWEEN ? AND ? " +
        "GROUP BY bucket ORDER BY bucket",
      [dims.region, dims.segment, dims.category, months.from, months.to],
    ),
  );
}

/** Trend from row-level tables: orders counted in `orders`, measures summed in lines. */
export async function trendsLive(
  db: D1Database,
  filters: Filters,
  period: Period | null,
  granularity: Granularity,
): Promise<BucketRow[]> {
  const bucket = LIVE_BUCKET[granularity];
  const orders = orderSource(filters, period);
  const lines = lineSource(filters, period, { orders: true });
  const [orderRows, lineRows] = (await queryBatch(db, [
    statement(
      db,
      `SELECT ${bucket} AS bucket, COUNT(*) AS orders FROM ${orders.from}${whereClause(orders.clauses)} ` +
        "GROUP BY bucket",
      orders.params,
    ),
    statement(
      db,
      `SELECT ${bucket} AS bucket, SUM(l.sales) AS sales, SUM(l.profit) AS profit, SUM(l.quantity) AS units ` +
        `FROM ${lines.from}${whereClause(lines.clauses)} GROUP BY bucket`,
      lines.params,
    ),
  ])) as [BucketRow[], BucketRow[]];
  const counts = new Map(orderRows.map((row) => [row.bucket, row.orders]));
  return lineRows
    .map((row) => ({ ...row, orders: counts.get(row.bucket) ?? 0 }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

/** Labels to show: the requested period clipped to the data's date range. */
function labelsFor(period: Period | null, bounds: DatasetBounds | null, granularity: Granularity): string[] {
  if (!period || !bounds) return [];
  const start = period.start > bounds.minDate ? period.start : bounds.minDate;
  const end = period.end < bounds.maxDate ? period.end : bounds.maxDate;
  return start <= end ? bucketsBetween(start, end, granularity) : [];
}

export async function trends({ db, url }: RouteContext): Promise<Response> {
  const params = readParams(url, PARAMS);
  const filters = parseFilters(params);
  const granularity = parseEnum("granularity", params.get("granularity"), GRANULARITIES) ?? "month";
  const bounds = await loadBounds(db);
  const period = resolvePeriod(filters, bounds);
  const months = filters.shipMode ? null : monthRange(period, bounds);
  const source: Source = months ? "precomputed" : "live";
  const rows = months
    ? await trendsPrecomputed(db, filters, granularity, months)
    : await trendsLive(db, filters, period, granularity);

  const byBucket = new Map(rows.map((row) => [row.bucket, row]));
  const points = labelsFor(period, bounds, granularity).map((label) => {
    const row = byBucket.get(label);
    const orders = row?.orders ?? 0;
    return {
      period: label,
      sales: money(row?.sales),
      profit: money(row?.profit),
      profitMargin: ratio(row?.profit, row?.sales),
      orders,
      unitsSold: row?.units ?? 0,
      averageOrderValue: ratio(row?.sales, orders, 2),
    };
  });
  return ok({ granularity, period, points }, { filters, source });
}
