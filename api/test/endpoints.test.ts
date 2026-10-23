/**
 * Endpoint totals against the pipeline fixture (tests/python/conftest.py):
 *
 *   row order date        ship mode       region seg       product  category         sales qty disc profit
 *   1   O-1   2016-01-10  Second Class    East   Consumer  Chair A  Furniture         100   2  0.0    20
 *   2   O-1   2016-01-10  Second Class    East   Consumer  Pen B    Office Supplies    50   5  0.2    -5
 *   3   O-2   2016-02-05  Standard Class  West   Corporate Chair A  Furniture         200   1  0.5   -40
 *   4   O-3   2017-03-01  Same Day        East   Consumer  Table C  Furniture         300   3  0.3   -30
 *   5   O-3   2017-03-01  Same Day        East   Consumer  Chair A  Furniture         150   1  0.0    75
 *
 * Shipping days per order: O-1 = 3, O-2 = 5, O-3 = 0. Customers: C-1 (O-1, O-3), C-2 (O-2).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getJson, seedFixture } from "./helpers";

beforeAll(seedFixture);

describe("GET /api/health", () => {
  it("reports database status and dataset version without caching", async () => {
    const { status, body, response } = await getJson("/api/health");
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ status: "ok", database: "ok" });
    expect(body.data.datasetVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /api/overview", () => {
  it("returns all-time KPIs from the pre-computed summary", async () => {
    const { status, body } = await getJson("/api/overview");
    expect(status).toBe(200);
    expect(body.meta.source).toBe("precomputed");
    expect(body.data.period).toEqual({ start: "2016-01-10", end: "2017-03-01", days: 417 });
    expect(body.data.kpis).toEqual({
      sales: 800,
      profit: 20,
      profitMargin: 0.025,
      orders: 3,
      averageOrderValue: 266.67,
      unitsSold: 12,
      customers: 2,
      averageShippingDays: 2.67,
    });
    expect(body.data.comparison).toMatchObject({ available: false, reason: "insufficient_history" });
  });

  it("compares a calendar year with the previous period of the same length", async () => {
    const { body } = await getJson("/api/overview?start=2017-01-01&end=2017-12-31");
    expect(body.meta.source).toBe("precomputed");
    expect(body.data.kpis).toMatchObject({ sales: 450, profit: 45, orders: 1, customers: 1, unitsSold: 4 });
    const comparison = body.data.comparison;
    expect(comparison.available).toBe(true);
    // 2017 has 365 days, so the previous period is 2016-01-02..2016-12-31 (2016 is a leap year).
    expect(comparison.period).toEqual({ start: "2016-01-02", end: "2016-12-31", days: 365 });
    expect(comparison.kpis).toMatchObject({ sales: 350, profit: -25, orders: 2, customers: 2, unitsSold: 8 });
    expect(comparison.change.sales).toEqual({ absolute: 100, percent: 0.285714 });
    // Profit growth is relative to |previous| because the previous value is negative.
    expect(comparison.change.profit).toEqual({ absolute: 70, percent: 2.8 });
    expect(comparison.change.profitMargin.percent).toBeNull();
  });

  it("counts an order once even when it has several lines in the category", async () => {
    const { body } = await getJson("/api/overview?category=Furniture");
    expect(body.data.kpis).toMatchObject({ sales: 750, profit: 25, orders: 3, unitsSold: 7, customers: 2 });
  });

  it("uses live SQL for ship-mode filters and custom ranges", async () => {
    const shipMode = await getJson("/api/overview?shipMode=Same%20Day");
    expect(shipMode.body.meta.source).toBe("live");
    expect(shipMode.body.data.kpis).toMatchObject({ sales: 450, orders: 1, averageShippingDays: 0 });

    const january = await getJson("/api/overview?start=2016-01-01&end=2016-01-31");
    expect(january.body.meta.source).toBe("live");
    expect(january.body.data.kpis).toMatchObject({ sales: 150, profit: 15, orders: 1, unitsSold: 7 });
  });

  it("returns zeros and null ratios for a period without data", async () => {
    for (const query of ["start=2015-01-01&end=2015-12-31", "start=2015-03-01&end=2015-03-15"]) {
      const { status, body } = await getJson(`/api/overview?${query}`);
      expect(status).toBe(200);
      expect(body.data.kpis).toEqual({
        sales: 0,
        profit: 0,
        profitMargin: null,
        orders: 0,
        averageOrderValue: null,
        unitsSold: 0,
        customers: 0,
        averageShippingDays: null,
      });
    }
  });

  it("normalises filter values to their canonical spelling", async () => {
    const { body } = await getJson("/api/overview?region=east&segment=CONSUMER");
    expect(body.meta.filters).toEqual({ region: "East", segment: "Consumer" });
    expect(body.data.kpis.sales).toBe(600);
  });
});

describe("GET /api/trends", () => {
  it("returns a gap-free monthly series over the data range", async () => {
    const { body } = await getJson("/api/trends");
    expect(body.meta.source).toBe("precomputed");
    const points = body.data.points;
    expect(points).toHaveLength(15); // 2016-01 .. 2017-03
    expect(points[0]).toMatchObject({ period: "2016-01", sales: 150, orders: 1 });
    expect(points[2]).toMatchObject({ period: "2016-03", sales: 0, orders: 0, profitMargin: null });
    expect(points.at(-1)).toMatchObject({ period: "2017-03", sales: 450, orders: 1 });
  });

  it("aggregates by quarter and year", async () => {
    const quarter = await getJson("/api/trends?granularity=quarter");
    expect(quarter.body.data.points.map((p: any) => [p.period, p.sales, p.orders])).toEqual([
      ["2016-Q1", 350, 2],
      ["2016-Q2", 0, 0],
      ["2016-Q3", 0, 0],
      ["2016-Q4", 0, 0],
      ["2017-Q1", 450, 1],
    ]);
    const year = await getJson("/api/trends?granularity=year&region=West");
    expect(year.body.data.points.map((p: any) => [p.period, p.sales])).toEqual([
      ["2016", 200],
      ["2017", 0],
    ]);
  });

  it("falls back to live SQL for mid-month ranges", async () => {
    const { body } = await getJson("/api/trends?start=2016-01-15&end=2016-02-28");
    expect(body.meta.source).toBe("live");
    expect(body.data.points.map((p: any) => [p.period, p.sales])).toEqual([
      ["2016-01", 0],
      ["2016-02", 200],
    ]);
  });
});

describe("GET /api/breakdowns", () => {
  it("breaks down by region with shares of sales", async () => {
    const { body } = await getJson("/api/breakdowns?dimension=region");
    expect(body.meta.source).toBe("precomputed");
    expect(body.data.rows).toEqual([
      expect.objectContaining({ key: "East", sales: 600, profit: 60, orders: 2, customers: 1, shareOfSales: 0.75 }),
      expect.objectContaining({ key: "West", sales: 200, profit: -40, orders: 1, shareOfSales: 0.25 }),
    ]);
  });

  it("counts orders per category without summing them to the total", async () => {
    const { body } = await getJson("/api/breakdowns?dimension=category");
    const rows = Object.fromEntries(body.data.rows.map((r: any) => [r.key, r]));
    expect(rows.Furniture).toMatchObject({ sales: 750, orders: 3 });
    expect(rows["Office Supplies"]).toMatchObject({ sales: 50, orders: 1, averageShippingDays: 3 });
  });

  it("breaks down by sub-category with the parent category", async () => {
    const { body } = await getJson("/api/breakdowns?dimension=subcategory");
    expect(body.data.rows.map((r: any) => [r.key, r.category, r.profit])).toEqual([
      ["Chairs", "Furniture", 55],
      ["Tables", "Furniture", -30],
      ["Art", "Office Supplies", -5],
    ]);
  });

  it("applies filters, using live SQL when needed", async () => {
    const consumer = await getJson("/api/breakdowns?dimension=region&segment=Consumer");
    expect(consumer.body.data.rows).toEqual([expect.objectContaining({ key: "East", sales: 600 })]);

    const secondClass = await getJson("/api/breakdowns?dimension=subcategory&shipMode=Second%20Class");
    expect(secondClass.body.meta.source).toBe("live");
    expect(secondClass.body.data.rows.map((r: any) => [r.key, r.sales])).toEqual([
      ["Chairs", 100],
      ["Art", 50],
    ]);
  });
});

describe("GET /api/products", () => {
  it("sorts by sales descending by default and paginates", async () => {
    const { body } = await getJson("/api/products");
    expect(body.data.items.map((p: any) => p.productName)).toEqual(["Chair A", "Table C", "Pen B"]);
    expect(body.data.items[0]).toMatchObject({ productKey: 1, sales: 450, profit: 55, orders: 3, unitsSold: 4 });
    expect(body.data.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 3, totalPages: 1 });

    const page2 = await getJson("/api/products?pageSize=2&page=2");
    expect(page2.body.data.items.map((p: any) => p.productName)).toEqual(["Pen B"]);
    expect(page2.body.data.pagination).toEqual({ page: 2, pageSize: 2, totalItems: 3, totalPages: 2 });

    const beyond = await getJson("/api/products?pageSize=2&page=5");
    expect(beyond.body.data.items).toEqual([]);
  });

  it("supports allowlisted sorts", async () => {
    const byProfit = await getJson("/api/products?sort=profit&order=asc");
    expect(byProfit.body.data.items.map((p: any) => p.productName)).toEqual(["Table C", "Pen B", "Chair A"]);
    const byName = await getJson("/api/products?sort=name&order=asc");
    expect(byName.body.data.items.map((p: any) => p.productName)).toEqual(["Chair A", "Pen B", "Table C"]);
  });

  it("aggregates live for order-level filters", async () => {
    const { body } = await getJson("/api/products?region=West");
    expect(body.meta.source).toBe("live");
    expect(body.data.items).toEqual([
      expect.objectContaining({ productName: "Chair A", sales: 200, profit: -40, orders: 1, profitMargin: -0.2 }),
    ]);
  });
});

describe("GET /api/insights", () => {
  it("returns ranked insights with parsed evidence", async () => {
    const { body } = await getJson("/api/insights");
    const items = body.data.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.map((i: any) => i.order)).toEqual([...items.map((i: any) => i.order)].sort((a, b) => a - b));
    expect(typeof items[0].evidence).toBe("object");
  });

  it("filters by section and severity", async () => {
    const { body } = await getJson("/api/insights?section=products&severity=critical");
    expect(body.data.items.length).toBeGreaterThan(0);
    for (const item of body.data.items) expect(item).toMatchObject({ section: "products", severity: "critical" });
  });
});

describe("GET /api/data-quality", () => {
  it("summarises checks and dataset metadata", async () => {
    const { body } = await getJson("/api/data-quality");
    const { summary, checks, dataset, issues } = body.data;
    expect(summary.pass + summary.warn + summary.fail).toBe(checks.length);
    expect(summary.fail).toBe(0);
    expect(dataset).toMatchObject({ orders: 3, clean_rows: 5, min_order_date: "2016-01-10" });
    expect(issues).toEqual({ items: [], total: 0, limit: 100, truncated: false });
  });
});
