import { queryBatch, statement } from "../lib/db";
import { ok } from "../lib/http";
import { money, ratio, round } from "../lib/metrics";
import { FILTER_PARAMS, type Filters, parseEnum, parseFilters, parseInteger, readParams } from "../lib/params";
import { loadBounds, type Period, resolvePeriod, summaryYearKey } from "../lib/period";
import { lineSource, whereClause } from "../lib/scope";
import type { RouteContext, Source } from "./types";

const PARAMS = [...FILTER_PARAMS, "q", "sort", "order", "page", "pageSize"] as const;

export const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE = 1000;

/** Fixed allowlist: public sort name -> SQL ordering expression (output aliases). */
const SORTS = {
  sales: "sales",
  profit: "profit",
  profitMargin: "profit_margin",
  unitsSold: "units",
  orders: "orders",
  averageDiscount: "avg_discount",
  name: "product_name COLLATE NOCASE",
} as const;
const DIRECTIONS = { asc: "ASC", desc: "DESC" } as const;

type Sort = keyof typeof SORTS;
type Direction = keyof typeof DIRECTIONS;

export interface ProductQuery {
  /** Case-insensitive substring of the product name or ID. */
  search?: string;
  sort: Sort;
  order: Direction;
  page: number;
  pageSize: number;
}

interface ProductRow {
  product_key: number;
  product_id: string;
  product_name: string;
  category: string | null;
  sub_category: string | null;
  sales: number | null;
  profit: number | null;
  units: number | null;
  orders: number | null;
  avg_discount: number | null;
}

const PRODUCT_COLUMNS = "p.product_key AS product_key, p.product_id, p.product_name, p.category, p.sub_category";

function orderBy(query: ProductQuery): string {
  // Product key breaks ties so pages never overlap or skip rows.
  return ` ORDER BY ${SORTS[query.sort]} ${DIRECTIONS[query.order]}, product_key ASC LIMIT ? OFFSET ?`;
}

function pageParams(query: ProductQuery): number[] {
  return [query.pageSize, (query.page - 1) * query.pageSize];
}

/** Add the product search condition; LIKE wildcards in the input are escaped. */
function addSearch(query: ProductQuery, clauses: string[], params: unknown[]): void {
  if (!query.search) return;
  const pattern = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
  clauses.push("(p.product_name LIKE ? ESCAPE '\\' OR p.product_id LIKE ? ESCAPE '\\')");
  params.push(pattern, pattern);
}

/** Page of products from `product_performance` (year-level filters and category only). */
export async function productsPrecomputed(
  db: D1Database,
  filters: Filters,
  yearKey: string,
  query: ProductQuery,
): Promise<{ rows: ProductRow[]; total: number }> {
  const clauses = ["pp.order_year = ?"];
  const params: unknown[] = [yearKey];
  if (filters.category) {
    clauses.push("p.category = ?");
    params.push(filters.category);
  }
  addSearch(query, clauses, params);
  const from = ` FROM product_performance pp JOIN products p ON p.product_key = pp.product_key${whereClause(clauses)}`;
  const [rows, count] = await queryBatch(db, [
    statement(
      db,
      `SELECT ${PRODUCT_COLUMNS}, pp.sales AS sales, pp.profit AS profit, pp.units AS units, ` +
        `pp.orders AS orders, pp.avg_discount AS avg_discount, pp.profit_margin AS profit_margin${from}` +
        orderBy(query),
      [...params, ...pageParams(query)],
    ),
    statement(db, `SELECT COUNT(*) AS total${from}`, params),
  ]);
  return { rows: rows as ProductRow[], total: (count?.[0] as { total: number } | undefined)?.total ?? 0 };
}

/** Page of products aggregated from order lines in the filtered scope. */
export async function productsLive(
  db: D1Database,
  filters: Filters,
  period: Period | null,
  query: ProductQuery,
): Promise<{ rows: ProductRow[]; total: number }> {
  const lines = lineSource(filters, period, { products: true });
  addSearch(query, lines.clauses, lines.params);
  const from = ` FROM ${lines.from}${whereClause(lines.clauses)}`;
  const [rows, count] = await queryBatch(db, [
    statement(
      db,
      `SELECT ${PRODUCT_COLUMNS}, SUM(l.sales) AS sales, SUM(l.profit) AS profit, SUM(l.quantity) AS units, ` +
        "COUNT(DISTINCT l.order_id) AS orders, AVG(l.discount) AS avg_discount, " +
        `SUM(l.profit) / SUM(l.sales) AS profit_margin${from} ` +
        `GROUP BY p.product_key${orderBy(query)}`,
      [...lines.params, ...pageParams(query)],
    ),
    statement(db, `SELECT COUNT(DISTINCT l.product_key) AS total${from}`, lines.params),
  ]);
  return { rows: rows as ProductRow[], total: (count?.[0] as { total: number } | undefined)?.total ?? 0 };
}

export function parseProductQuery(params: Map<string, string>): ProductQuery {
  const search = params.get("q");
  return {
    ...(search ? { search } : {}),
    sort: parseEnum("sort", params.get("sort"), Object.keys(SORTS) as Sort[]) ?? "sales",
    order: parseEnum("order", params.get("order"), Object.keys(DIRECTIONS) as Direction[]) ?? "desc",
    page: parseInteger("page", params.get("page"), { min: 1, max: MAX_PAGE, fallback: 1 }),
    pageSize: parseInteger("pageSize", params.get("pageSize"), {
      min: 1,
      max: MAX_PAGE_SIZE,
      fallback: DEFAULT_PAGE_SIZE,
    }),
  };
}

export async function products({ db, url }: RouteContext): Promise<Response> {
  const params = readParams(url, PARAMS);
  const filters = parseFilters(params);
  const query = parseProductQuery(params);
  const bounds = await loadBounds(db);
  const period = resolvePeriod(filters, bounds);
  const yearKey =
    filters.shipMode || filters.region || filters.segment ? null : summaryYearKey(period, bounds);
  const source: Source = yearKey === null ? "live" : "precomputed";
  const { rows, total } =
    yearKey === null
      ? await productsLive(db, filters, period, query)
      : await productsPrecomputed(db, filters, yearKey, query);

  const items = rows.map((row) => ({
    productKey: row.product_key,
    productId: row.product_id,
    productName: row.product_name,
    category: row.category,
    subCategory: row.sub_category,
    sales: money(row.sales),
    profit: money(row.profit),
    profitMargin: ratio(row.profit, row.sales),
    unitsSold: row.units ?? 0,
    orders: row.orders ?? 0,
    averageDiscount: row.avg_discount == null ? null : round(row.avg_discount, 4),
  }));
  const pagination = {
    page: query.page,
    pageSize: query.pageSize,
    totalItems: total,
    totalPages: Math.ceil(total / query.pageSize),
  };
  return ok(
    { period, items, pagination },
    { filters, search: query.search ?? null, sort: query.sort, order: query.order, source },
  );
}
