import { ApiError } from "./errors";

/** Data is reloaded at most daily, so short public caching is safe and saves D1 reads. */
const SUCCESS_CACHE_CONTROL = "public, max-age=300";

const BASE_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

export const ALLOWED_METHODS = "GET, HEAD, OPTIONS";

export interface ResponseMeta {
  [key: string]: unknown;
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...headers } });
}

/** `{ data, meta }` envelope for successful responses. */
export function ok(data: unknown, meta: ResponseMeta = {}, { cache = true } = {}): Response {
  return json({ data, meta }, 200, { "Cache-Control": cache ? SUCCESS_CACHE_CONTROL : "no-store" });
}

/** `{ error: { code, message, details?, requestId } }` envelope; never cached. */
export function errorResponse(error: ApiError, requestId: string): Response {
  const body = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      requestId,
    },
  };
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (error.status === 405) headers.Allow = ALLOWED_METHODS;
  return json(body, error.status, headers);
}

// --------------------------------------------------------------------------- CORS

/** Parse the comma-separated `ALLOWED_ORIGINS` setting into matchers. */
export function parseAllowedOrigins(setting: string | undefined): ((origin: string) => boolean)[] {
  return (setting ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (!entry.includes("*")) return (origin: string) => origin === entry;
      // "https://*.example.pages.dev" matches exactly one extra subdomain label.
      const pattern = entry
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[a-z0-9-]+");
      const regex = new RegExp(`^${pattern}$`);
      return (origin: string) => regex.test(origin);
    });
}

export function isOriginAllowed(origin: string | null, setting: string | undefined): boolean {
  return origin !== null && parseAllowedOrigins(setting).some((matches) => matches(origin));
}

/** Add CORS headers when the request's Origin is allowed; otherwise leave the response as is. */
export function withCors(response: Response, origin: string | null, setting: string | undefined): Response {
  const headers = new Headers(response.headers);
  headers.append("Vary", "Origin");
  if (origin && isOriginAllowed(origin, setting)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Expose-Headers", "X-Request-Id");
  }
  return new Response(response.body, { status: response.status, headers });
}

/** Answer a CORS preflight. Only read-only methods are ever advertised. */
export function preflight(origin: string | null, setting: string | undefined): Response {
  const headers: Record<string, string> = { Vary: "Origin", "Cache-Control": "no-store" };
  if (origin && isOriginAllowed(origin, setting)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = ALLOWED_METHODS;
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(null, { status: 204, headers });
}
