import { env } from "cloudflare:test";
import worker from "../src/index";

const TABLES = [
  "data_quality_issues",
  "data_quality_checks",
  "insights",
  "shipping_performance",
  "discount_band_performance",
  "product_performance",
  "subcategory_performance",
  "kpi_monthly",
  "kpi_summary",
  "order_lines",
  "orders",
  "products",
  "customers",
  "dataset_metadata",
];

/** Split the generated seed into statements (its statements always end a line with ';'). */
function statements(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

/** Load the pipeline-generated fixture (3 orders, 5 lines; see tests/python/conftest.py). */
export async function seedFixture(): Promise<void> {
  await env.DB.batch(statements(env.TEST_SEED_SQL).map((sql) => env.DB.prepare(sql)));
}

/** Delete every row, leaving the schema in place. */
export async function emptyDatabase(): Promise<void> {
  await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
}

/** Send a request through the Worker's fetch handler. */
export function request(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}): Promise<Response> {
  const incoming = new Request(`https://api.example.com${path}`, init) as Request<unknown, IncomingRequestCfProperties>;
  return worker.fetch(incoming, { ...env, ...overrides });
}

export interface Envelope<T = any> {
  data: T;
  meta: any;
}

export async function getJson<T = any>(path: string, init: RequestInit = {}): Promise<{ status: number; body: Envelope<T> & { error?: any }; response: Response }> {
  const response = await request(path, init);
  return { status: response.status, body: (await response.json()) as Envelope<T>, response };
}
