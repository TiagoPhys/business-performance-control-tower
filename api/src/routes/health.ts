import { queryFirst, statement } from "../lib/db";
import { ok } from "../lib/http";
import { readParams } from "../lib/params";
import type { RouteContext } from "./types";

/** Liveness plus a cheap database round trip; reports the loaded dataset version. */
export async function health({ db, url }: RouteContext): Promise<Response> {
  readParams(url, []);
  const row = await queryFirst<{ value: string }>(
    statement(db, "SELECT value FROM dataset_metadata WHERE key = 'source_sha256'"),
  );
  return ok(
    { status: "ok", database: "ok", datasetVersion: row ? row.value.slice(0, 12) : null },
    {},
    { cache: false },
  );
}
