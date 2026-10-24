import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, CheckCircle2, type LucideIcon, XCircle } from "lucide-react";
import type { QualityCheck } from "@/api/types";
import { DataTable, ExportButton } from "@/components/data/DataTable";
import { PageHeader } from "@/components/layout/AppLayout";
import { EmptyState, QueryBoundary } from "@/components/states/States";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDataQuality } from "@/hooks/useApi";
import type { CsvColumn } from "@/lib/csv";
import { COMPARISON_NOTE, KPI_DEFINITIONS, LIMITATIONS } from "@/lib/definitions";
import { formatDate, formatNumber } from "@/lib/format";

const STATUS: Record<QualityCheck["status"], { label: string; icon: LucideIcon; className: string; meaning: string }> = {
  pass: { label: "Pass", icon: CheckCircle2, className: "text-[var(--status-good-text)]", meaning: "nothing found" },
  warn: { label: "Warn", icon: AlertTriangle, className: "text-[var(--status-warning-text)]", meaning: "found and handled, rows kept" },
  fail: { label: "Fail", icon: XCircle, className: "text-[var(--status-critical-text)]", meaning: "affected rows excluded" },
};

function StatusBadge({ status }: { status: QualityCheck["status"] }) {
  const { label, icon: Icon, className } = STATUS[status];
  return (
    <Badge variant="outline" className={className}>
      <Icon aria-hidden /> {label}
    </Badge>
  );
}

const checkColumns: ColumnDef<QualityCheck, any>[] = [
  { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  { accessorKey: "group", header: "Group" },
  { accessorKey: "description", header: "Check", cell: ({ row }) => <span className="block min-w-64">{row.original.description}</span> },
  { accessorKey: "affectedRows", header: "Rows affected", cell: (c) => formatNumber(c.getValue()), meta: { align: "right" } },
  { accessorKey: "details", header: "Details", enableSorting: false, cell: (c) => <span className="text-xs text-muted-foreground">{c.getValue() ?? "—"}</span> },
];

const checkCsv: CsvColumn<QualityCheck>[] = [
  { header: "Check ID", value: (c) => c.id },
  { header: "Group", value: (c) => c.group },
  { header: "Description", value: (c) => c.description },
  { header: "Status", value: (c) => c.status },
  { header: "Rows affected", value: (c) => c.affectedRows },
  { header: "Details", value: (c) => c.details },
];

const PIPELINE = [
  ["Prepare", "Reads the CSV as text, normalises headers, parses dates strictly (US m/d/YYYY or ISO), converts measures to numbers and runs the data quality checks below."],
  ["Model", "Splits the data into orders (one row per Order ID) and order lines (one row per Row ID), plus products and customers. Customer names are dropped."],
  ["Aggregate", "Computes KPI tables with DuckDB for every filter combination and reconciles them against totals computed independently with pandas."],
  ["Insights", "Applies fixed rules and thresholds to produce ranked insights, each with its evidence and a caveat. A guard rejects causal wording."],
  ["Publish", "Exports a D1 load script whose columns are read from the database schema; the API serves it read-only."],
];

function DatasetFacts({ dataset }: { dataset: Record<string, string | number> }) {
  const rows: [string, string][] = [
    ["Source file", String(dataset.source_file ?? "—")],
    ["Order period", `${formatDate(dataset.min_order_date as string)} – ${formatDate(dataset.max_order_date as string)}`],
    ["Rows in source", formatNumber(dataset.source_rows as number)],
    ["Rows used / excluded", `${formatNumber(dataset.clean_rows as number)} / ${formatNumber(dataset.excluded_rows as number)}`],
    ["Orders · customers · products", `${formatNumber(dataset.orders as number)} · ${formatNumber(dataset.customers as number)} · ${formatNumber(dataset.products as number)}`],
    ["Dataset version (SHA-256)", String(dataset.source_sha256 ?? "—").slice(0, 16)],
    ["Pipeline version", String(dataset.pipeline_version ?? "—")],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MethodologyPage() {
  const quality = useDataQuality();
  return (
    <>
      <PageHeader
        title="Methodology & Data Quality"
        description="Where the data comes from, how each metric is defined, which validation checks ran and what the data cannot tell you."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Data source and period</CardTitle>
            <CardDescription>Sample Superstore Sales (US), prepared by the project's Python pipeline.</CardDescription>
          </CardHeader>
          <CardContent>
            <QueryBoundary query={quality}>
              {({ data }) =>
                Object.keys(data.dataset).length ? <DatasetFacts dataset={data.dataset} /> : <EmptyState title="No dataset loaded" />
              }
            </QueryBoundary>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm">
              {PIPELINE.map(([step, text], i) => (
                <li key={step} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{i + 1}</span>
                  <span><span className="font-medium">{step}.</span> <span className="text-muted-foreground">{text}</span></span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Metric definitions</CardTitle>
          <CardDescription>{COMPARISON_NOTE}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead>Definition</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {KPI_DEFINITIONS.map((d) => (
                  <TableRow key={d.key}>
                    <TableCell className="font-medium whitespace-nowrap">{d.label}</TableCell>
                    <TableCell className="whitespace-normal">{d.formula}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-medium whitespace-nowrap">Average discount</TableCell>
                  <TableCell className="whitespace-normal">Mean of the discount on each order line (unweighted).</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium whitespace-nowrap">Share of sales</TableCell>
                  <TableCell className="whitespace-normal">A member's sales ÷ the sales of all members shown.</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Validation checks</CardTitle>
          <CardDescription>
            {Object.entries(STATUS).map(([, s]) => `${s.label}: ${s.meaning}`).join(" · ")}
          </CardDescription>
          <CardAction>
            <ExportButton rows={quality.data?.data.checks ?? []} columns={checkCsv} filename="data-quality-checks.csv" />
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <QueryBoundary query={quality} loadingRows={6}>
            {({ data }) =>
              data.checks.length === 0 ? (
                <EmptyState title="No checks recorded" description="The database has no data quality results." />
              ) : (
                <>
                  <p className="flex flex-wrap gap-2 text-sm" aria-label="Check summary">
                    {(["pass", "warn", "fail"] as const).map((s) => (
                      <span key={s} className="inline-flex items-center gap-1">
                        <StatusBadge status={s} /> {data.summary[s]}
                      </span>
                    ))}
                  </p>
                  <DataTable columns={checkColumns} data={data.checks} caption="Data quality checks" getRowId={(c) => c.id} />
                  {data.issues.total > 0 && (
                    <div className="space-y-2">
                      <h2 className="text-sm font-medium">
                        Row-level findings ({formatNumber(data.issues.total)}{data.issues.truncated ? `, first ${data.issues.limit} shown` : ""})
                      </h2>
                      <div className="overflow-x-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Check</TableHead>
                              <TableHead>Row ID</TableHead>
                              <TableHead>Column</TableHead>
                              <TableHead>Value</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {data.issues.items.map((issue) => (
                              <TableRow key={issue.id}>
                                <TableCell>{issue.checkId}</TableCell>
                                <TableCell className="tabular-nums">{issue.rowId}</TableCell>
                                <TableCell>{issue.column}</TableCell>
                                <TableCell>{issue.rawValue ?? "—"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </>
              )
            }
          </QueryBoundary>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Limitations</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-4 md:grid-cols-2">
            {LIMITATIONS.map((item) => (
              <li key={item.title} className="text-sm">
                <p className="font-medium">{item.title}</p>
                <p className="text-muted-foreground">{item.body}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
