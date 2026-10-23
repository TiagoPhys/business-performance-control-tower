/**
 * The pre-computed tables and the live SQL must agree wherever both can answer.
 */
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Filters } from "../src/lib/params";
import { makePeriod } from "../src/lib/period";
import { breakdownLive, breakdownPrecomputed, type Dimension } from "../src/routes/breakdowns";
import { overviewLive, overviewPrecomputed } from "../src/routes/overview";
import { productsLive, productsPrecomputed } from "../src/routes/products";
import { trendsLive, trendsPrecomputed } from "../src/routes/trends";
import { seedFixture } from "./helpers";

beforeAll(seedFixture);

const YEARS: [string, ReturnType<typeof makePeriod> | null][] = [
  ["ALL", null],
  ["2016", makePeriod("2016-01-01", "2016-12-31")],
  ["2017", makePeriod("2017-01-01", "2017-12-31")],
];
const FILTER_CASES: Filters[] = [
  {},
  { region: "East" },
  { segment: "Corporate" },
  { category: "Furniture" },
  { category: "Office Supplies", region: "East" },
];

function sortByKey<T extends { key: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.key.localeCompare(b.key));
}

describe("overview", () => {
  for (const [yearKey, period] of YEARS) {
    for (const filters of FILTER_CASES) {
      it(`matches for ${yearKey} ${JSON.stringify(filters)}`, async () => {
        const precomputed = await overviewPrecomputed(env.DB, filters, yearKey);
        const live = await overviewLive(env.DB, filters, period);
        expect(live).toEqual(precomputed);
      });
    }
  }
});

describe("breakdowns", () => {
  const dimensions: Dimension[] = ["region", "segment", "category", "subcategory"];
  for (const dimension of dimensions) {
    for (const [yearKey, period] of YEARS) {
      it(`matches for ${dimension} ${yearKey}`, async () => {
        const filters: Filters = dimension === "subcategory" ? { category: "Furniture" } : {};
        const precomputed = await breakdownPrecomputed(env.DB, dimension, filters, yearKey);
        const live = await breakdownLive(env.DB, dimension, filters, period);
        expect(precomputed).not.toBeNull();
        const expected = sortByKey(precomputed!);
        const actual = sortByKey(live);
        expect(actual.map((r) => r.key)).toEqual(expected.map((r) => r.key));
        actual.forEach((row, i) => {
          const other = expected[i]!;
          expect(row.sales).toBeCloseTo(other.sales!, 6);
          expect(row.profit).toBeCloseTo(other.profit!, 6);
          expect(row.units).toBe(other.units);
          expect(row.orders).toBe(other.orders);
          expect(row.customers).toBe(other.customers);
          if (other.avg_shipping_days === null) expect(row.avg_shipping_days).toBeNull();
          else expect(row.avg_shipping_days).toBeCloseTo(other.avg_shipping_days, 6);
        });
      });
    }
  }
});

describe("trends", () => {
  for (const granularity of ["month", "quarter", "year"] as const) {
    it(`matches by ${granularity}`, async () => {
      const precomputed = await trendsPrecomputed(env.DB, { category: "Furniture" }, granularity, {
        from: "0000-01",
        to: "9999-12",
      });
      const live = await trendsLive(env.DB, { category: "Furniture" }, null, granularity);
      expect(live.map((r) => [r.bucket, r.orders, r.units])).toEqual(
        precomputed.map((r) => [r.bucket, r.orders, r.units]),
      );
      live.forEach((row, i) => expect(row.sales).toBeCloseTo(precomputed[i]!.sales!, 6));
    });
  }
});

describe("products", () => {
  it("matches for every sort", async () => {
    for (const sort of ["sales", "profit", "profitMargin", "unitsSold", "orders", "averageDiscount", "name"] as const) {
      const query = { sort, order: "desc", page: 1, pageSize: 50 } as const;
      const precomputed = await productsPrecomputed(env.DB, {}, "ALL", query);
      const live = await productsLive(env.DB, {}, null, query);
      expect(live.total).toBe(precomputed.total);
      expect(live.rows.map((r) => r.product_key)).toEqual(precomputed.rows.map((r) => r.product_key));
    }
  });
});
