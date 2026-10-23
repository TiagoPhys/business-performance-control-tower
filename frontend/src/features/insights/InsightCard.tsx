import { AlertOctagon, AlertTriangle, ArrowRight, Info, ListPlus, type LucideIcon } from "lucide-react";
import { Link } from "react-router";
import type { Insight, Severity } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Evidence } from "./Evidence";
import { linksFor } from "./insightLinks";

const SEVERITY: Record<Severity, { label: string; icon: LucideIcon; className: string }> = {
  critical: { label: "Critical", icon: AlertOctagon, className: "border-[var(--status-critical)] text-[var(--status-critical-text)]" },
  warning: { label: "Warning", icon: AlertTriangle, className: "border-[var(--status-warning)] text-[var(--status-warning-text)]" },
  info: { label: "Info", icon: Info, className: "border-[var(--status-info)] text-[var(--status-info-text)]" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { label, icon: Icon, className } = SEVERITY[severity];
  return (
    <Badge variant="outline" className={className}>
      <Icon aria-hidden /> {label}
    </Badge>
  );
}

export function InsightCard({ insight }: { insight: Insight }) {
  const links = linksFor(insight);
  return (
    <Card className="gap-3">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={insight.severity} />
          <span className="text-xs text-muted-foreground">#{insight.order}</span>
        </div>
        <CardTitle className="text-base leading-snug">{insight.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>{insight.body}</p>
        <div className="rounded-md border-l-2 border-[var(--status-warning)] bg-muted/40 px-3 py-2">
          <p className="text-xs font-medium">Caveat</p>
          <p className="text-xs text-muted-foreground">
            {insight.caveat ?? "No caveat was provided by the pipeline for this insight."}
          </p>
        </div>
        <details className="group rounded-md border px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium">Evidence</summary>
          <div className="mt-2 space-y-2">
            {insight.metric && (
              <p className="text-xs">
                <span className="text-muted-foreground">Headline metric: </span>
                <Evidence value={{ [insight.metric.name]: insight.metric.value }} />
              </p>
            )}
            <Evidence value={insight.evidence} />
          </div>
        </details>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {links.map((link) => (
          <Button key={link.to} asChild variant="link" size="sm" className="h-auto px-0">
            <Link to={link.to}>
              {link.label} <ArrowRight aria-hidden />
            </Link>
          </Button>
        ))}
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <Link to={`/actions?insight=${encodeURIComponent(insight.id)}`}>
            <ListPlus aria-hidden /> Add to action plan
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

export function InsightsPanel({ insights, title = "Insights" }: { insights: Insight[]; title?: string }) {
  return (
    <section aria-labelledby="insights-heading" className="space-y-3">
      <div>
        <h2 id="insights-heading" className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">
          Generated deterministically by the Python pipeline over the full dataset; they do not change with the filters.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {insights.map((insight) => (
          <InsightCard key={insight.id} insight={insight} />
        ))}
      </div>
    </section>
  );
}
