import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type OnChangeFn,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type CsvColumn, downloadCsv, toCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    align?: "left" | "right";
  }
}

/**
 * TanStack Table with shadcn styling. Sorting is client-side unless `sorting` and
 * `onSortingChange` are passed (server-side sorting, e.g. products).
 */
export function DataTable<T>({
  columns,
  data,
  caption,
  initialSorting = [],
  sorting: controlledSorting,
  onSortingChange,
  getRowId,
}: {
  columns: ColumnDef<T, any>[];
  data: T[];
  caption: string;
  initialSorting?: SortingState;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  getRowId?: (row: T) => string;
}) {
  const [localSorting, setLocalSorting] = useState<SortingState>(initialSorting);
  const manual = controlledSorting !== undefined && onSortingChange !== undefined;
  const table = useReactTable({
    data,
    columns,
    state: { sorting: manual ? controlledSorting : localSorting },
    onSortingChange: manual ? onSortingChange : setLocalSorting,
    manualSorting: manual,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manual ? undefined : getSortedRowModel(),
    getRowId,
  });

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const align = header.column.columnDef.meta?.align;
                return (
                  <TableHead
                    key={header.id}
                    className={cn(align === "right" && "text-right")}
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn("-mx-2 h-8 px-2", align === "right" && "ml-auto flex")}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === "asc" ? (
                          <ArrowUp className="size-3.5" aria-hidden />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="size-3.5" aria-hidden />
                        ) : (
                          <ArrowUpDown className="size-3.5 opacity-40" aria-hidden />
                        )}
                      </Button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  className={cn(cell.column.columnDef.meta?.align === "right" && "text-right tabular-nums")}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ExportButton<T>({
  rows,
  columns,
  filename,
  label = "Export CSV",
}: {
  rows: T[];
  columns: CsvColumn<T>[];
  filename: string;
  label?: string;
}) {
  return (
    <Button variant="outline" size="sm" disabled={rows.length === 0} onClick={() => downloadCsv(filename, toCsv(rows, columns))}>
      <Download aria-hidden /> {label}
    </Button>
  );
}
