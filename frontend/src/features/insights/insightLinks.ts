import type { Insight } from "@/api/types";

export interface MetricLink {
  label: string;
  to: string;
}

function evidenceField(insight: Insight, key: string): string | undefined {
  const evidence = insight.evidence as Record<string, unknown> | null;
  const value = evidence?.[key];
  return typeof value === "string" ? value : undefined;
}

/** Where the numbers behind an insight can be explored. Unknown topics get the methodology page. */
export function linksFor(insight: Insight): MetricLink[] {
  switch (insight.topic) {
    case "regional_performance":
      return [{ label: "Sales and profit by region", to: "/drivers?dimension=region" }];
    case "negative_profit_subcategory": {
      const category = evidenceField(insight, "category");
      const query = category ? `?category=${encodeURIComponent(category)}` : "";
      return [
        { label: "Profit by sub-category", to: `/drivers${query}${query ? "&" : "?"}dimension=subcategory` },
        { label: "Least profitable products", to: `/products${query}${query ? "&" : "?"}sort=profit&order=asc` },
      ];
    }
    case "high_sales_negative_profit":
      return [{ label: "Products sorted by profit", to: "/products?sort=profit&order=asc" }];
    case "discount_profit_pattern":
      return [
        { label: "Products by average discount", to: "/products?sort=averageDiscount&order=desc" },
        { label: "Profit margin by category", to: "/drivers?dimension=category" },
      ];
    default:
      return [{ label: "Methodology", to: "/methodology" }];
  }
}
