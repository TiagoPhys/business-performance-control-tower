import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { Dimension, Filters, Granularity, ProductQuery, Severity } from "@/api/types";

/** React Query wrappers; every request still goes through `api` in src/api/client.ts. */

export const useMeta = () =>
  useQuery({ queryKey: ["meta"], queryFn: ({ signal }) => api.meta(signal), staleTime: Infinity });

export const useOverview = (filters: Filters) =>
  useQuery({ queryKey: ["overview", filters], queryFn: ({ signal }) => api.overview(filters, signal) });

export const useTrends = (filters: Filters, granularity: Granularity = "month") =>
  useQuery({
    queryKey: ["trends", filters, granularity],
    queryFn: ({ signal }) => api.trends(filters, granularity, signal),
  });

export const useBreakdowns = (filters: Filters, dimension: Dimension) =>
  useQuery({
    queryKey: ["breakdowns", filters, dimension],
    queryFn: ({ signal }) => api.breakdowns(filters, dimension, signal),
  });

export const useProducts = (filters: Filters, query: ProductQuery) =>
  useQuery({
    queryKey: ["products", filters, query],
    queryFn: ({ signal }) => api.products(filters, query, signal),
    placeholderData: keepPreviousData, // keep the table steady while paging
  });

export const useOperations = (filters: Filters) =>
  useQuery({ queryKey: ["operations", filters], queryFn: ({ signal }) => api.operations(filters, signal) });

export const useInsights = (params: { section?: string; severity?: Severity } = {}) =>
  useQuery({
    queryKey: ["insights", params],
    queryFn: ({ signal }) => api.insights(params, signal),
    staleTime: Infinity,
  });

export const useDataQuality = () =>
  useQuery({ queryKey: ["data-quality"], queryFn: ({ signal }) => api.dataQuality(signal), staleTime: Infinity });
