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
import { getAvailability } from "@/server/cache/availability-cache";
import { resolvePoplogTitleIdentity } from "@/server/titles/poplog-title-identity";
import { getBalloonerismWatchProviders } from "@/server/titles/balloonerismm-providers";
import type { TitleProvider } from "@/features/title/types";

type MediaType = "movie" | "tv";

function normalizeMediaType(value: string | null): MediaType | null {
  return value === "movie" || value === "tv" ? value : null;
}

function groupTitleProviders(providers: TitleProvider[]) {
  const grouped = {
    flatrate: [] as TitleProvider[],
    rent:     [] as TitleProvider[],
    buy:      [] as TitleProvider[],
    ads:      [] as TitleProvider[],
    free:     [] as TitleProvider[],
  };
  for (const p of providers) {
    if (p.type === "streaming") grouped.flatrate.push(p);
    else if (p.type === "rent")  grouped.rent.push(p);
    else if (p.type === "buy")   grouped.buy.push(p);
    else if (p.type === "ads")   grouped.ads.push(p);
    else if (p.type === "free")  grouped.free.push(p);
  }
  return grouped;
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

  let providers: TitleProvider[] = [];
  let providerSource = "not_configured";

  // ── Fonte primária: Balloonerismm ──────────────────────────────────────────
  if (imdbId) {
    try {
      providers = await getBalloonerismWatchProviders(imdbId, mediaType, region);
      if (providers.length > 0) providerSource = "balloonerismm";
    } catch {
      providers = [];
    }
  }

  // ── Fallback: cache local ──────────────────────────────────────────────────
  if (providers.length === 0) {
    try {
      if (tmdbId) {
        const rows = await getAvailability(mediaType, tmdbId, region).catch(() => []);
        if (rows.length > 0) {
          providers = rows.map((row) => ({
            name: row.provider_name,
            logoUrl: null,
            type: (row.availability_type === "streaming" ? "streaming" : row.availability_type) as TitleProvider["type"],
            source: row.source,
            country: row.country,
            deepLink: row.deep_link,
            quality: row.quality,
          }));
          providerSource = rows[0]?.source ?? "local";
        }
      } else if (imdbId) {
        const local = await import("@/server/local-services/catalog-availability-local.service");
        const localRows = await local.listAvailability({
          imdbId,
          mediaType,
          providerRegion: region,
        });
        if (localRows.length > 0) {
          providers = localRows.map((r) => ({
            name: r.provider_name,
            logoUrl: r.provider_logo_url ?? null,
            type: (r.provider_type === "subscription" ? "streaming" : r.provider_type) as TitleProvider["type"],
            source: r.source,
            country: r.provider_region,
          }));
          providerSource = localRows[0]?.source ?? "local";
        }
      }
    } catch {
      // ignora — retorna vazio abaixo
    }
  }

  const grouped = groupTitleProviders(providers);
  const hasData = providers.length > 0;

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
