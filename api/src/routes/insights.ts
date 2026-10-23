import { queryAll, statement } from "../lib/db";
import { ok } from "../lib/http";
import { parseEnum, readParams } from "../lib/params";
import { whereClause } from "../lib/scope";
import type { RouteContext } from "./types";

const SECTIONS = ["overview", "drivers", "products", "operations"] as const;
const SEVERITIES = ["critical", "warning", "info"] as const;

interface InsightRow {
  insight_id: string;
  display_order: number;
  section: string;
  topic: string;
  severity: string;
  title: string;
  body: string;
  metric_name: string | null;
  metric_value: number | null;
  caveat: string | null;
  evidence_json: string;
}

function parseEvidence(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function insights({ db, url }: RouteContext): Promise<Response> {
  const params = readParams(url, ["section", "severity"]);
  const section = parseEnum("section", params.get("section"), SECTIONS);
  const severity = parseEnum("severity", params.get("severity"), SEVERITIES);
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (section) {
    clauses.push("section = ?");
    values.push(section);
  }
  if (severity) {
    clauses.push("severity = ?");
    values.push(severity);
  }
  const rows = await queryAll<InsightRow>(
    statement(db, `SELECT * FROM insights${whereClause(clauses)} ORDER BY display_order`, values),
  );
  const items = rows.map((row) => ({
    id: row.insight_id,
    order: row.display_order,
    section: row.section,
    topic: row.topic,
    severity: row.severity,
    title: row.title,
    body: row.body,
    metric: row.metric_name ? { name: row.metric_name, value: row.metric_value } : null,
    caveat: row.caveat || null,
    evidence: parseEvidence(row.evidence_json),
  }));
  return ok({ items }, { filters: { section: section ?? null, severity: severity ?? null } });
}
