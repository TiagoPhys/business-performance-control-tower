import { queryBatch, statement } from "../lib/db";
import { ok } from "../lib/http";
import { readParams } from "../lib/params";
import type { RouteContext } from "./types";

export const MAX_ISSUES = 100;
const NUMERIC_METADATA = new Set(["source_rows", "clean_rows", "excluded_rows", "orders", "customers", "products"]);

interface CheckRow {
  check_id: string;
  check_group: string;
  description: string;
  status: "pass" | "warn" | "fail";
  affected_rows: number;
  details: string | null;
}

interface IssueRow {
  issue_id: number;
  check_id: string;
  row_id: string;
  column_name: string;
  raw_value: string | null;
}

export async function dataQuality({ db, url }: RouteContext): Promise<Response> {
  readParams(url, []);
  const [checks, issues, issueCount, metadata] = (await queryBatch(db, [
    statement(
      db,
      "SELECT check_id, check_group, description, status, affected_rows, details " +
        "FROM data_quality_checks ORDER BY check_group, check_id",
    ),
    statement(
      db,
      "SELECT issue_id, check_id, row_id, column_name, raw_value FROM data_quality_issues ORDER BY issue_id LIMIT ?",
      [MAX_ISSUES],
    ),
    statement(db, "SELECT COUNT(*) AS total FROM data_quality_issues"),
    statement(db, "SELECT key, value FROM dataset_metadata ORDER BY key"),
  ])) as [CheckRow[], IssueRow[], { total: number }[], { key: string; value: string }[]];

  const summary = { pass: 0, warn: 0, fail: 0 };
  for (const check of checks) summary[check.status] += 1;
  const total = issueCount[0]?.total ?? 0;
  const dataset = Object.fromEntries(
    metadata.map(({ key, value }) => [key, NUMERIC_METADATA.has(key) ? Number(value) : value]),
  );
  return ok(
    {
      dataset,
      summary,
      checks: checks.map((check) => ({
        id: check.check_id,
        group: check.check_group,
        description: check.description,
        status: check.status,
        affectedRows: check.affected_rows,
        details: check.details || null,
      })),
      issues: {
        items: issues.map((issue) => ({
          id: issue.issue_id,
          checkId: issue.check_id,
          rowId: issue.row_id,
          column: issue.column_name,
          rawValue: issue.raw_value,
        })),
        total,
        limit: MAX_ISSUES,
        truncated: total > issues.length,
      },
    },
    {},
  );
}
