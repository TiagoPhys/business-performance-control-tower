/** KPI shaping shared by every endpoint, so definitions and rounding never diverge. */

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

export interface RawKpis {
  sales: number | null;
  profit: number | null;
  units: number | null;
  orders: number | null;
  customers: number | null;
  avg_shipping_days: number | null;
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export const money = (value: number | null | undefined): number => round(value ?? 0, 2);

/** numerator / denominator, or null when the denominator is zero or missing. */
export function ratio(numerator: number | null | undefined, denominator: number | null | undefined, decimals = 6) {
  if (!denominator) return null;
  return round((numerator ?? 0) / denominator, decimals);
}

export function toKpis(raw: RawKpis): Kpis {
  const orders = raw.orders ?? 0;
  return {
    sales: money(raw.sales),
    profit: money(raw.profit),
    profitMargin: ratio(raw.profit, raw.sales),
    orders,
    averageOrderValue: ratio(raw.sales, orders, 2),
    unitsSold: raw.units ?? 0,
    customers: raw.customers ?? 0,
    averageShippingDays: raw.avg_shipping_days == null ? null : round(raw.avg_shipping_days, 2),
  };
}

export const EMPTY_RAW_KPIS: RawKpis = {
  sales: 0,
  profit: 0,
  units: 0,
  orders: 0,
  customers: 0,
  avg_shipping_days: null,
};

export interface Change {
  absolute: number | null;
  /** Relative to |previous|; null when previous is zero/missing or for ratio KPIs. */
  percent: number | null;
}

const RATIO_KPIS = new Set<keyof Kpis>(["profitMargin"]);

/** Change of every KPI against the previous period. */
export function compareKpis(current: Kpis, previous: Kpis): Record<keyof Kpis, Change> {
  const keys = Object.keys(current) as (keyof Kpis)[];
  return Object.fromEntries(
    keys.map((key) => {
      const now = current[key];
      const before = previous[key];
      if (now === null || before === null) return [key, { absolute: null, percent: null }];
      const absolute = round(now - before, RATIO_KPIS.has(key) ? 6 : 2);
      const percent = RATIO_KPIS.has(key) || before === 0 ? null : round((now - before) / Math.abs(before), 6);
      return [key, { absolute, percent }];
    }),
  ) as Record<keyof Kpis, Change>;
}
