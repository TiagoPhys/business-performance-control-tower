/**
 * Builders for the live (row-level) queries. Column names come only from this file;
 * every user-provided value is returned as a bound parameter.
 */
import type { Filters } from "./params";
import type { Period } from "./period";

export interface SqlParts {
  from: string;
  clauses: string[];
  params: unknown[];
}

export const ALL = "ALL";

/** Conditions on order attributes (date range, region, segment, ship mode). */
export function orderConditions(filters: Filters, period: Period | null): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (period) {
    clauses.push("o.order_date BETWEEN ? AND ?");
    params.push(period.start, period.end);
  }
  const columns: [keyof Filters, string][] = [
    ["region", "o.region"],
    ["segment", "o.segment"],
    ["shipMode", "o.ship_mode"],
  ];
  for (const [filter, column] of columns) {
    const value = filters[filter];
    if (value !== undefined) {
      clauses.push(`${column} = ?`);
      params.push(value);
    }
  }
  return { clauses, params };
}

/**
 * Source for order-level measures (orders, customers, shipping days), read from
 * `orders` only. A category filter becomes a semi-join, so each order counts once.
 */
export function orderSource(filters: Filters, period: Period | null): SqlParts {
  const { clauses, params } = orderConditions(filters, period);
  if (filters.category) {
    clauses.push(
      "EXISTS (SELECT 1 FROM order_lines l JOIN products p ON p.product_key = l.product_key " +
        "WHERE l.order_id = o.order_id AND p.category = ?)",
    );
    params.push(filters.category);
  }
  return { from: "orders o", clauses, params };
}

/**
 * Source for line-level measures (sales, profit, quantity) from `order_lines`, joining
 * `orders` and `products` only when a filter or grouping needs them.
 */
export function lineSource(
  filters: Filters,
  period: Period | null,
  needs: { orders?: boolean; products?: boolean } = {},
): SqlParts {
  const { clauses, params } = orderConditions(filters, period);
  const joinOrders = needs.orders || clauses.length > 0;
  const joinProducts = needs.products || filters.category !== undefined;
  let from = "order_lines l";
  if (joinOrders) from += " JOIN orders o ON o.order_id = l.order_id";
  if (joinProducts) from += " JOIN products p ON p.product_key = l.product_key";
  if (filters.category) {
    clauses.push("p.category = ?");
    params.push(filters.category);
  }
  return { from, clauses, params };
}

export function whereClause(clauses: string[]): string {
  return clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
}

/** Bound values for the pre-computed tables' dimension columns (`ALL` when unfiltered). */
export function summaryDimensions(filters: Filters): { region: string; segment: string; category: string } {
  return {
    region: filters.region ?? ALL,
    segment: filters.segment ?? ALL,
    category: filters.category ?? ALL,
  };
}
