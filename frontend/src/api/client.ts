/**
 * The only module that talks to the API. Every request goes through `request()`,
 * which builds the URL from `VITE_API_BASE_URL`, drops empty parameters and turns
 * every failure (configuration, network, HTTP, malformed body) into an `ApiError`.
 *
 * `VITE_API_BASE_URL` is public configuration baked into the bundle; it must never
 * hold credentials. The API is read-only and needs none.
 */
import type {
  Breakdowns,
  DataQuality,
  Dimension,
  Envelope,
  Filters,
  Granularity,
  Insights,
  Meta,
  Operations,
  Overview,
  ProductQuery,
  Products,
  ResponseMeta,
  Severity,
  Trends,
} from "./types";

export type QueryValue = string | number | null | undefined;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }

  /** Client errors are not worth retrying. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export function apiBaseUrl(): string | undefined {
  const value = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return value?.trim() ? value.trim().replace(/\/+$/, "") : undefined;
}

/** Build the full request URL, skipping empty parameters. */
export function buildUrl(base: string, path: string, params: Record<string, QueryValue> = {}): string {
  const url = new URL(`${base}${path}`);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value));
  }
  return url.toString();
}

export async function request<T, M = ResponseMeta>(
  path: string,
  params: Record<string, QueryValue> = {},
  signal?: AbortSignal,
): Promise<Envelope<T, M>> {
  const base = apiBaseUrl();
  if (!base) {
    throw new ApiError(0, "config_error", "The API address is not configured (VITE_API_BASE_URL).");
  }
  let response: Response;
  try {
    response = await fetch(buildUrl(base, path, params), { headers: { Accept: "application/json" }, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "network_error", "Could not reach the API. Check your connection and try again.");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(response.status, "invalid_response", "The API returned an unexpected response.");
  }
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string; requestId?: string } }).error;
    throw new ApiError(
      response.status,
      error?.code ?? "http_error",
      error?.message ?? `The API responded with status ${response.status}.`,
      error?.requestId,
    );
  }
  return body as Envelope<T, M>;
}

const filterParams = (filters: Filters): Record<string, QueryValue> => ({ ...filters });

export const api = {
  meta: (signal?: AbortSignal) => request<Meta>("/api/meta", {}, signal),
  overview: (filters: Filters, signal?: AbortSignal) => request<Overview>("/api/overview", filterParams(filters), signal),
  trends: (filters: Filters, granularity: Granularity, signal?: AbortSignal) =>
    request<Trends>("/api/trends", { ...filterParams(filters), granularity }, signal),
  breakdowns: (filters: Filters, dimension: Dimension, signal?: AbortSignal) =>
    request<Breakdowns>("/api/breakdowns", { ...filterParams(filters), dimension }, signal),
  products: (filters: Filters, query: ProductQuery, signal?: AbortSignal) =>
    request<Products>("/api/products", { ...filterParams(filters), ...query }, signal),
  operations: (filters: Filters, signal?: AbortSignal) =>
    request<Operations>("/api/operations", filterParams(filters), signal),
  insights: (params: { section?: string; severity?: Severity } = {}, signal?: AbortSignal) =>
    request<Insights>("/api/insights", params, signal),
  dataQuality: (signal?: AbortSignal) => request<DataQuality>("/api/data-quality", {}, signal),
};
