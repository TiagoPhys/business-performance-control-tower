import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Comparison, Insight, Kpis } from "@/api/types";
import { FilterBar } from "@/components/filters/FilterBar";
import { KpiGrid } from "@/components/kpi/KpiCard";
import { InsightCard } from "@/features/insights/InsightCard";
import { renderWithProviders } from "@/test/render";

vi.mock("@/api/client", async (original) => {
  const actual = await original<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      meta: vi.fn().mockResolvedValue({
        data: {
          dataset: { minDate: "2014-01-03", maxDate: "2017-12-30", version: "abc" },
          years: [2014, 2015, 2016, 2017],
          filters: { region: ["East", "West"], segment: ["Consumer"], category: ["Furniture"], shipMode: ["Same Day"] },
        },
        meta: {},
      }),
    },
  };
});

const kpis: Kpis = {
  sales: 733215.26,
  profit: 93439.27,
  profitMargin: 0.127437,
  orders: 1687,
  averageOrderValue: 434.63,
  unitsSold: 12476,
  customers: 693,
  averageShippingDays: 3.95,
};

describe("KpiGrid", () => {
  it("shows values, changes with direction, and formula explanations", async () => {
    const comparison: Comparison = {
      available: true,
      period: { start: "2016-01-02", end: "2016-12-31", days: 365 },
      kpis,
      change: {
        sales: { absolute: 124009.66, percent: 0.20356 },
        profit: { absolute: 11000, percent: 0.1335 },
        profitMargin: { absolute: -0.0081, percent: null },
        orders: { absolute: 300, percent: 0.2163 },
        averageOrderValue: { absolute: -5, percent: -0.011 },
        unitsSold: { absolute: 2000, percent: 0.19 },
        customers: { absolute: 30, percent: 0.045 },
        averageShippingDays: { absolute: 0.1, percent: 0.026 },
      },
    };
    const user = userEvent.setup();
    renderWithProviders(<KpiGrid kpis={kpis} comparison={comparison} />);
    expect(screen.getByText("$733,215")).toBeInTheDocument();
    expect(screen.getByText("12.7%")).toBeInTheDocument();
    expect(screen.getByText("+20.4%")).toBeInTheDocument();
    expect(screen.getByText("−0.8 pp")).toBeInTheDocument();
    // Slower shipping is a deterioration even though the number went up.
    expect(screen.getByText("+0.1 days").parentElement).toHaveTextContent("(deterioration)");
    await user.click(screen.getByRole("button", { name: "How is profit margin calculated?" }));
    expect(await screen.findByText(/Profit ÷ Sales/)).toBeInTheDocument();
  });

  it("explains when no comparison is possible", () => {
    renderWithProviders(<KpiGrid kpis={kpis} comparison={{ available: false, reason: "insufficient_history" }} keys={["sales"]} />);
    expect(screen.getByText(/not enough history/)).toBeInTheDocument();
  });
});

describe("InsightCard", () => {
  const insight: Insight = {
    id: "subcategory-negative-profit-tables",
    order: 1,
    section: "products",
    topic: "negative_profit_subcategory",
    severity: "critical",
    title: "Tables lost money overall",
    body: "Tables (Furniture) recorded -$17,725 of profit.",
    metric: { name: "profit", value: -17725.48 },
    caveat: "Totals cover the full period and every region.",
    evidence: { category: "Furniture", profit_margin: -0.085645, sales: 206965.53 },
  };

  it("shows severity with a label, the caveat, evidence and metric links", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InsightCard insight={insight} />);
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Totals cover the full period and every region.")).toBeInTheDocument();
    await user.click(screen.getByText("Evidence"));
    expect(screen.getByText("-8.6%")).toBeInTheDocument();
    expect(screen.getByText("$206,966")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Least profitable products/ })).toHaveAttribute(
      "href",
      "/products?category=Furniture&sort=profit&order=asc",
    );
    expect(screen.getByRole("link", { name: /Add to action plan/ })).toHaveAttribute(
      "href",
      "/actions?insight=subcategory-negative-profit-tables",
    );
  });
});

describe("FilterBar", () => {
  it("offers API-provided options and clears all filters", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FilterBar />, { route: "/?region=East&start=2016-01-01&end=2016-12-31&sort=profit" });
    expect(await screen.findByRole("combobox", { name: "Region" })).toHaveTextContent("East");
    expect(screen.getByRole("combobox", { name: "Period" })).toHaveTextContent("2016");

    await user.click(screen.getByRole("button", { name: /Clear filters/ }));
    // Filters are gone; page-specific parameters survive.
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/\?sort=profit$/);
    expect(screen.getByRole("button", { name: /Clear filters/ })).toBeDisabled();
  });

  it("applies a filter from the allowlist", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FilterBar />, { route: "/" });
    await user.click(await screen.findByRole("combobox", { name: "Ship mode" }));
    await user.click(await screen.findByRole("option", { name: "Same Day" }));
    expect(screen.getByTestId("location")).toHaveTextContent("shipMode=Same+Day");
  });
});
