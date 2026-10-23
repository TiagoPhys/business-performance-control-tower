import { describe, expect, it } from "vitest";
import { isOriginAllowed } from "../src/lib/http";
import {
  bucketsBetween,
  comparisonFor,
  makePeriod,
  monthRange,
  previousPeriod,
  resolvePeriod,
  summaryYearKey,
} from "../src/lib/period";

const bounds = { minDate: "2014-01-03", maxDate: "2017-12-30" };

describe("period helpers", () => {
  it("defaults missing dates to the data range", () => {
    expect(resolvePeriod({}, bounds)).toEqual(makePeriod("2014-01-03", "2017-12-30"));
    expect(resolvePeriod({ start: "2016-06-01" }, bounds)).toEqual(makePeriod("2016-06-01", "2017-12-30"));
    expect(resolvePeriod({}, null)).toBeNull();
  });

  it("keeps one-sided ranges outside the data valid", () => {
    expect(resolvePeriod({ end: "2013-01-01" }, bounds)).toEqual(makePeriod("2013-01-01", "2013-01-01"));
    expect(resolvePeriod({ start: "2019-01-01" }, bounds)).toEqual(makePeriod("2019-01-01", "2019-01-01"));
  });

  it("computes the previous period of the same length", () => {
    expect(previousPeriod(makePeriod("2017-03-01", "2017-03-31"))).toEqual(makePeriod("2017-01-29", "2017-02-28"));
    expect(previousPeriod(makePeriod("2016-01-01", "2016-12-31")).days).toBe(366);
  });

  it("requires history for comparisons", () => {
    expect(comparisonFor(makePeriod("2015-01-01", "2015-12-31"), bounds)).toMatchObject({ available: true });
    // 2014-01-01 is inside coverage (first order on 2014-01-03), 2013-12-31 is not.
    expect(comparisonFor(makePeriod("2015-01-01", "2015-12-31"), bounds)).toMatchObject({
      period: makePeriod("2014-01-01", "2014-12-31"),
    });
    expect(comparisonFor(makePeriod("2014-06-01", "2014-12-31"), bounds)).toMatchObject({
      available: false,
      reason: "insufficient_history",
    });
    expect(comparisonFor(null, null)).toEqual({ available: false, reason: "no_data" });
  });

  it("maps periods onto pre-computed keys only when they align exactly", () => {
    expect(summaryYearKey(makePeriod("2016-01-01", "2016-12-31"), bounds)).toBe("2016");
    expect(summaryYearKey(makePeriod("2010-01-01", "2030-12-31"), bounds)).toBe("ALL");
    expect(summaryYearKey(makePeriod("2016-01-01", "2016-12-30"), bounds)).toBeNull();
    expect(monthRange(makePeriod("2016-02-01", "2016-02-29"), bounds)).toEqual({ from: "2016-02", to: "2016-02" });
    expect(monthRange(makePeriod("2016-02-01", "2016-02-28"), bounds)).toBeNull();
  });

  it("lists buckets without gaps", () => {
    expect(bucketsBetween("2016-11-15", "2017-02-01", "month")).toEqual(["2016-11", "2016-12", "2017-01", "2017-02"]);
    expect(bucketsBetween("2016-11-15", "2017-02-01", "quarter")).toEqual(["2016-Q4", "2017-Q1"]);
  });
});

describe("origin matching", () => {
  it("matches exact origins and single-label wildcards", () => {
    const setting = "https://app.example.com, https://*.pages.example.com";
    expect(isOriginAllowed("https://app.example.com", setting)).toBe(true);
    expect(isOriginAllowed("https://x-1.pages.example.com", setting)).toBe(true);
    expect(isOriginAllowed("https://pages.example.com", setting)).toBe(false);
    expect(isOriginAllowed(null, setting)).toBe(false);
    expect(isOriginAllowed("https://app.example.com", "")).toBe(false);
  });
});
