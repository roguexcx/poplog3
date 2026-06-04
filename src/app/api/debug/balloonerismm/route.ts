import { NextResponse } from "next/server";
import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";
import { balloonerismGet, isBalloonerismActive, BALLOONERISMM_BASE_URL } from "@/server/api-clients/balloonerismm/client";
import { jsonHeaders } from "../_shared";
import type {
  BalloonerismMovie,
  BalloonerismShow,
  BalloonerismSearchResult,
  BalloonerismPopularItem,
  BalloonerismPersonDetails,
  BalloonerismPersonCombinedCredits,
  BalloonerismCreditsResponse,
  BalloonerismExternalIds,
  BalloonerismGenreList,
} from "@/server/api-clients/balloonerismm/types";

type DebugResult = {
  ok: boolean;
  active: boolean;
  baseUrl: string;
  type: string;
  endpoint: string;
  elapsedMs: number;
  raw: unknown;
  error?: string;
};

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAdminRequest(request)) return adminUnauthorizedResponse();

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "search";
  const q = url.searchParams.get("q") ?? "matrix";
  const id = url.searchParams.get("id") ?? "";
  const raw = url.searchParams.get("raw") === "1";

  const active = isBalloonerismActive();
  const baseUrl = BALLOONERISMM_BASE_URL;

  const t0 = Date.now();
  let endpoint = "";
  let data: unknown = null;
  let error: string | undefined;

  try {
    if (type === "search") {
      endpoint = `/search/multi?query=${encodeURIComponent(q)}`;
      data = await balloonerismGet<BalloonerismSearchResult[]>("/search/multi", {
        params: { query: q },
        ttlSeconds: 0,
      });
    } else if (type === "search-movie") {
      endpoint = `/search/movie?query=${encodeURIComponent(q)}`;
      data = await balloonerismGet<BalloonerismSearchResult[]>("/search/movie", {
        params: { query: q },
        ttlSeconds: 0,
      });
    } else if (type === "search-tv") {
      endpoint = `/search/tv?query=${encodeURIComponent(q)}`;
      data = await balloonerismGet<BalloonerismSearchResult[]>("/search/tv", {
        params: { query: q },
        ttlSeconds: 0,
      });
    } else if (type === "popular") {
      endpoint = "/popular/all";
      data = await balloonerismGet<BalloonerismPopularItem[]>("/popular/all", { ttlSeconds: 0 });
    } else if (type === "popular-movie") {
      endpoint = "/popular/movie";
      data = await balloonerismGet<BalloonerismPopularItem[]>("/popular/movie", { ttlSeconds: 0 });
    } else if (type === "popular-tv") {
      endpoint = "/popular/tv";
      data = await balloonerismGet<BalloonerismPopularItem[]>("/popular/tv", { ttlSeconds: 0 });
    } else if (type === "movie") {
      if (!id) return errorResponse("Param id obrigatorio para type=movie");
      endpoint = `/movie/${id}`;
      data = await balloonerismGet<BalloonerismMovie>(`/movie/${id}`, { ttlSeconds: 0 });
    } else if (type === "movie-credits") {
      if (!id) return errorResponse("Param id obrigatorio para type=movie-credits");
      endpoint = `/movie/${id}/credits`;
      data = await balloonerismGet<BalloonerismCreditsResponse>(`/movie/${id}/credits`, { ttlSeconds: 0 });
    } else if (type === "movie-external-ids") {
      if (!id) return errorResponse("Param id obrigatorio para type=movie-external-ids");
      endpoint = `/movie/${id}/external_ids`;
      data = await balloonerismGet<BalloonerismExternalIds>(`/movie/${id}/external_ids`, { ttlSeconds: 0 });
    } else if (type === "tv") {
      if (!id) return errorResponse("Param id obrigatorio para type=tv");
      endpoint = `/tv/${id}`;
      data = await balloonerismGet<BalloonerismShow>(`/tv/${id}`, { ttlSeconds: 0 });
    } else if (type === "tv-credits") {
      if (!id) return errorResponse("Param id obrigatorio para type=tv-credits");
      endpoint = `/tv/${id}/credits`;
      data = await balloonerismGet<BalloonerismCreditsResponse>(`/tv/${id}/credits`, { ttlSeconds: 0 });
    } else if (type === "tv-external-ids") {
      if (!id) return errorResponse("Param id obrigatorio para type=tv-external-ids");
      endpoint = `/tv/${id}/external_ids`;
      data = await balloonerismGet<BalloonerismExternalIds>(`/tv/${id}/external_ids`, { ttlSeconds: 0 });
    } else if (type === "person") {
      if (!id) return errorResponse("Param id obrigatorio para type=person");
      endpoint = `/person/${id}`;
      data = await balloonerismGet<BalloonerismPersonDetails>(`/person/${id}`, { ttlSeconds: 0 });
    } else if (type === "person-credits") {
      if (!id) return errorResponse("Param id obrigatorio para type=person-credits");
      endpoint = `/person/${id}/combined_credits`;
      data = await balloonerismGet<BalloonerismPersonCombinedCredits>(`/person/${id}/combined_credits`, { ttlSeconds: 0 });
    } else if (type === "genre-movie") {
      endpoint = "/genre/movie/list";
      data = await balloonerismGet<BalloonerismGenreList>("/genre/movie/list", { ttlSeconds: 0 });
    } else if (type === "genre-tv") {
      endpoint = "/genre/tv/list";
      data = await balloonerismGet<BalloonerismGenreList>("/genre/tv/list", { ttlSeconds: 0 });
    } else if (type === "discover-movie") {
      endpoint = "/discover/movie";
      data = await balloonerismGet<BalloonerismSearchResult[]>("/discover/movie", { ttlSeconds: 0 });
    } else if (type === "discover-tv") {
      endpoint = "/discover/tv";
      data = await balloonerismGet<BalloonerismSearchResult[]>("/discover/tv", { ttlSeconds: 0 });
    } else {
      return errorResponse(`type desconhecido: ${type}. Valores validos: search, search-movie, search-tv, popular, popular-movie, popular-tv, movie, movie-credits, movie-external-ids, tv, tv-credits, tv-external-ids, person, person-credits, genre-movie, genre-tv, discover-movie, discover-tv`);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const result: DebugResult = {
    ok: data !== null && !error,
    active,
    baseUrl,
    type,
    endpoint,
    elapsedMs: Date.now() - t0,
    raw: raw ? data : summarize(data),
    ...(error ? { error } : {}),
  };

  return NextResponse.json(result, { headers: jsonHeaders() });
}

function errorResponse(msg: string) {
  return NextResponse.json({ ok: false, error: msg }, { status: 400, headers: jsonHeaders() });
}

function summarize(data: unknown): unknown {
  if (data === null || data === undefined) return null;
  if (Array.isArray(data)) {
    return { count: data.length, first: data[0] ?? null };
  }
  return data;
}
