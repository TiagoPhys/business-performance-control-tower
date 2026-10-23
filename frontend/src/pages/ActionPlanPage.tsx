import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { DataTable, ExportButton } from "@/components/data/DataTable";
import { PageHeader } from "@/components/layout/AppLayout";
import { EmptyState } from "@/components/states/States";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ActionForm, EMPTY_DRAFT } from "@/features/actions/ActionForm";
import {
  type ActionDraft,
  type ActionItem,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  STATUSES,
  type Status,
} from "@/features/actions/storage";
import { useActionPlan } from "@/features/actions/useActionPlan";
import { useInsights } from "@/hooks/useApi";
import type { CsvColumn } from "@/lib/csv";
import { formatDate } from "@/lib/format";

const today = () => new Date().toISOString().slice(0, 10);
export const isOverdue = (item: ActionItem, on = today()) => item.status !== "done" && item.deadline < on;

const csvColumns: CsvColumn<ActionItem>[] = [
  { header: "Title", value: (a) => a.title },
  { header: "Assignee", value: (a) => a.assignee },
  { header: "Priority", value: (a) => PRIORITY_LABELS[a.priority] },
  { header: "Deadline", value: (a) => a.deadline },
  { header: "Status", value: (a) => STATUS_LABELS[a.status] },
  { header: "Insight", value: (a) => a.insightId },
];

export function ActionPlanPage() {
  const { items, add, update, remove, saveFailed } = useActionPlan();
  const [params, setParams] = useSearchParams();
  const insightId = params.get("insight") ?? undefined;
  const insights = useInsights();
  const [editing, setEditing] = useState<ActionItem | null>(null);
  const insightTitles = useMemo(
    () => new Map((insights.data?.data.items ?? []).map((i) => [i.id, i.title])),
    [insights.data],
  );
  const linkedTitle = insightId ? insightTitles.get(insightId) : undefined;
  const initial: ActionDraft = useMemo(
    () => (linkedTitle ? { ...EMPTY_DRAFT, title: `Follow up: ${linkedTitle}`, insightId } : EMPTY_DRAFT),
    [linkedTitle, insightId],
  );

  const columns: ColumnDef<ActionItem, any>[] = [
    {
      accessorKey: "title",
      header: "Action",
      cell: ({ row }) => (
        <div className="min-w-48 max-w-md">
          <p className="font-medium">{row.original.title}</p>
          {row.original.insightId && (
            <p className="text-xs text-muted-foreground">
              From insight: {insightTitles.get(row.original.insightId) ?? row.original.insightId}
            </p>
          )}
        </div>
      ),
    },
    { accessorKey: "assignee", header: "Assignee" },
    {
      accessorKey: "priority",
      header: "Priority",
      sortingFn: (a, b) => PRIORITIES.indexOf(a.original.priority) - PRIORITIES.indexOf(b.original.priority),
      cell: ({ row }) => <Badge variant={row.original.priority === "critical" ? "destructive" : "secondary"}>{PRIORITY_LABELS[row.original.priority]}</Badge>,
    },
    {
      accessorKey: "deadline",
      header: "Deadline",
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {formatDate(row.original.deadline)}
          {isOverdue(row.original) && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--status-critical-text)]">
              <AlertTriangle className="size-3" aria-hidden /> Overdue
            </span>
          )}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      sortingFn: (a, b) => STATUSES.indexOf(a.original.status) - STATUSES.indexOf(b.original.status),
      cell: ({ row }) => (
        <Select value={row.original.status} onValueChange={(v) => update(row.original.id, { status: v as Status })}>
          <SelectTrigger className="w-36" aria-label={`Status of ${row.original.title}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Row actions</span>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label={`Edit ${row.original.title}`} onClick={() => setEditing(row.original)}>
            <Pencil aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Delete ${row.original.title}`}
            onClick={() => {
              if (window.confirm(`Delete “${row.original.title}”?`)) remove(row.original.id);
            }}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      ),
    },
  ];

  const counts = STATUSES.map((s) => [s, items.filter((i) => i.status === s).length] as const);

  return (
    <>
      <PageHeader
        title="Action Plan"
        description="Track the actions taken in response to the insights. The plan is saved in this browser (localStorage) and is not shared or sent to the API."
      />
      {saveFailed && (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>Changes could not be saved</AlertTitle>
          <AlertDescription>This browser blocked local storage, so the plan will be lost when the page is closed.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New action</CardTitle>
          {linkedTitle ? (
            <CardDescription>
              Linked to the insight “{linkedTitle}”.{" "}
              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setParams({})}>Unlink</Button>
            </CardDescription>
          ) : (
            <CardDescription>
              Start from an insight with “Add to action plan”, or write one here. <Link to="/" className="underline">See insights</Link>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <ActionForm key={initial.insightId ?? "new"} initial={initial} submitLabel="Add action"
            onSubmit={(draft) => {
              add(draft);
              if (insightId) setParams({});
            }} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actions ({items.length})</CardTitle>
          <CardDescription>
            {counts.map(([s, n]) => `${STATUS_LABELS[s]}: ${n}`).join(" · ")}
          </CardDescription>
          <CardAction>
            <ExportButton rows={items} columns={csvColumns} filename="action-plan.csv" />
          </CardAction>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState title="No actions yet" description="Actions you add will appear here and stay in this browser." />
          ) : (
            <DataTable columns={columns} data={items} caption="Action plan" getRowId={(a) => a.id}
              initialSorting={[{ id: "deadline", desc: false }]} />
          )}
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit action</DialogTitle>
            <DialogDescription>Update the action and save.</DialogDescription>
          </DialogHeader>
          {editing && (
            <ActionForm key={editing.id} initial={editing} submitLabel="Save changes" onCancel={() => setEditing(null)}
              onSubmit={(draft) => {
                update(editing.id, draft);
                setEditing(null);
              }} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
