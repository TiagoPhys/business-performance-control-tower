import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";
import { clearFilters, filterSearch, periodPreset, readFilters, writeFilters, yearRange } from "./filters";
import {
  formatBucket,
  formatCurrency,
  formatDate,
  formatDays,
  formatPercent,
  formatPointChange,
  formatSignedPercent,
  MISSING,
} from "./format";

describe("format", () => {
  it("formats currency, percentages and days consistently", () => {
    expect(formatCurrency(2297200.86)).toBe("$2,297,201");
    expect(formatCurrency(458.614, { cents: true })).toBe("$458.61");
    expect(formatCurrency(2297200.86, { compact: true })).toBe("$2.3M");
    expect(formatCurrency(-17725.48)).toBe("-$17,725");
    expect(formatPercent(0.124672)).toBe("12.5%");
    expect(formatSignedPercent(0.20356)).toBe("+20.4%");
    expect(formatSignedPercent(-0.031)).toBe("−3.1%");
    expect(formatPointChange(0.0123)).toBe("+1.2 pp");
    expect(formatDays(3.957, 2)).toBe("3.96 days");
    expect(formatDays(1)).toBe("1 day");
  });

  it("renders missing values as an em dash", () => {
    for (const value of [null, undefined, Number.NaN]) {
      expect(formatCurrency(value)).toBe(MISSING);
      expect(formatPercent(value)).toBe(MISSING);
    }
    expect(formatDate(null)).toBe(MISSING);
  });

  it("formats dates without time-zone drift", () => {
    expect(formatDate("2017-01-01")).toBe("Jan 1, 2017");
    expect(formatBucket("2016-01")).toBe("Jan 2016");
    expect(formatBucket("2016-Q3")).toBe("2016 Q3");
  });
});

describe("filters", () => {
  it("round-trips filters through the URL, keeping other parameters", () => {
    const params = new URLSearchParams("region=East&sort=profit&bogus=");
    expect(readFilters(params)).toEqual({ region: "East" });
    const next = writeFilters(params, { segment: "Consumer" });
    expect(next.get("segment")).toBe("Consumer");
    expect(next.get("region")).toBeNull();
    expect(next.get("sort")).toBe("profit");
    expect(clearFilters(new URLSearchParams("region=East&page=2")).toString()).toBe("page=2");
    expect(filterSearch({ region: "West" })).toBe("?region=West");
  });

  it("recognises period presets", () => {
    expect(periodPreset({})).toEqual({ kind: "all" });
    expect(periodPreset(yearRange(2016))).toEqual({ kind: "year", year: 2016 });
    expect(periodPreset({ start: "2016-01-01", end: "2016-06-30" })).toEqual({ kind: "custom" });
  });
});

describe("csv", () => {
  it("escapes quotes, commas and spreadsheet formulas", () => {
    const csv = toCsv(
      [{ name: 'Chair "A", deluxe', value: 1.5 }, { name: "=HYPERLINK(1)", value: null }],
      [
        { header: "Name", value: (r) => r.name },
        { header: "Value", value: (r) => r.value },
      ],
    );
    expect(csv).toBe('Name,Value\r\n"Chair ""A"", deluxe",1.5\r\n\'=HYPERLINK(1),\r\n');
  });
});
