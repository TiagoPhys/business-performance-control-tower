import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getJson, request, seedFixture } from "./helpers";

beforeAll(seedFixture);
afterEach(() => vi.restoreAllMocks());

describe("routing and methods", () => {
  it("returns 404 JSON for unknown routes", async () => {
    const { status, body } = await getJson("/api/admin");
    expect(status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("rejects %s as read-only", async (method) => {
    const response = await request("/api/overview", { method });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
    expect(((await response.json()) as any).error.code).toBe("method_not_allowed");
  });

  it("answers HEAD without a body", async () => {
    const response = await request("/api/health", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("tolerates a trailing slash", async () => {
    expect((await request("/api/health/")).status).toBe(200);
  });

  it("sets JSON, security and cache headers", async () => {
    const response = await request("/api/overview");
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    const error = await request("/api/overview?region=North");
    expect(error.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("CORS", () => {
  const withOrigin = (origin: string, init: RequestInit = {}) =>
    request("/api/overview", { ...init, headers: { Origin: origin, ...(init.headers ?? {}) } });

  it("allows the configured frontend origin", async () => {
    const response = await withOrigin("https://app.example.com");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
    expect(response.headers.get("Vary")).toContain("Origin");
  });

  it("allows one-level wildcard preview origins only", async () => {
    const preview = await withOrigin("https://abc123.preview.example.com");
    expect(preview.headers.get("Access-Control-Allow-Origin")).toBe("https://abc123.preview.example.com");
    for (const origin of [
      "https://a.b.preview.example.com",
      "https://abc.preview.example.com.evil.com",
      "https://evil.com",
      "http://app.example.com",
    ]) {
      const response = await withOrigin(origin);
      expect(response.headers.get("Access-Control-Allow-Origin"), origin).toBeNull();
    }
  });

  it("answers preflight with read-only methods", async () => {
    const response = await withOrigin("https://app.example.com", {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Method": "GET" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, HEAD, OPTIONS");
    const denied = await withOrigin("https://evil.com", { method: "OPTIONS" });
    expect(denied.status).toBe(204);
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("database failures", () => {
  const failing = (message: string) =>
    ({
      prepare: () => {
        const prepared = {
          bind: () => prepared,
          all: () => Promise.reject(new Error(message)),
          first: () => Promise.reject(new Error(message)),
          run: () => Promise.reject(new Error(message)),
        };
        return prepared;
      },
      batch: () => Promise.reject(new Error(message)),
    }) as unknown as D1Database;

  it.each(["/api/health", "/api/overview", "/api/trends", "/api/products", "/api/data-quality"])(
    "%s returns 503 without leaking internals",
    async (path) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await request(path, {}, { DB: failing("D1_ERROR: no such table: secret_internal_table") });
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(JSON.parse(text).error.code).toBe("database_unavailable");
      expect(text).not.toMatch(/secret_internal_table|D1_ERROR|SELECT/);
      expect(log).toHaveBeenCalledOnce(); // logged server-side instead
    },
  );

  it("returns 503 when the DB binding is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await request("/api/overview", {}, { DB: undefined as unknown as D1Database });
    expect(response.status).toBe(503);
  });

  it("still validates input before touching the database", async () => {
    const response = await request("/api/overview?region=North", {}, { DB: failing("boom") });
    expect(response.status).toBe(400);
  });
});
