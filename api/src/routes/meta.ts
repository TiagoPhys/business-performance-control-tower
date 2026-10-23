import { queryAll, statement } from "../lib/db";
import { ok } from "../lib/http";
import { CATEGORIES, readParams, REGIONS, SEGMENTS, SHIP_MODES } from "../lib/params";
import type { RouteContext } from "./types";

/** Filter options and the dataset's date range, so clients never hard-code them. */
export async function meta({ db, url }: RouteContext): Promise<Response> {
  readParams(url, []);
  const rows = await queryAll<{ key: string; value: string }>(
    statement(
      db,
      "SELECT key, value FROM dataset_metadata WHERE key IN ('min_order_date', 'max_order_date', 'source_sha256')",
    ),
  );
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const minDate = values.get("min_order_date");
  const maxDate = values.get("max_order_date");
  const years: number[] = [];
  if (minDate && maxDate) {
    for (let year = Number(minDate.slice(0, 4)); year <= Number(maxDate.slice(0, 4)); year += 1) years.push(year);
  }
  return ok({
    dataset:
      minDate && maxDate
        ? { minDate, maxDate, version: values.get("source_sha256")?.slice(0, 12) ?? null }
        : null,
    years,
    filters: { region: REGIONS, segment: SEGMENTS, category: CATEGORIES, shipMode: SHIP_MODES },
  });
}
