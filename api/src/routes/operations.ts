import { queryBatch, statement } from "../lib/db";
import { ok } from "../lib/http";
import { ratio, round } from "../lib/metrics";
import { FILTER_PARAMS, parseFilters, readParams, SHIP_MODES } from "../lib/params";
import { loadBounds, resolvePeriod } from "../lib/period";
import { orderSource, whereClause } from "../lib/scope";
import type { RouteContext } from "./types";

/**
 * Order-to-ship time (`shipping_days` = ship date - order date). The dataset has no
 * promised delivery date, so there is deliberately no on-time or SLA measure here.
 */

// Display order: fastest service first.
const SHIP_MODE_ORDER = ["Same Day", "First Class", "Second Class", "Standard Class"] satisfies typeof SHIP_MODES[number][];

interface CellRow {
  region: string | null;
  ship_mode: string | null;
  orders: number;
  total_days: number;
  min_days: number;
  max_days: number;
}

interface DistributionRow {
  ship_mode: string | null;
  shipping_days: number;
  orders: number;
}

interface Group {
  orders: number;
  totalDays: number;
  min: number;
  max: number;
}

/** Median of a value -> count histogram (mean of the two middle values when even). */
export function medianFromCounts(counts: [value: number, count: number][]): number | null {
  const sorted = [...counts].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) return null;
  const valueAt = (position: number) => {
    let seen = 0;
    for (const [value, count] of sorted) {
      seen += count;
      if (seen >= position) return value;
    }
    return sorted.at(-1)![0];
  };
  const lower = valueAt(Math.floor((total + 1) / 2));
  const upper = valueAt(Math.ceil((total + 1) / 2));
  return (lower + upper) / 2;
}

function combine(cells: CellRow[], key: (cell: CellRow) => string): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const cell of cells) {
    const name = key(cell);
    const group = groups.get(name) ?? { orders: 0, totalDays: 0, min: Infinity, max: -Infinity };
    group.orders += cell.orders;
    group.totalDays += cell.total_days;
    group.min = Math.min(group.min, cell.min_days);
    group.max = Math.max(group.max, cell.max_days);
    groups.set(name, group);
  }
  return groups;
}

function describe(group: Group | undefined) {
  if (!group || group.orders === 0) {
    return { orders: 0, averageShippingDays: null, minShippingDays: null, maxShippingDays: null };
  }
  return {
    orders: group.orders,
    averageShippingDays: round(group.totalDays / group.orders, 2),
    minShippingDays: group.min,
    maxShippingDays: group.max,
  };
}

const shipModeRank = (mode: string) => {
  const index = SHIP_MODE_ORDER.indexOf(mode as (typeof SHIP_MODE_ORDER)[number]);
  return index === -1 ? SHIP_MODE_ORDER.length : index;
};

export async function operations({ db, url }: RouteContext): Promise<Response> {
  const filters = parseFilters(readParams(url, FILTER_PARAMS));
  const bounds = await loadBounds(db);
  const period = resolvePeriod(filters, bounds);
  const source = orderSource(filters, period);
  const where = whereClause(source.clauses);
  // Both queries are answered from the covering index on orders.
  const [cells, distribution] = (await queryBatch(db, [
    statement(
      db,
      "SELECT o.region AS region, o.ship_mode AS ship_mode, COUNT(*) AS orders, " +
        "SUM(o.shipping_days) AS total_days, MIN(o.shipping_days) AS min_days, MAX(o.shipping_days) AS max_days " +
        `FROM ${source.from}${where} GROUP BY o.region, o.ship_mode`,
      source.params,
    ),
    statement(
      db,
      "SELECT o.ship_mode AS ship_mode, o.shipping_days AS shipping_days, COUNT(*) AS orders " +
        `FROM ${source.from}${where} GROUP BY o.ship_mode, o.shipping_days`,
      source.params,
    ),
  ])) as [CellRow[], DistributionRow[]];

  const unknown = "Unknown";
  const modeOf = (row: { ship_mode: string | null }) => row.ship_mode ?? unknown;
  const total = combine(cells, () => "all").get("all");
  const totalOrders = total?.orders ?? 0;
  const byMode = combine(cells, modeOf);
  const byRegion = combine(cells, (cell) => cell.region ?? unknown);

  const histogram = new Map<number, Map<string, number>>();
  for (const row of distribution) {
    const perMode = histogram.get(row.shipping_days) ?? new Map<string, number>();
    perMode.set(modeOf(row), row.orders);
    histogram.set(row.shipping_days, perMode);
  }
  const countsFor = (mode?: string): [number, number][] =>
    [...histogram.entries()].map(([days, perMode]) => [
      days,
      mode ? (perMode.get(mode) ?? 0) : [...perMode.values()].reduce((a, b) => a + b, 0),
    ]);

  const modes = [...byMode.keys()].sort((a, b) => shipModeRank(a) - shipModeRank(b) || a.localeCompare(b));
  return ok(
    {
      period,
      summary: { ...describe(total), medianShippingDays: medianFromCounts(countsFor()) },
      byShipMode: modes.map((mode) => ({
        shipMode: mode,
        ...describe(byMode.get(mode)),
        medianShippingDays: medianFromCounts(countsFor(mode)),
        shareOfOrders: ratio(byMode.get(mode)?.orders, totalOrders),
      })),
      byRegion: [...byRegion.keys()].sort().map((region) => ({ region, ...describe(byRegion.get(region)) })),
      matrix: cells
        .map((cell) => ({
          region: cell.region ?? unknown,
          shipMode: modeOf(cell),
          orders: cell.orders,
          averageShippingDays: round(cell.total_days / cell.orders, 2),
        }))
        .sort((a, b) => a.region.localeCompare(b.region) || shipModeRank(a.shipMode) - shipModeRank(b.shipMode)),
      distribution: [...histogram.keys()]
        .sort((a, b) => a - b)
        .map((days) => ({
          shippingDays: days,
          orders: countsFor().find(([d]) => d === days)?.[1] ?? 0,
          byShipMode: Object.fromEntries(modes.map((mode) => [mode, histogram.get(days)?.get(mode) ?? 0])),
        })),
    },
    { filters, source: "live" },
  );
}
