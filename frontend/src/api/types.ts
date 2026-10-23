/** Response shapes of the Business Performance Control Tower API (see api/README.md). */

export interface Envelope<T, M = ResponseMeta> {
  data: T;
  meta: M;
}

export interface ResponseMeta {
  filters?: Partial<Filters>;
  source?: "precomputed" | "live";
  [key: string]: unknown;
}

export interface Filters {
  start?: string;
  end?: string;
  region?: string;
  segment?: string;
  category?: string;
  shipMode?: string;
}

export interface Period {
  start: string;
  end: string;
  days: number;
}

export interface Kpis {
  sales: number;
  profit: number;
  profitMargin: number | null;
  orders: number;
  averageOrderValue: number | null;
  unitsSold: number;
  customers: number;
  averageShippingDays: number | null;
}

export type KpiKey = keyof Kpis;

export interface Change {
  absolute: number | null;
  percent: number | null;
}

export type Comparison =
  | { available: true; period: Period; kpis: Kpis; change: Record<KpiKey, Change> }
  | { available: false; reason: "no_data" | "insufficient_history"; period?: Period };

export interface Overview {
  period: Period | null;
  kpis: Kpis;
  comparison: Comparison;
}

export type Granularity = "month" | "quarter" | "year";

export interface TrendPoint {
  period: string;
  sales: number;
  profit: number;
  profitMargin: number | null;
  orders: number;
  unitsSold: number;
  averageOrderValue: number | null;
}

export interface Trends {
  granularity: Granularity;
  period: Period | null;
  points: TrendPoint[];
}

export type Dimension = "region" | "segment" | "category" | "subcategory";

export interface BreakdownRow {
  key: string;
  category?: string;
  sales: number;
  profit: number;
  profitMargin: number | null;
  orders: number;
  averageOrderValue: number | null;
  unitsSold: number;
  customers: number;
  averageShippingDays: number | null;
  shareOfSales: number | null;
}

export interface Breakdowns {
  dimension: Dimension;
  period: Period | null;
  rows: BreakdownRow[];
}

export type ProductSort = "sales" | "profit" | "profitMargin" | "unitsSold" | "orders" | "averageDiscount" | "name";
export type SortOrder = "asc" | "desc";

export interface ProductQuery {
  q?: string;
  sort?: ProductSort;
  order?: SortOrder;
  page?: number;
  pageSize?: number;
}

export interface Product {
  productKey: number;
  productId: string;
  productName: string;
  category: string | null;
  subCategory: string | null;
  sales: number;
  profit: number;
  profitMargin: number | null;
  unitsSold: number;
  orders: number;
  averageDiscount: number | null;
}

export interface Products {
  period: Period | null;
  items: Product[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

export interface ShippingStats {
  orders: number;
  averageShippingDays: number | null;
  minShippingDays: number | null;
  maxShippingDays: number | null;
}

export interface Operations {
  period: Period | null;
  summary: ShippingStats & { medianShippingDays: number | null };
  byShipMode: (ShippingStats & { shipMode: string; medianShippingDays: number | null; shareOfOrders: number | null })[];
  byRegion: (ShippingStats & { region: string })[];
  matrix: { region: string; shipMode: string; orders: number; averageShippingDays: number }[];
  distribution: { shippingDays: number; orders: number; byShipMode: Record<string, number> }[];
}

export type Severity = "critical" | "warning" | "info";

export interface Insight {
  id: string;
  order: number;
  section: string;
  topic: string;
  severity: Severity;
  title: string;
  body: string;
  metric: { name: string; value: number | null } | null;
  caveat: string | null;
  evidence: unknown;
}

export interface Insights {
  items: Insight[];
}

export interface QualityCheck {
  id: string;
  group: string;
  description: string;
  status: "pass" | "warn" | "fail";
  affectedRows: number;
  details: string | null;
}

export interface DataQuality {
  dataset: Record<string, string | number>;
  summary: { pass: number; warn: number; fail: number };
  checks: QualityCheck[];
  issues: {
    items: { id: number; checkId: string; rowId: string; column: string; rawValue: string | null }[];
    total: number;
    limit: number;
    truncated: boolean;
  };
}

export interface Meta {
  dataset: { minDate: string; maxDate: string; version: string | null } | null;
  years: number[];
  filters: { region: string[]; segment: string[]; category: string[]; shipMode: string[] };
}
