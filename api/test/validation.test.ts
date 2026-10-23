import { beforeAll, describe, expect, it } from "vitest";
import { getJson, seedFixture } from "./helpers";

beforeAll(seedFixture);

async function expectError(path: string, code: string, status = 400) {
  const { status: actual, body } = await getJson(path);
  expect(actual).toBe(status);
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe("string");
  expect(body.error.requestId).toBeTruthy();
  return body.error;
}

describe("filter validation", () => {
  it.each([
    ["/api/overview?region=North", "region"],
    ["/api/overview?segment=Enterprise", "segment"],
    ["/api/overview?category=Food", "category"],
    ["/api/overview?shipMode=Drone", "shipMode"],
    ["/api/overview?region=East'%20OR%201%3D1%20--", "region"],
  ])("rejects values outside the allowlist: %s", async (path, parameter) => {
    const error = await expectError(path, "invalid_parameter");
    expect(error.details.parameter).toBe(parameter);
    expect(Array.isArray(error.details.allowed)).toBe(true);
  });

  it.each([
    "/api/overview?start=2016-02-30",
    "/api/overview?start=2016/01/01",
    "/api/overview?start=16-01-01",
    "/api/overview?end=1999-12-31",
    "/api/overview?start=2017-01-01&end=2016-01-01",
  ])("rejects invalid dates and ranges: %s", async (path) => {
    await expectError(path, "invalid_parameter");
  });

  it("rejects unknown parameters", async () => {
    const error = await expectError("/api/overview?year=2016", "unknown_parameter");
    expect(error.details.allowed).toContain("start");
  });

  it("rejects repeated and over-long parameters", async () => {
    await expectError("/api/overview?region=East&region=West", "invalid_parameter");
    await expectError(`/api/overview?region=${"x".repeat(65)}`, "invalid_parameter");
  });

  it("treats empty values as absent", async () => {
    const { status, body } = await getJson("/api/overview?region=&category=");
    expect(status).toBe(200);
    expect(body.meta.filters).toEqual({});
  });
});

describe("endpoint-specific parameters", () => {
  it.each([
    ["/api/breakdowns", "invalid_parameter"],
    ["/api/breakdowns?dimension=customer", "invalid_parameter"],
    ["/api/breakdowns?dimension=region;DROP%20TABLE%20orders", "invalid_parameter"],
    ["/api/trends?granularity=week", "invalid_parameter"],
    ["/api/products?pageSize=51", "invalid_parameter"],
    ["/api/products?pageSize=0", "invalid_parameter"],
    ["/api/products?page=0", "invalid_parameter"],
    ["/api/products?page=1.5", "invalid_parameter"],
    ["/api/products?page=-1", "invalid_parameter"],
    ["/api/products?sort=product_name%20DESC", "invalid_parameter"],
    ["/api/products?order=sideways", "invalid_parameter"],
    ["/api/insights?section=admin", "invalid_parameter"],
    ["/api/insights?severity=low", "invalid_parameter"],
    ["/api/health?verbose=1", "unknown_parameter"],
    ["/api/data-quality?limit=5", "unknown_parameter"],
    ["/api/insights?region=East", "unknown_parameter"],
  ])("%s -> %s", async (path, code) => {
    await expectError(path, code);
  });

  it("accepts the maximum page size", async () => {
    const { status, body } = await getJson("/api/products?pageSize=50");
    expect(status).toBe(200);
    expect(body.data.pagination.pageSize).toBe(50);
  });
});
