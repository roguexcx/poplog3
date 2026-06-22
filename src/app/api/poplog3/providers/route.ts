/**
 * /api/poplog3/providers — disponibilidade regional (onde assistir).
 *
 * Fonte primária: Balloonerismm /watch/providers (ao vivo, BR por padrão).
 * Fallback: cache local (TMDB/Watchmode/MOTN já sincronizados).
 *
 * Parâmetros:
 *   ?id=<imdb_id|trakt_id>  — identificador do título
 *   ?region=BR              — região (padrão: BR)
 *   ?media_type=movie|tv    — tipo de mídia
 */

import { NextRequest, NextResponse } from "next/server";
import { AVAILABILITY_UNAVAILABLE } from "@/server/source-engine/normalizers/normalize-availability";
import { resolvePoplogTitleIdentity } from "@/server/titles/poplog-title-identity";
import { getTitleAvailabilityWithDebug } from "@/server/availability";

type MediaType = "movie" | "tv";

function normalizeMediaType(value: string | null): MediaType | null {
  return value === "movie" || value === "tv" ? value : null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  const region = (searchParams.get("region") ?? "BR").toUpperCase();
  const mediaType = normalizeMediaType(searchParams.get("media_type"));
  const debugSource = searchParams.get("debugSource") === "1";
  const debug = searchParams.get("debug") === "1";
  // Opção SÓ-dev: ignora a sentinela negativa do cache e força Balloonerismm + fallback
  // JustWatch. Em produção é ignorada (segurança). Útil para depurar disponibilidade live.
  const forceLive =
    process.env.NODE_ENV !== "production" &&
    (searchParams.get("force_live") === "1" || searchParams.get("bypass_negative_cache") === "1");

  if (!id || !mediaType) {
    return NextResponse.json(
      { ok: false, error: "Missing required params: id and media_type=movie|tv" },
      { status: 400 },
    );
  }

  const identity = await resolvePoplogTitleIdentity({ mediaType, id });
  const imdbId = identity.externalIds.imdbId;
  const tmdbId = identity.externalIds.tmdbId;

  const sourceIdUsed = tmdbId ?? imdbId
    ?? identity.externalIds.traktId
    ?? identity.externalIds.balloonerismmId
    ?? identity.externalIds.slug ?? id;
  const sourceIdType = tmdbId ? "tmdb_id_alias"
    : imdbId        ? "imdb_id"
    : identity.externalIds.traktId ? "trakt_id"
    : identity.externalIds.balloonerismmId ? "balloonerismm_id"
    : identity.externalIds.slug ? "slug" : "input";

  // Camada global de disponibilidade — mesma usada por Biblioteca/Home/Title page.
  const { summary: availability, debug: availabilityDebug } = await getTitleAvailabilityWithDebug({
    mediaType,
    imdbId: imdbId ?? null,
    tmdbId: tmdbId ?? null,
    traktId: identity.externalIds.traktId ?? null,
    region,
    // Título/ano para o fallback experimental JustWatch (busca por título).
    title: identity.title ?? null,
    year: identity.year ?? null,
    // force_live/bypass_negative_cache (só-dev): ignora sentinela __none__ fresca.
    bypassNegativeCache: forceLive,
  });

  const grouped = availability.providers;
  const providerSource = availability.source;
  const hasData = availability.status.isAvailableSomewhere;

  // Modo debug: trace completo da resolução (IMDb→endpoint, cache, outcome, contagens).
  if (debug) {
    return NextResponse.json({
      ok: true,
      input: { id, mediaType, region },
      resolved: {
        ...availabilityDebug.resolved,
        identityImdbId: imdbId ?? null,
        identityTmdbId: tmdbId ?? null,
        traktId: identity.externalIds.traktId ?? null,
        balloonerismmId: identity.externalIds.balloonerismmId ?? null,
        poplogId: identity.poplogId ?? null,
      },
      cache: availabilityDebug.cache,
      forceLive,
      providerRequest: availabilityDebug.providerRequest,
      result: availabilityDebug.result,
      // Trace claro do fallback experimental JustWatch (enabled/attempted/outcome/match/etc.).
      justwatch: availabilityDebug.justwatch,
      providerSource,
      state: availability.state,
      status: availability.status,
      errors: availabilityDebug.errors,
    });
  }

  return NextResponse.json({
    ok: true,
    poplogId: identity.poplogId ?? null,
    externalIds: identity.externalIds,
    id,
    region,
    media_type: mediaType,
    dataSource: hasData ? "balloonerismm" : "source_engine_unavailable",
    ...(hasData ? { available: true } : AVAILABILITY_UNAVAILABLE),
    providers: grouped,
    status: availability.status,
    state: availability.state,
    providerSource,
    usedTmdbApi: false,
    sourceIdUsed,
    sourceIdType,
    message: hasData
      ? "Provider data loaded from Balloonerismm."
      : "Provider data not yet available for this title.",
    ...(debugSource
      ? {
          debugSource: {
            providerLookupAttempted: true,
            providerSource,
            providerSourceIdType: sourceIdType,
            providerSourceIdUsed: sourceIdUsed,
            poplogId: identity.poplogId ?? null,
            externalIds: identity.externalIds,
            usedTmdbApi: false,
            fallbackUsed: providerSource !== "balloonerismm",
            imdbIdUsed: imdbId ?? null,
          },
        }
      : {}),
  });
}
