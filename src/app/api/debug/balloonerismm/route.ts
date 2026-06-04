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
import {
  resolveExternalIdsForTitle,
  resolveTmdbIdFromImdbId,
  isExternalIdsEnabled,
} from "@/server/titles/balloonerismm-external-ids";
import {
  getBalloonerismProviders,
  isProvidersEnabled,
  isProvidersDebugOnly,
} from "@/server/titles/balloonerismm-providers";
import {
  resolvePoplogTitleIdentity,
  type PoplogTitleSourceHint,
} from "@/server/titles/poplog-title-identity";
import { getPoplogTitleDetails } from "@/server/titles/poplog-title-details";
import type { MediaType } from "@prisma/client";

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
  const sourceHint = (url.searchParams.get("sourceHint") ?? "auto") as PoplogTitleSourceHint;

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

    } else if (type === "resolve-title") {
      const media = (url.searchParams.get("media") ?? "movie") as "movie" | "tv";
      if (media !== "movie" && media !== "tv") return errorResponse("media deve ser movie ou tv");
      if (!id) return errorResponse("Param id obrigatorio para type=resolve-title");

      endpoint = `resolve-title(media=${media}, id=${id}, sourceHint=${sourceHint})`;
      const identity = await resolvePoplogTitleIdentity({
        mediaType: media,
        id,
        sourceHint,
      });

      data = {
        source: "poplog-identity",
        resolvedFrom: identity.resolvedFrom,
        poplogId: identity.poplogId ?? null,
        externalIds: identity.externalIds,
        fallbackUsed: false,
        fallbackReason: null,
        rawSource: "local",
        normalizedTitle: identity,
      };

    } else if (type === "title-details") {
      const media = (url.searchParams.get("media") ?? "movie") as "movie" | "tv";
      if (media !== "movie" && media !== "tv") return errorResponse("media deve ser movie ou tv");
      if (!id) return errorResponse("Param id obrigatorio para type=title-details");

      endpoint = `title-details(media=${media}, id=${id}, sourceHint=${sourceHint})`;
      const details = await getPoplogTitleDetails({
        mediaType: media,
        id,
        sourceHint,
      });

      data = {
        source: details?.sourceMeta.primarySource ?? "unknown",
        resolvedFrom: details?.sourceMeta.resolvedFrom ?? "unknown",
        poplogId: details?.poplogId ?? null,
        externalIds: details?.externalIds ?? {},
        fallbackUsed: details?.sourceMeta.fallbackUsed ?? false,
        fallbackReason: details?.sourceMeta.fallbackReason ?? null,
        rawSource: details?.sourceMeta.rawSource ?? null,
        normalizedTitle: details,
      };

    // ── Etapa 3: cross-reference e providers ────────────────────────────────

    } else if (type === "external-ids" || type === "cross-ref") {
      const media = (url.searchParams.get("media") ?? "movie") as MediaType;
      if (!id) return errorResponse("Param id obrigatorio para type=external-ids|cross-ref");

      const isImdbId = id.startsWith("tt");

      if (type === "external-ids") {
        // type=external-ids: resolve via Balloonerismm /external_ids (raw)
        if (!isImdbId) return errorResponse("type=external-ids requer IMDb ID (tt...)");
        const bPath = media === "movie"
          ? `/movie/${id}/external_ids`
          : `/tv/${id}/external_ids`;
        endpoint = bPath;
        data = await balloonerismGet<BalloonerismExternalIds>(bPath, { ttlSeconds: 0 });
      } else {
        // type=cross-ref: resolução completa IMDb ↔ TMDB via DB + Balloonerismm
        let tmdbId: number | null = null;
        if (isImdbId) {
          tmdbId = await resolveTmdbIdFromImdbId(id, media);
          endpoint = `cross-ref(imdbId=${id} → tmdbId=${tmdbId ?? "not_found"})`;
          if (!tmdbId) {
            data = {
              resolved: false,
              reason: "IMDb ID not found in title_external_ids cache. Sync the title via TMDB first.",
              imdbId: id,
              mediaType: media,
              externalIdsEnabled: isExternalIdsEnabled(),
            };
          } else {
            data = await resolveExternalIdsForTitle(tmdbId, media);
          }
        } else {
          const numericId = parseInt(id, 10);
          if (!Number.isFinite(numericId) || numericId <= 0) {
            return errorResponse("id deve ser IMDb ID (tt...) ou TMDB ID numerico positivo");
          }
          tmdbId = numericId;
          endpoint = `cross-ref(tmdbId=${tmdbId})`;
          data = await resolveExternalIdsForTitle(tmdbId, media);
        }
      }

    } else if (type === "providers") {
      const media = (url.searchParams.get("media") ?? "movie") as "movie" | "tv";
      const region = url.searchParams.get("region") ?? undefined;
      if (!id) return errorResponse("Param id obrigatorio para type=providers (IMDb ID)");
      if (!id.startsWith("tt")) return errorResponse("type=providers requer IMDb ID (tt...)");

      endpoint = `providers(imdbId=${id}, media=${media}${region ? `, region=${region}` : ""})`;

      if (!isProvidersEnabled() && !isProvidersDebugOnly()) {
        data = {
          available: false,
          reason: "BALLOONERISMM_PROVIDERS_ENABLED=false e BALLOONERISMM_PROVIDERS_DEBUG_ONLY=false",
        };
      } else {
        const providers = await getBalloonerismProviders(id, media, region);
        data = {
          available: providers !== null,
          count: providers?.length ?? 0,
          providersEnabled: isProvidersEnabled(),
          debugOnly: isProvidersDebugOnly(),
          providers: providers ?? [],
          note: "Providers Balloonerismm não são persistidos em DB (AvailabilitySource enum não inclui balloonerismm).",
        };
      }

    } else {
      return errorResponse(`type desconhecido: ${type}. Valores validos: search, search-movie, search-tv, popular, popular-movie, popular-tv, movie, movie-credits, movie-external-ids, tv, tv-credits, tv-external-ids, person, person-credits, genre-movie, genre-tv, discover-movie, discover-tv, resolve-title, title-details, external-ids, cross-ref, providers`);
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
