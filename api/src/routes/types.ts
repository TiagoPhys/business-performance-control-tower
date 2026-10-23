export interface RouteContext {
  db: D1Database;
  url: URL;
}

export type Handler = (context: RouteContext) => Promise<Response>;

/** Where a response's numbers came from: pre-computed tables or row-level SQL. */
export type Source = "precomputed" | "live";
