"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type GlobalSearchMediaType = "movie" | "tv";

export type GlobalSearchResult = {
  id: number | string;
  tmdb_id?: number | null;
  imdbId?: string | null;
  media_type?: GlobalSearchMediaType;
  title?: string | null;
  name?: string | null;
  original_title?: string | null;
  original_name?: string | null;
  overview?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  popularity?: number | null;
  vote_average?: number | null;
  personalScore?: number | null;
  externalIds?: {
    imdbId?: string | null;
    tmdbId?: number | null;
    traktId?: number | null;
    slug?: string | null;
  } | null;
};

export type GlobalSearchPerson = {
  id: string;
  name: string;
  profile_path?: string | null;
  known_for_department?: string | null;
  known_for?: Array<{ title: string; media_type?: string; year?: number | null; poster_path?: string | null }>;
  href: string;
};

export type GlobalSearchCompany = {
  id?: string | null;
  name: string;
  logo_path?: string | null;
  origin_country?: string | null;
  description?: string | null;
};

export type GlobalSearchResponse = {
  ok: boolean;
  query: string;
  normalizedQuery?: string;
  language: string;
  region: string;
  count: number;
  results: GlobalSearchResult[];
  titles?: GlobalSearchResult[];
  people?: GlobalSearchPerson[];
  companies?: GlobalSearchCompany[];
  error?: string;
};

export type DebouncedGlobalSearchState = {
  query: string;
  debouncedQuery: string;
  results: GlobalSearchResult[];
  people: GlobalSearchPerson[];
  companies: GlobalSearchCompany[];
  status: "idle" | "typing" | "loading" | "success" | "empty" | "error";
  error: string | null;
  isLoading: boolean;
};

export type UseDebouncedGlobalSearchOptions = {
  language: string;
  region: string;
  debounceMs?: number;
  minQueryLength?: number;
  endpoint?: string;
  cacheTtlMs?: number;
  /** When true, also surfaces `people` and `companies` returned by richer endpoints. */
  includeExtras?: boolean;
  /** Extra static query params sent on every request (e.g. `{ type: "all", page: "1" }`). */
  extraParams?: Record<string, string>;
};

type CacheEntry = {
  expiresAt: number;
  response: GlobalSearchResponse;
};

const memoryCache = new Map<string, CacheEntry>();

function normalizeQuery(query: string) {
  return query.trim().replace(/\s+/g, " ");
}

function cacheKey(query: string, language: string, region: string) {
  return `${normalizeQuery(query).toLocaleLowerCase()}::${language}::${region}`;
}

function readCache(key: string) {
  const cached = memoryCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return cached.response;
}

export function useDebouncedGlobalSearch(options: UseDebouncedGlobalSearchOptions) {
  const {
    language,
    region,
    debounceMs = 320,
    minQueryLength = 2,
    endpoint = "/api/search",
    cacheTtlMs = 30_000,
    includeExtras = false,
    extraParams,
  } = options;
  const extraParamsKey = extraParams ? new URLSearchParams(extraParams).toString() : "";
  const [state, setState] = useState<DebouncedGlobalSearchState>({
    query: "",
    debouncedQuery: "",
    results: [],
    people: [],
    companies: [],
    status: "idle",
    error: null,
    isLoading: false,
  });
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const setQuery = useCallback((nextQuery: string) => {
    setState((current) => ({
      ...current,
      query: nextQuery,
      status: normalizeQuery(nextQuery).length ? "typing" : "idle",
      error: null,
    }));
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setState({
      query: "",
      debouncedQuery: "",
      results: [],
      people: [],
      companies: [],
      status: "idle",
      error: null,
      isLoading: false,
    });
  }, []);

  useEffect(() => {
    const normalized = normalizeQuery(state.query);
    const timeout = window.setTimeout(() => {
      setState((current) => ({ ...current, debouncedQuery: normalized }));
    }, debounceMs);
    return () => window.clearTimeout(timeout);
  }, [debounceMs, state.query]);

  useEffect(() => {
    const query = state.debouncedQuery;
    if (!query || query.length < minQueryLength) {
      abortRef.current?.abort();
      setState((current) => ({
        ...current,
        results: [],
        people: [],
        companies: [],
        status: query ? "typing" : "idle",
        error: null,
        isLoading: false,
      }));
      return;
    }

    const resultsOf = (payload: GlobalSearchResponse) => payload.titles ?? payload.results ?? [];
    const peopleOf = (payload: GlobalSearchResponse) => (includeExtras ? payload.people ?? [] : []);
    const companiesOf = (payload: GlobalSearchResponse) =>
      includeExtras ? payload.companies ?? [] : [];

    const key = `${cacheKey(query, language, region)}::${extraParamsKey}`;
    const cached = readCache(key);
    if (cached) {
      const cachedResults = resultsOf(cached);
      setState((current) => ({
        ...current,
        results: cachedResults,
        people: peopleOf(cached),
        companies: companiesOf(cached),
        status: cachedResults.length ? "success" : "empty",
        error: null,
        isLoading: false,
      }));
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setState((current) => ({ ...current, status: "loading", error: null, isLoading: true }));

    const params = new URLSearchParams({ q: query, language, region, ...extraParams });

    fetch(`${endpoint}?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as GlobalSearchResponse;
        if (!response.ok || !payload.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        return payload;
      })
      .then((payload) => {
        if (requestIdRef.current !== requestId) return;
        memoryCache.set(key, { response: payload, expiresAt: Date.now() + cacheTtlMs });
        const nextResults = resultsOf(payload);
        setState((current) => ({
          ...current,
          results: nextResults,
          people: peopleOf(payload),
          companies: companiesOf(payload),
          status: nextResults.length ? "success" : "empty",
          error: null,
          isLoading: false,
        }));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestIdRef.current !== requestId) return;
        setState((current) => ({
          ...current,
          results: [],
          people: [],
          companies: [],
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          isLoading: false,
        }));
      });

    return () => controller.abort();
  }, [
    cacheTtlMs,
    endpoint,
    extraParams,
    extraParamsKey,
    includeExtras,
    language,
    minQueryLength,
    region,
    state.debouncedQuery,
  ]);

  return useMemo(() => ({ ...state, setQuery, clear }), [clear, setQuery, state]);
}
