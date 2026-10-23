import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, buildUrl } from "./client";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com/");
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("api client", () => {
  it("builds URLs without empty parameters", () => {
    expect(buildUrl("https://x.dev", "/api/products", { q: "", region: "East", page: 2, sort: undefined })).toBe(
      "https://x.dev/api/products?region=East&page=2",
    );
  });

  it("sends filters and query options to the API", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { items: [] }, meta: {} }));
    await api.products({ region: "West", start: "2017-01-01" }, { sort: "profit", order: "asc", page: 2 });
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe("https://api.example.com/api/products");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      region: "West",
      start: "2017-01-01",
      sort: "profit",
      order: "asc",
      page: "2",
    });
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ headers: { Accept: "application/json" } });
  });

  it("turns API error envelopes into ApiError", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "invalid_parameter", message: "Invalid value for 'region'.", requestId: "r1" } }, 400),
    );
    const error = await api.overview({ region: "North" }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: "invalid_parameter", requestId: "r1", retryable: false });
  });

  it("reports network failures and server errors as retryable", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(api.overview({})).rejects.toMatchObject({ code: "network_error", retryable: true });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: "database_unavailable", message: "Down" } }, 503));
    await expect(api.overview({})).rejects.toMatchObject({ status: 503, retryable: true });
  });

  it("rejects non-JSON responses", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 502 }));
    await expect(api.meta()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("fails clearly when the API URL is not configured", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    await expect(api.meta()).rejects.toMatchObject({ code: "config_error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
