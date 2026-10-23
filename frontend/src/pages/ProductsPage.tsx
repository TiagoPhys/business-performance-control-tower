import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { Product, ProductSort, SortOrder } from "@/api/types";
import { ChartCard, RankedBarChart, SignedLegend } from "@/components/charts/Charts";
import { DataTable, ExportButton } from "@/components/data/DataTable";
import { PageHeader } from "@/components/layout/AppLayout";
import { EmptyState, NoResults, QueryBoundary } from "@/components/states/States";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InsightsPanel } from "@/features/insights/InsightCard";
import { useBreakdowns, useInsights, useProducts } from "@/hooks/useApi";
import { useFilters } from "@/hooks/useFilters";
import type { CsvColumn } from "@/lib/csv";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";

const SORTS: ProductSort[] = ["sales", "profit", "profitMargin", "unitsSold", "orders", "averageDiscount", "name"];
const PAGE_SIZES = [10, 20, 50];
const compact = (value: number) => formatCurrency(value, { compact: true });

/** Table column id -> API sort key. */
const COLUMN_SORT: Record<string, ProductSort> = {
  productName: "name",
  sales: "sales",
  profit: "profit",
  profitMargin: "profitMargin",
  unitsSold: "unitsSold",
  averageDiscount: "averageDiscount",
  orders: "orders",
};

const columns: ColumnDef<Product, any>[] = [
  {
    accessorKey: "productName",
    header: "Product",
    cell: ({ row }) => (
      <div className="min-w-56 max-w-md">
        <p className="truncate font-medium" title={row.original.productName}>{row.original.productName}</p>
        <p className="text-xs text-muted-foreground">
          {row.original.productId} · {row.original.subCategory ?? "—"}
        </p>
      </div>
    ),
  },
  { accessorKey: "sales", header: "Sales", cell: (c) => formatCurrency(c.getValue(), { cents: true }), meta: { align: "right" } },
  { accessorKey: "profit", header: "Profit", cell: (c) => formatCurrency(c.getValue(), { cents: true }), meta: { align: "right" } },
  { accessorKey: "profitMargin", header: "Margin", cell: (c) => formatPercent(c.getValue()), meta: { align: "right" } },
  { accessorKey: "unitsSold", header: "Quantity", cell: (c) => formatNumber(c.getValue()), meta: { align: "right" } },
  { accessorKey: "averageDiscount", header: "Avg. discount", cell: (c) => formatPercent(c.getValue()), meta: { align: "right" } },
  { accessorKey: "orders", header: "Orders", cell: (c) => formatNumber(c.getValue()), meta: { align: "right" } },
];

const csvColumns: CsvColumn<Product>[] = [
  { header: "Product ID", value: (p) => p.productId },
  { header: "Product", value: (p) => p.productName },
  { header: "Category", value: (p) => p.category },
  { header: "Sub-category", value: (p) => p.subCategory },
  { header: "Sales", value: (p) => p.sales },
  { header: "Profit", value: (p) => p.profit },
  { header: "Profit margin", value: (p) => p.profitMargin },
  { header: "Quantity", value: (p) => p.unitsSold },
  { header: "Average discount", value: (p) => p.averageDiscount },
  { header: "Orders", value: (p) => p.orders },
];

function useProductQuery() {
  const [params, setParams] = useSearchParams();
  const sortParam = params.get("sort") as ProductSort | null;
  const sort: ProductSort = sortParam && SORTS.includes(sortParam) ? sortParam : "sales";
  const order: SortOrder = params.get("order") === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const sizeParam = Number.parseInt(params.get("pageSize") ?? "20", 10);
  const pageSize = PAGE_SIZES.includes(sizeParam) ? sizeParam : 20;
  const q = params.get("q") ?? "";

  const set = (patch: Record<string, string | null>, resetPage = true) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      if (resetPage) next.delete("page");
      return next;
    });

  return { sort, order, page, pageSize, q, set };
}

function SearchBox({ value, onSearch }: { value: string; onSearch: (value: string) => void }) {
  const id = useId();
  const [text, setText] = useState(value);
  const latest = useRef({ value, onSearch });
  latest.current = { value, onSearch };
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text.trim() === latest.current.value) return;
    const timer = window.setTimeout(() => latest.current.onSearch(text.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [text]);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="sr-only">
        Search products
      </Label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
        <Input id={id} type="search" value={text} maxLength={64} placeholder="Search name or product ID"
          onChange={(e) => setText(e.target.value)} className="w-64 pl-8" />
      </div>
    </div>
  );
}

export function ProductsPage() {
  const { filters } = useFilters();
  const query = useProductQuery();
  const products = useProducts(filters, {
    q: query.q || undefined,
    sort: query.sort,
    order: query.order,
    page: query.page,
    pageSize: query.pageSize,
  });
  const subcategories = useBreakdowns(filters, "subcategory");
  const insights = useInsights({ section: "products" });

  const sortedColumn = Object.entries(COLUMN_SORT).find(([, sort]) => sort === query.sort)?.[0] ?? "sales";
  const sorting: SortingState = [{ id: sortedColumn, desc: query.order === "desc" }];

  return (
    <>
      <PageHeader
        title="Product Performance"
        description="Profitability by sub-category and product. Sorting, search and pagination run on the API, over every product matching the filters."
      />

      <QueryBoundary query={subcategories} loadingRows={5}>
        {({ data }) => {
          if (data.rows.length === 0) return null;
          const profit = [...data.rows].sort((a, b) => b.profit - a.profit).map((r) => ({ label: r.key, value: r.profit }));
          return (
            <ChartCard title="Profit by sub-category" summary={`${profit.filter((p) => (p.value ?? 0) < 0).length} sub-categories made a loss.`}
              data={profit} format={(v) => formatCurrency(v)} valueHeader="Profit" footer={<SignedLegend />}>
              <RankedBarChart data={profit} signed format={(v) => formatCurrency(v)} axisFormat={compact} />
            </ChartCard>
          );
        }}
      </QueryBoundary>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Products</CardTitle>
          <CardDescription>Average discount is the mean of the discount on each order line.</CardDescription>
          <CardAction>
            <ExportButton rows={products.data?.data.items ?? []} columns={csvColumns} filename={`products-page-${query.page}.csv`}
              label="Export page (CSV)" />
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SearchBox value={query.q} onSearch={(q) => query.set({ q })} />
            <div className="flex items-center gap-2 text-sm">
              <Label htmlFor="page-size" className="text-muted-foreground">Rows per page</Label>
              <Select value={String(query.pageSize)} onValueChange={(v) => query.set({ pageSize: v })}>
                <SelectTrigger id="page-size" className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <QueryBoundary query={products} loadingRows={8}>
            {({ data }) => {
              if (data.items.length === 0) {
                return query.q ? (
                  <EmptyState title={`No products match “${query.q}”`} description="Check the spelling or search by product ID."
                    action={<Button variant="outline" size="sm" onClick={() => query.set({ q: null })}>Clear search</Button>} />
                ) : data.pagination.totalItems > 0 ? (
                  <EmptyState title="This page is empty" action={<Button variant="outline" size="sm" onClick={() => query.set({ page: null })}>First page</Button>} />
                ) : (
                  <NoResults what="products" />
                );
              }
              const { page, totalPages, totalItems } = data.pagination;
              return (
                <div className={products.isPlaceholderData ? "opacity-60 transition-opacity" : undefined} aria-busy={products.isFetching}>
                  <DataTable
                    columns={columns}
                    data={data.items}
                    caption="Products"
                    getRowId={(p) => String(p.productKey)}
                    sorting={sorting}
                    onSortingChange={(updater) => {
                      const next = typeof updater === "function" ? updater(sorting) : updater;
                      const first = next[0];
                      if (!first) return;
                      query.set({ sort: COLUMN_SORT[first.id] ?? "sales", order: first.desc ? "desc" : "asc" });
                    }}
                  />
                  <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <p className="text-muted-foreground">
                      Page {page} of {Math.max(totalPages, 1)} · {formatNumber(totalItems)} products
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={page <= 1}
                        onClick={() => query.set({ page: String(page - 1) }, false)}>
                        <ChevronLeft aria-hidden /> Previous
                      </Button>
                      <Button variant="outline" size="sm" disabled={page >= totalPages}
                        onClick={() => query.set({ page: String(page + 1) }, false)}>
                        Next <ChevronRight aria-hidden />
                      </Button>
                    </div>
                  </nav>
                </div>
              );
            }}
          </QueryBoundary>
        </CardContent>
      </Card>

      <QueryBoundary query={insights}>
        {({ data }) => (data.items.length ? <InsightsPanel insights={data.items} title="Product insights" /> : null)}
      </QueryBoundary>
    </>
  );
}
