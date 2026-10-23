/** /api/meta, /api/operations and product search/discount, against the pipeline fixture. */
import { beforeAll, describe, expect, it } from "vitest";
import { medianFromCounts } from "../src/routes/operations";
import { getJson, seedFixture } from "./helpers";

beforeAll(seedFixture);

describe("GET /api/meta", () => {
  it("returns the date range, years and filter allowlists", async () => {
    const { status, body } = await getJson("/api/meta");
    expect(status).toBe(200);
    expect(body.data.dataset).toMatchObject({ minDate: "2016-01-10", maxDate: "2017-03-01" });
    expect(body.data.dataset.version).toMatch(/^[0-9a-f]{12}$/);
    expect(body.data.years).toEqual([2016, 2017]);
    expect(body.data.filters.region).toEqual(["Central", "East", "South", "West"]);
    expect(body.data.filters.shipMode).toContain("Same Day");
  });
});

describe("GET /api/operations", () => {
  it("summarises order-to-ship days by ship mode, region and both", async () => {
    const { status, body } = await getJson("/api/operations");
    expect(status).toBe(200);
    const data = body.data;
    // Orders ship in 0 (O-3, Same Day), 3 (O-1, Second Class) and 5 (O-2, Standard Class) days.
    expect(data.summary).toEqual({
      orders: 3,
      averageShippingDays: 2.67,
      minShippingDays: 0,
      maxShippingDays: 5,
      medianShippingDays: 3,
    });
    expect(data.byShipMode.map((m: any) => [m.shipMode, m.orders, m.averageShippingDays])).toEqual([
      ["Same Day", 1, 0],
      ["Second Class", 1, 3],
      ["Standard Class", 1, 5],
    ]);
    expect(data.byRegion).toEqual([
      expect.objectContaining({ region: "East", orders: 2, averageShippingDays: 1.5 }),
      expect.objectContaining({ region: "West", orders: 1, averageShippingDays: 5 }),
    ]);
    expect(data.matrix).toContainEqual({ region: "East", shipMode: "Same Day", orders: 1, averageShippingDays: 0 });
    expect(data.distribution.map((d: any) => [d.shippingDays, d.orders])).toEqual([
      [0, 1],
      [3, 1],
      [5, 1],
    ]);
    expect(JSON.stringify(data)).not.toMatch(/on.?time|promised|sla/i);
  });

  it("applies filters, counting each order once for a category", async () => {
    const { body } = await getJson("/api/operations?category=Office%20Supplies");
    expect(body.data.summary).toMatchObject({ orders: 1, averageShippingDays: 3 });
    const empty = await getJson("/api/operations?start=2015-01-01&end=2015-12-31");
    expect(empty.body.data).toMatchObject({ summary: { orders: 0, averageShippingDays: null }, byShipMode: [] });
  });

  it("computes medians from a histogram", () => {
    expect(medianFromCounts([])).toBeNull();
    expect(medianFromCounts([[4, 1], [2, 1], [7, 1]])).toBe(4);
    expect(medianFromCounts([[1, 2], [3, 2]])).toBe(2);
  });
});

describe("product search and discount", () => {
  it("reports the mean line discount and sorts by it", async () => {
    const { body } = await getJson("/api/products?sort=averageDiscount&order=desc");
    expect(body.data.items.map((p: any) => [p.productName, p.averageDiscount])).toEqual([
      ["Table C", 0.3],
      ["Pen B", 0.2],
      ["Chair A", 0.1667], // (0 + 0.5 + 0) / 3
    ]);
  });

  it.each([
    ["q=chair", ["Chair A"]],
    ["q=P-2", ["Pen B"]],
    ["q=zzz", []],
    ["q=%25", []], // a literal '%' is escaped, not a wildcard
    ["q=_", []],
    ["q=e&region=East", ["Table C", "Pen B"]], // "Chair A" has no "e"; East sales 300, 50
  ])("searches by name or ID: %s", async (query, names) => {
    const { status, body } = await getJson(`/api/products?${query}`);
    expect(status).toBe(200);
    expect(body.data.items.map((p: any) => p.productName)).toEqual(names);
    expect(body.data.pagination.totalItems).toBe(names.length);
  });

  it("rejects over-long searches", async () => {
    const { status } = await getJson(`/api/products?q=${"a".repeat(65)}`);
    expect(status).toBe(400);
  });
});
