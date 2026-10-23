/**
 * Metric definitions shown next to KPIs and on the Methodology page. These describe
 * how the API computes each number; they are documentation, not data.
 */
import type { KpiKey } from "@/api/types";
import { formatCurrency, formatDays, formatNumber, formatPercent } from "./format";

export type ChangeStyle = "percent" | "points" | "days";

export interface KpiDefinition {
  key: KpiKey;
  label: string;
  formula: string;
  format: (value: number | null) => string;
  change: ChangeStyle;
  /** Whether an increase is good news (drives the colour of the change). */
  higherIsBetter: boolean;
}

export const KPI_DEFINITIONS: KpiDefinition[] = [
  {
    key: "sales",
    label: "Sales",
    formula: "Sum of line sales in the period. Superstore sales are already net of discount.",
    format: (v) => formatCurrency(v),
    change: "percent",
    higherIsBetter: true,
  },
  {
    key: "profit",
    label: "Profit",
    formula: "Sum of line profit in the period.",
    format: (v) => formatCurrency(v),
    change: "percent",
    higherIsBetter: true,
  },
  {
    key: "profitMargin",
    label: "Profit margin",
    formula: "Profit ÷ Sales. Changes are shown in percentage points (pp).",
    format: (v) => formatPercent(v),
    change: "points",
    higherIsBetter: true,
  },
  {
    key: "orders",
    label: "Orders",
    formula: "Count of distinct orders. With a category filter, an order counts once if it has any line in that category.",
    format: (v) => formatNumber(v),
    change: "percent",
    higherIsBetter: true,
  },
  {
    key: "averageOrderValue",
    label: "Average order value",
    formula: "Sales ÷ Orders.",
    format: (v) => formatCurrency(v, { cents: true }),
    change: "percent",
    higherIsBetter: true,
  },
  {
    key: "unitsSold",
    label: "Units sold",
    formula: "Sum of line quantity.",
    format: (v) => formatNumber(v),
    change: "percent",
    higherIsBetter: true,
  },
  {
    key: "customers",
    label: "Customers",
    formula: "Count of distinct customers with at least one order in the period.",
    format: (v) => formatNumber(v),
    change: "percent",
    higherIsBetter: true,
  },
  {
    key: "averageShippingDays",
    label: "Avg. days to ship",
    formula: "Mean of (ship date − order date) in days, counted once per order. This is time to dispatch, not delivery.",
    format: (v) => formatDays(v, 2),
    change: "days",
    higherIsBetter: false,
  },
];

export const COMPARISON_NOTE =
  "Compared with the previous period of the same length, immediately before the selected one. Percent changes are relative to the absolute previous value.";

export const LIMITATIONS: { title: string; body: string }[] = [
  {
    title: "No promised delivery date",
    body: "The data records when an order shipped, not when it was promised or delivered, so on-time rates and SLA compliance cannot be measured. Operations shows time to ship only.",
  },
  {
    title: "Associations, not causes",
    body: "Insights describe patterns such as lower margins on heavily discounted lines. Discounts also vary with product, region and order mix, so the data cannot show what would happen if a lever changed.",
  },
  {
    title: "Sample dataset",
    body: "Sample Superstore is a public teaching dataset with fictional customers. It is suitable for demonstrating analysis, not for drawing conclusions about a real business.",
  },
  {
    title: "Reused product IDs",
    body: "Some Product IDs are used for more than one product name. Products are identified by ID and name together, so the same ID can appear twice in the product table.",
  },
  {
    title: "Insights cover the full dataset",
    body: "Pipeline insights are generated once for the whole period and do not change with the filters. KPIs, charts and tables do follow the filters.",
  },
  {
    title: "Previous-period comparisons need history",
    body: "Comparisons appear only when the data covers the whole previous period; for the earliest periods and for 'All time' there is nothing to compare with.",
  },
];
