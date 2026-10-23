/** Every endpoint must answer sensibly when the schema exists but holds no data. */
import { beforeAll, describe, expect, it } from "vitest";
import { emptyDatabase, getJson } from "./helpers";

beforeAll(emptyDatabase);

describe("empty database", () => {
  it("health reports no dataset version", async () => {
    const { status, body } = await getJson("/api/health");
    expect(status).toBe(200);
    expect(body.data.datasetVersion).toBeNull();
  });

  it("overview returns zero KPIs and no comparison", async () => {
    const { status, body } = await getJson("/api/overview");
    expect(status).toBe(200);
    expect(body.data.period).toBeNull();
    expect(body.data.kpis).toMatchObject({ sales: 0, orders: 0, profitMargin: null, averageOrderValue: null });
    expect(body.data.comparison).toEqual({ available: false, reason: "no_data" });
  });

  it("live queries return zeros too", async () => {
    const { body } = await getJson("/api/overview?shipMode=Same%20Day&start=2016-01-01&end=2016-03-15");
    expect(body.meta.source).toBe("live");
    expect(body.data.kpis.sales).toBe(0);
  });

  it.each([
    ["/api/trends", (data: any) => expect(data.points).toEqual([])],
    ["/api/breakdowns?dimension=region", (data: any) => expect(data.rows).toEqual([])],
    ["/api/breakdowns?dimension=subcategory&shipMode=First%20Class", (data: any) => expect(data.rows).toEqual([])],
    [
      "/api/products",
      (data: any) => expect(data).toMatchObject({ items: [], pagination: { totalItems: 0, totalPages: 0 } }),
    ],
    ["/api/insights", (data: any) => expect(data.items).toEqual([])],
    ["/api/meta", (data: any) => expect(data).toMatchObject({ dataset: null, years: [] })],
    ["/api/operations", (data: any) => expect(data).toMatchObject({ summary: { orders: 0 }, matrix: [] })],
    ["/api/data-quality", (data: any) => expect(data).toMatchObject({ checks: [], dataset: {} })],
  ])("%s returns an empty result", async (path, check) => {
    const { status, body } = await getJson(path);
    expect(status).toBe(200);
    check(body.data);
  });
});
