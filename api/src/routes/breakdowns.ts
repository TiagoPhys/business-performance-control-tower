import { queryAll, queryBatch, statement } from "../lib/db";
import { invalidParameter } from "../lib/errors";
import { ok } from "../lib/http";
import { money, ratio, round } from "../lib/metrics";
import { FILTER_PARAMS, type Filters, parseEnum, parseFilters, readParams } from "../lib/params";
import { loadBounds, type Period, resolvePeriod, summaryYearKey } from "../lib/period";
import { ALL, lineSource, orderConditions, whereClause } from "../lib/scope";
import type { RouteContext, Source } from "./types";

const PARAMS = [...FILTER_PARAMS, "dimension"] as const;

/** Fixed allowlist of breakdown dimensions and the columns behind them. */
const DIMENSIONS = {
  region: { level: "order", column: "o.region", summary: "region" },
  segment: { level: "order", column: "o.segment", summary: "segment" },
  category: { level: "product", column: "p.category", summary: "category" },
  subcategory: { level: "product", column: "p.sub_category", summary: null },
} as const;

export type Dimension = keyof typeof DIMENSIONS;
const DIMENSION_NAMES = Object.keys(DIMENSIONS) as Dimension[];
const SUMMARY_DIMS = ["region", "segment", "category"] as const;

export interface BreakdownRow {
  key: string;
  category?: string;
  sales: number | null;
  profit: number | null;
  units: number | null;
  orders: number | null;
  customers: number | null;
  avg_shipping_days: number | null;
}

/** Breakdown from pre-computed tables, or null when the filters don't map onto them. */
export async function breakdownPrecomputed(
  db: D1Database,
  dimension: Dimension,
  filters: Filters,
  yearKey: string,
): Promise<BreakdownRow[] | null> {
  if (dimension === "subcategory") {
    if (filters.region || filters.segment) return null; // sub-category table is by year only
    const clauses = ["order_year = ?"];
    const params: unknown[] = [yearKey];
    if (filters.category) {
      clauses.push("category = ?");
      params.push(filters.category);
    }
    return queryAll<BreakdownRow>(
      statement(
        db,
        "SELECT sub_category AS key, category, sales, profit, units, orders, customers, " +
          `NULL AS avg_shipping_days FROM subcategory_performance${whereClause(clauses)}`,
        params,
      ),
    );
  }
  const clauses = ["order_year = ?"];
  const params: unknown[] = [yearKey];
  for (const dim of SUMMARY_DIMS) {
    const value = filters[dim];
    if (dim === dimension && value === undefined) {
      clauses.push(`${dim} <> '${ALL}'`);
    } else {
      clauses.push(`${dim} = ?`);
      params.push(value ?? ALL);
    }
  }
  return queryAll<BreakdownRow>(
    statement(
      db,
      `SELECT ${dimension} AS key, sales, profit, units, orders, customers, avg_shipping_days ` +
        `FROM kpi_summary${whereClause(clauses)}`,
      params,
    ),
  );
}

/**
 * Breakdown from row-level tables. For product dimensions an order counts once in
 * every category it has lines in, so orders are de-duplicated per (member, order).
 */
export async function breakdownLive(
  db: D1Database,
  dimension: Dimension,
  filters: Filters,
  period: Period | null,
): Promise<BreakdownRow[]> {
  const spec = DIMENSIONS[dimension];
  const withCategory = dimension === "subcategory" ? ", p.category AS category" : "";
  const groupCategory = dimension === "subcategory" ? ", category" : "";
  const lines = lineSource(filters, period, {
    orders: spec.level === "order",
    products: spec.level === "product",
  });
  let orderSql: string;
  let orderParams: unknown[];
  if (spec.level === "order") {
    const { clauses, params } = orderConditions(filters, period);
    if (filters.category) {
      clauses.push(
        "EXISTS (SELECT 1 FROM order_lines l JOIN products p ON p.product_key = l.product_key " +
          "WHERE l.order_id = o.order_id AND p.category = ?)",
      );
      params.push(filters.category);
    }
    orderSql =
      `SELECT ${spec.column} AS key, COUNT(*) AS orders, COUNT(DISTINCT o.customer_id) AS customers, ` +
      `AVG(o.shipping_days) AS avg_shipping_days FROM orders o${whereClause(clauses)} GROUP BY key`;
    orderParams = params;
  } else {
    const shipping = dimension === "subcategory" ? "NULL" : "AVG(shipping_days)";
    const inner = lineSource(filters, period, { orders: true, products: true });
    orderSql =
      `SELECT key${groupCategory}, COUNT(*) AS orders, COUNT(DISTINCT customer_id) AS customers, ` +
      `${shipping} AS avg_shipping_days FROM (SELECT DISTINCT ${spec.column} AS key${withCategory}, ` +
      `o.order_id, o.customer_id, o.shipping_days FROM ${inner.from}${whereClause(inner.clauses)}) ` +
      `GROUP BY key${groupCategory}`;
    orderParams = inner.params;
  }
  const [orderRows, lineRows] = (await queryBatch(db, [
    statement(db, orderSql, orderParams),
    statement(
      db,
      `SELECT ${spec.column} AS key${withCategory}, SUM(l.sales) AS sales, SUM(l.profit) AS profit, ` +
        `SUM(l.quantity) AS units FROM ${lines.from}${whereClause(lines.clauses)} GROUP BY key${groupCategory}`,
      lines.params,
    ),
  ])) as [BreakdownRow[], BreakdownRow[]];
  const byKey = new Map(orderRows.map((row) => [row.key, row]));
  return lineRows.map((row) => ({ ...row, ...pickOrderMeasures(byKey.get(row.key)) }));
}

function pickOrderMeasures(row: BreakdownRow | undefined) {
  return {
    orders: row?.orders ?? 0,
    customers: row?.customers ?? 0,
    avg_shipping_days: row?.avg_shipping_days ?? null,
  };
}

function shape(rows: BreakdownRow[]) {
  const totalSales = rows.reduce((sum, row) => sum + (row.sales ?? 0), 0);
  return rows
    .map((row) => ({
      key: row.key,
      ...(row.category !== undefined ? { category: row.category } : {}),
      sales: money(row.sales),
      profit: money(row.profit),
      profitMargin: ratio(row.profit, row.sales),
      orders: row.orders ?? 0,
      averageOrderValue: ratio(row.sales, row.orders, 2),
      unitsSold: row.units ?? 0,
      customers: row.customers ?? 0,
      averageShippingDays: row.avg_shipping_days == null ? null : round(row.avg_shipping_days, 2),
      shareOfSales: ratio(row.sales, totalSales),
    }))
    .sort((a, b) => b.sales - a.sales || a.key.localeCompare(b.key));
}

export async function breakdowns({ db, url }: RouteContext): Promise<Response> {
  const params = readParams(url, PARAMS);
  const filters = parseFilters(params);
  const dimension = parseEnum("dimension", params.get("dimension"), DIMENSION_NAMES);
  if (!dimension) {
    throw invalidParameter("dimension", "'dimension' is required.", { allowed: DIMENSION_NAMES });
  }
  const bounds = await loadBounds(db);
  const period = resolvePeriod(filters, bounds);
  const yearKey = filters.shipMode ? null : summaryYearKey(period, bounds);
  let rows = yearKey === null ? null : await breakdownPrecomputed(db, dimension, filters, yearKey);
  const source: Source = rows ? "precomputed" : "live";
  rows ??= await breakdownLive(db, dimension, filters, period);
  return ok({ dimension, period, rows: shape(rows) }, { filters, source });
}
