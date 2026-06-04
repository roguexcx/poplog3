/**
 * /api/poplog3/providers — disponibilidade regional (onde assistir).
 *
 * Fonte: Balloonerismm / Watchmode / local (catalog_availability).
 * Zero chamadas TMDB watch/providers.
 *
 * Quando não há dados confirmados, retorna sinal de indisponibilidade
 * controlado — a UI exibe "Disponibilidade ainda não confirmada" em vez
 * de erro ou dado vazio genérico.
 *
 * Parâmetros:
 *   ?id=<imdb_id|trakt_id>  — identificador do título
 *   ?region=BR              — região (padrão: BR)
 *   ?media_type=movie|tv    — tipo de mídia
 */

import { NextRequest, NextResponse } from "next/server";
import { AVAILABILITY_UNAVAILABLE } from "@/server/source-engine/normalizers/normalize-availability";
import { getAvailability } from "@/server/cache/availability-cache";
import { resolvePoplogTitleIdentity } from "@/server/titles/poplog-title-identity";

type MediaType = "movie" | "tv";

function normalizeMediaType(value: string | null): MediaType | null {
  return value === "movie" || value === "tv" ? value : null;
}

function groupProviders(rows: Awaited<ReturnType<typeof getAvailability>>) {
  const providers = {
    flatrate: [] as typeof rows,
    rent: [] as typeof rows,
    buy: [] as typeof rows,
    ads: [] as typeof rows,
    free: [] as typeof rows,
  };

  for (const row of rows) {
    if (row.availability_type === "streaming") providers.flatrate.push(row);
    else if (row.availability_type === "rent") providers.rent.push(row);
    else if (row.availability_type === "buy") providers.buy.push(row);
    else if (row.availability_type === "ads") providers.ads.push(row);
    else if (row.availability_type === "free") providers.free.push(row);
  }

  return providers;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  const region = (searchParams.get("region") ?? "BR").toUpperCase();
  const mediaType = normalizeMediaType(searchParams.get("media_type"));
  const debugSource = searchParams.get("debugSource") === "1";

  if (!id || !mediaType) {
    return NextResponse.json(
      { ok: false, error: "Missing required params: id and media_type=movie|tv" },
      { status: 400 },
    );
  }

  const identity = await resolvePoplogTitleIdentity({ mediaType, id });
  const sourceIdUsed = identity.externalIds.tmdbId
    ? identity.externalIds.tmdbId
    : identity.externalIds.imdbId ??
      identity.externalIds.traktId ??
      identity.externalIds.balloonerismmId ??
      identity.externalIds.slug ??
      id;
  const sourceIdType = identity.externalIds.tmdbId
    ? "tmdb_id_alias"
    : identity.externalIds.imdbId
      ? "imdb_id"
      : identity.externalIds.traktId
        ? "trakt_id"
        : identity.externalIds.balloonerismmId
          ? "balloonerismm_id"
          : identity.externalIds.slug
            ? "slug"
            : "input";

  const rows = identity.externalIds.tmdbId
    ? await getAvailability(mediaType, identity.externalIds.tmdbId, region).catch(() => [])
    : [];
  const grouped = groupProviders(rows);
  const cacheStatus = rows.length > 0 ? "local_hit" : "local_miss";

  return NextResponse.json({
    ok: true,
    poplogId: identity.poplogId ?? null,
    externalIds: identity.externalIds,
    id,
    region,
    media_type: mediaType,
    dataSource: rows.length > 0 ? "local_cache" : "source_engine_unavailable",
    ...AVAILABILITY_UNAVAILABLE,
    providers: grouped,
    providerSource: rows.length > 0 ? rows[0]?.source ?? "local" : "not_configured",
    usedTmdbApi: false,
    sourceIdUsed,
    sourceIdType,
    message: rows.length > 0
      ? "Provider data loaded from local cache."
      : "Provider data not yet available for this title without external refresh.",
    ...(debugSource
      ? {
          debugSource: {
            providerLookupAttempted: true,
            providerSource: rows.length > 0 ? rows[0]?.source ?? "local" : "not_configured",
            providerSourceIdType: sourceIdType,
            providerSourceIdUsed: sourceIdUsed,
            poplogId: identity.poplogId ?? null,
            externalIds: identity.externalIds,
            usedTmdbApi: false,
            fallbackUsed: rows.length === 0,
            fallbackReason: rows.length === 0 ? "no_local_or_configured_provider_source" : null,
            cacheStatus,
          },
        }
      : {}),
  });
}
