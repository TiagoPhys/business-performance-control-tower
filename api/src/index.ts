/**
 * Business Performance Control Tower API: a read-only Cloudflare Worker over D1.
 *
 * Every endpoint is GET (HEAD and CORS preflight are also answered). There are no
 * write endpoints. All user input is validated against allowlists and bound as
 * SQL parameters; SQL text is assembled only from fixed fragments in this codebase.
 */
import { ApiError, DatabaseError } from "./lib/errors";
import { errorResponse, preflight, withCors } from "./lib/http";
import { breakdowns } from "./routes/breakdowns";
import { dataQuality } from "./routes/dataQuality";
import { health } from "./routes/health";
import { insights } from "./routes/insights";
import { meta } from "./routes/meta";
import { operations } from "./routes/operations";
import { overview } from "./routes/overview";
import { products } from "./routes/products";
import { trends } from "./routes/trends";
import type { Handler } from "./routes/types";

export const ROUTES: Record<string, Handler> = {
  "/api/health": health,
  "/api/meta": meta,
  "/api/overview": overview,
  "/api/trends": trends,
  "/api/breakdowns": breakdowns,
  "/api/products": products,
  "/api/operations": operations,
  "/api/insights": insights,
  "/api/data-quality": dataQuality,
};

const READ_METHODS = new Set(["GET", "HEAD"]);

function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

/** Log failures server-side with enough context to debug, without request data. */
function logFailure(requestId: string, path: string, error: unknown): void {
  const cause = error instanceof DatabaseError ? error.cause : error;
  console.error(
    JSON.stringify({
      level: "error",
      requestId,
      path,
      error: error instanceof Error ? error.name : "UnknownError",
      message: cause instanceof Error ? cause.message : String(cause),
    }),
  );
}

async function route(request: Request, env: Env, requestId: string): Promise<Response> {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const handler = ROUTES[path];
  if (!handler) return errorResponse(new ApiError(404, "not_found", "Route not found."), requestId);
  if (request.method === "OPTIONS") return preflight(request.headers.get("Origin"), env.ALLOWED_ORIGINS);
  if (!READ_METHODS.has(request.method)) {
    return errorResponse(new ApiError(405, "method_not_allowed", "This API is read-only."), requestId);
  }
  try {
    if (!env.DB) throw new DatabaseError(new Error("D1 binding 'DB' is not configured"));
    return await handler({ db: env.DB, url });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error, requestId);
    logFailure(requestId, path, error);
    if (error instanceof DatabaseError) {
      return errorResponse(
        new ApiError(503, "database_unavailable", "The data service is temporarily unavailable."),
        requestId,
      );
    }
    return errorResponse(new ApiError(500, "internal_error", "An unexpected error occurred."), requestId);
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    const routed = await route(request, env, requestId);
    const response = withCors(routed, request.headers.get("Origin"), env.ALLOWED_ORIGINS);
    response.headers.set("X-Request-Id", requestId);
    return request.method === "HEAD"
      ? new Response(null, { status: response.status, headers: response.headers })
      : response;
  },
} satisfies ExportedHandler<Env>;
