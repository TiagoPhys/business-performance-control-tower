import { AlertTriangle, FilterX, Inbox, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { ApiError } from "@/api/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFilters } from "@/hooks/useFilters";

export function LoadingState({ label = "Loading data", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3 py-2">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const apiError = error instanceof ApiError ? error : null;
  const message = apiError?.message ?? "Something went wrong while loading this data.";
  return (
    <Alert variant="destructive" role="alert">
      <AlertTriangle aria-hidden />
      <AlertTitle>Couldn't load data</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        {apiError?.requestId && <p className="text-xs opacity-80">Request ID: {apiError.requestId}</p>}
        {onRetry && (!apiError || apiError.retryable) && (
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            <RotateCw aria-hidden /> Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
      <Inbox className="size-8 text-muted-foreground" aria-hidden />
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

/** Empty state for "the filters matched nothing", with a way out. */
export function NoResults({ what = "data" }: { what?: string }) {
  const { active, reset } = useFilters();
  return (
    <EmptyState
      title={`No ${what} for these filters`}
      description={active ? "Try a wider period or fewer filters." : "The dataset has no records for this view."}
      action={
        active ? (
          <Button variant="outline" size="sm" onClick={reset}>
            <FilterX aria-hidden /> Clear filters
          </Button>
        ) : undefined
      }
    />
  );
}

interface QueryLike<T> {
  data: T | undefined;
  error: unknown;
  isPending: boolean;
  refetch: () => unknown;
}

/** Render loading / error states for a query, then `children` with its data. */
export function QueryBoundary<T>({
  query,
  children,
  loadingRows,
}: {
  query: QueryLike<T>;
  children: (data: T) => ReactNode;
  loadingRows?: number;
}) {
  if (query.isPending) return <LoadingState rows={loadingRows} />;
  if (query.error || query.data === undefined) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  return <>{children(query.data)}</>;
}
