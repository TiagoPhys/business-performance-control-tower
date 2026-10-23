import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "@/api/client";
import type { Operations, Product, Products } from "@/api/types";
import { envelope, renderWithProviders } from "@/test/render";
import { OperationsPage } from "./OperationsPage";
import { ProductsPage } from "./ProductsPage";

vi.mock("@/api/client", async (original) => {
  const actual = await original<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      products: vi.fn(),
      breakdowns: vi.fn(),
      insights: vi.fn(),
      operations: vi.fn(),
    },
  };
});

const mocked = vi.mocked(api);

const product: Product = {
  productKey: 1646,
  productId: "TEC-MA-10000418",
  productName: "Cubify CubeX 3D Printer Double Head Print",
  category: "Technology",
  subCategory: "Machines",
  sales: 11099.96,
  profit: -8879.97,
  profitMargin: -0.8,
  unitsSold: 9,
  orders: 3,
  averageDiscount: 0.7,
};

const page = (items: Product[], totalItems = items.length): Products => ({
  period: { start: "2014-01-03", end: "2017-12-30", days: 1458 },
  items,
  pagination: { page: 1, pageSize: 20, totalItems, totalPages: Math.ceil(totalItems / 20) },
});

beforeEach(() => {
  mocked.breakdowns.mockResolvedValue(envelope({ dimension: "subcategory", period: null, rows: [] }));
  mocked.insights.mockResolvedValue(envelope({ items: [] }));
});

describe("ProductsPage", () => {
  it("renders API rows with formatted values and server-side sorting from the URL", async () => {
    mocked.products.mockResolvedValue(envelope(page([product], 1894)));
    renderWithProviders(<ProductsPage />, { route: "/products?sort=profit&order=asc&region=West" });
    expect(await screen.findByText("Cubify CubeX 3D Printer Double Head Print")).toBeInTheDocument();
    expect(screen.getByText("-$8,879.97")).toBeInTheDocument();
    expect(screen.getByText("70.0%")).toBeInTheDocument();
    expect(screen.getByText(/1,894 products/)).toBeInTheDocument();
    expect(mocked.products).toHaveBeenCalledWith(
      { region: "West" },
      expect.objectContaining({ sort: "profit", order: "asc", page: 1, pageSize: 20 }),
      expect.anything(),
    );
    expect(screen.getByRole("columnheader", { name: /Profit/ })).toHaveAttribute("aria-sort", "ascending");
  });

  it("sends searches to the API and explains empty results", async () => {
    mocked.products.mockResolvedValue(envelope(page([])));
    const user = userEvent.setup();
    renderWithProviders(<ProductsPage />, { route: "/products" });
    await user.type(await screen.findByRole("searchbox", { name: "Search products" }), "zzz");
    expect(await screen.findByText("No products match “zzz”")).toBeInTheDocument();
    expect(mocked.products).toHaveBeenLastCalledWith({}, expect.objectContaining({ q: "zzz" }), expect.anything());
  });

  it("shows API failures with a retry", async () => {
    mocked.products.mockRejectedValue(new ApiError(503, "database_unavailable", "The data service is temporarily unavailable.", "req-9"));
    renderWithProviders(<ProductsPage />, { route: "/products" });
    expect(await screen.findByText("The data service is temporarily unavailable.")).toBeInTheDocument();
    expect(screen.getByText("Request ID: req-9")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });
});

describe("OperationsPage", () => {
  const operations: Operations = {
    period: { start: "2014-01-03", end: "2017-12-30", days: 1458 },
    summary: { orders: 3, averageShippingDays: 2.67, minShippingDays: 0, maxShippingDays: 5, medianShippingDays: 3 },
    byShipMode: [
      { shipMode: "Same Day", orders: 1, averageShippingDays: 0, minShippingDays: 0, maxShippingDays: 0, medianShippingDays: 0, shareOfOrders: 0.333 },
    ],
    byRegion: [{ region: "East", orders: 1, averageShippingDays: 0, minShippingDays: 0, maxShippingDays: 0 }],
    matrix: [{ region: "East", shipMode: "Same Day", orders: 1, averageShippingDays: 0 }],
    distribution: [{ shippingDays: 0, orders: 1, byShipMode: { "Same Day": 1 } }],
  };

  it("reports time to ship and explains the missing on-time measure", async () => {
    mocked.operations.mockResolvedValue(envelope(operations));
    renderWithProviders(<OperationsPage />, { route: "/operations" });
    expect(await screen.findByText("2.67 days")).toBeInTheDocument();
    expect(screen.getByText("Why there is no on-time delivery rate")).toBeInTheDocument();
    expect(screen.queryByText(/on-time rate:|SLA met/i)).not.toBeInTheDocument();
  });

  it("offers to clear filters when nothing matches", async () => {
    mocked.operations.mockResolvedValue(envelope({ ...operations, summary: { ...operations.summary, orders: 0 } }));
    renderWithProviders(<OperationsPage />, { route: "/operations?region=West&shipMode=Same+Day" });
    expect(await screen.findByText("No orders for these filters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Clear filters/ })).toBeInTheDocument();
  });
});
