import { buildTmdbRawUrl } from "@/lib/images/url";
import { translateGenreName } from "@/lib/domain-labels";
import { resolveDisplayTitle } from "@/lib/titles/display-title";
import {
  catalogGetMovie,
  catalogGetPeople,
  catalogGetShow,
  catalogGetVideos,
} from "@/server/source-engine/engine";
import { traktAdapter } from "@/server/source-engine/adapters/trakt-adapter";
import { traktGet } from "@/server/api-clients/trakt/client";
import type { TraktTranslation } from "@/server/api-clients/trakt/types";
import type { CatalogPeople, CatalogTitle, CatalogVideo } from "@/server/source-engine/types/catalog.types";
import { db } from "@/server/db/client";
import {
  canonicalInputFromCatalogTitle,
  upsertCanonicalTitle,
} from "@/server/source-engine/canonical-store";
import {
  resolvePoplogTitleIdentity,
  type PoplogTitleExternalIds,
  type PoplogTitleIdentity,
  type PoplogTitleSourceHint,
} from "./poplog-title-identity";
import type { PoplogTitleAliasResolution } from "./poplog-title-aliases";

type MediaType = "movie" | "tv";

export type PoplogTitleDetailsSource = "trakt" | "local" | "legacy";

export type PoplogTitleDetailsResult = {
  /**
   * May be null/undefined for titles resolved from external aliases before a
   * controlled POPLOG_ID persistence step links them to the internal catalog.
   */
  poplogId?: string | number;
  mediaType: MediaType;
  title: string;
  originalTitle?: string | null;
  overview?: string | null;
  year?: number | null;
  releaseDate?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  genres?: string[];
  runtime?: number | null;
  voteAverage?: number | null;
  voteCount?: number | null;
  externalIds: PoplogTitleExternalIds;
  numberOfSeasons?: number | null;
  numberOfEpisodes?: number | null;
  status?: string | null;
  tagline?: string | null;
  lastAirDate?: string | null;
  cast?: Array<{
    id: string | number;
    name: string;
    character?: string | null;
    photoUrl?: string | null;
  }>;
  crew?: Array<{
    id: string | number;
    name: string;
    job: string;
    department?: string | null;
    photoUrl?: string | null;
  }>;
  videos?: Array<{
    id: string | number;
    title: string;
    url: string;
    type: string;
    thumbnailUrl?: string | null;
  }>;
  /** Orçamento em USD. */
  budget?: number | null;
  /** Bilheteria total mundial em USD. */
  revenue?: number | null;
  /** Bilheteria doméstica (EUA) em USD. */
  domesticGross?: number | null;
  /** Pontuação Metacritic (0–100). */
  metacriticScore?: number | null;
  productionCompanies?: Array<{ name: string }>;
  productionCountries?: Array<{ code: string; name: string }>;
  spokenLanguages?: Array<{ code: string; name: string }>;
  inProduction?: boolean | null;
  seriesType?: string | null;
  sourceMeta: {
    primarySource: PoplogTitleDetailsSource;
    fallbackUsed?: boolean;
    fallbackReason?: string;
    confidence?: number;
    resolvedFrom?: PoplogTitleIdentity["resolvedFrom"];
    rawSource?: PoplogTitleDetailsSource;
    aliasResolution?: PoplogTitleAliasResolution;
  };
};

export type PoplogTitleDetailsDebugSource = {
  source: PoplogTitleDetailsSource | "legacy_tmdb_fallback" | "unknown";
  resolvedFrom?: PoplogTitleIdentity["resolvedFrom"];
  poplogId: string | number | null;
  externalIds: PoplogTitleExternalIds;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  rawSource: PoplogTitleDetailsSource | "unknown";
  usedLegacy: boolean;
  usedTmdbApi: boolean;
  usedBalloonerismm: boolean;
  aliasLookupAttempted?: boolean;
  aliasLookupSource?: string[];
  aliasLookupFound?: boolean;
  externalIdsBefore?: PoplogTitleExternalIds;
  externalIdsAfter?: PoplogTitleExternalIds;
  aliasPersisted?: boolean;
  aliasPersistReason?: string | null;
};

type LoaderInput = {
  mediaType: MediaType;
  id: string;
  sourceHint?: PoplogTitleSourceHint;
};

type LocalTitleRow = {
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string | null;
  originalTitle: string | null;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: Date | null;
  firstAirDate: Date | null;
  lastAirDate: Date | null;
  year: number | null;
  runtime: number | null;
  episodeRunTime: unknown;
  genres: unknown;
  voteAverage: unknown;
  voteCount: number | null;
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
};

function dateString(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function imageUrl(path: string | null | undefined, size: string): string | null {
  return buildTmdbRawUrl(size, path);
}

function mergeExternalIds(
  identity: PoplogTitleIdentity,
  local?: LocalTitleRow | null,
): PoplogTitleExternalIds {
  return {
    ...identity.externalIds,
    tmdbId: identity.externalIds.tmdbId ?? local?.tmdbId,
  };
}

function localGenres(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((genre) => {
      if (typeof genre === "string") return genre;
      if (genre && typeof genre === "object" && "name" in genre) {
        const name = (genre as { name?: unknown }).name;
        return typeof name === "string" ? name : null;
      }
      return null;
    })
    .filter((genre): genre is string => Boolean(genre))
    .map((genre) => translateGenreName(genre) ?? genre);
}

function compactExternalIds(ids: PoplogTitleExternalIds): PoplogTitleExternalIds {
  return Object.fromEntries(
    Object.entries(ids).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  ) as PoplogTitleExternalIds;
}

function remoteGenres(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((genre) => {
      if (typeof genre === "string") return genre;
      if (genre && typeof genre === "object" && "name" in genre) {
        const name = (genre as { name?: unknown }).name;
        return typeof name === "string" ? name : null;
      }
      return null;
    })
    .filter((genre): genre is string => Boolean(genre))
    .map((genre) => translateGenreName(genre) ?? genre);
}

/**
 * Returns true when the text contains strong Portuguese-language signals.
 * Used to prefer a localized local-DB title over a remote English title.
 *
 * Deliberately conservative: only chars/words that are very unlikely to appear
 * in English-language titles (ã, õ, â, ê, ô, ç, or common Portuguese preps).
 */
function looksLikeLocalizedTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  if (/[ãõâêôç]/i.test(title)) return true;
  const t = ` ${title.toLowerCase()} `;
  return [" de ", " da ", " do ", " dos ", " das ", " em ", " uma ", " para "].some((s) => t.includes(s));
}


type TraktPtBrTranslation = {
  title: string | null;
  overview: string | null;
  tagline: string | null;
};

/**
 * Fetches Brazilian Portuguese title, overview and tagline from Trakt translations.
 * Returns null when Trakt is inactive or no translation exists.
 */
async function fetchTraktPtBrTranslation(imdbId: string, mediaType: MediaType): Promise<TraktPtBrTranslation | null> {
  const path = mediaType === "movie"
    ? `/movies/${imdbId}/translations/pt`
    : `/shows/${imdbId}/translations/pt`;

  const translations = await traktGet<TraktTranslation[]>(path, { ttlSeconds: 86400 }).catch(() => null);
  if (!translations || !Array.isArray(translations)) return null;

  // Prefer country=br (Brazilian Portuguese) over generic Portuguese
  const ptBr = translations.find((t) => t.language === "pt" && t.country === "br");
  const pt = translations.find((t) => t.language === "pt");
  const best = ptBr ?? pt;
  if (!best) return null;

  return {
    title: best.title?.trim() || null,
    overview: best.overview?.trim() || null,
    tagline: best.tagline?.trim() || null,
  };
}

function localToDetails(
  identity: PoplogTitleIdentity,
  row: LocalTitleRow,
): PoplogTitleDetailsResult {
  const releaseDate = row.mediaType === "movie"
    ? dateString(row.releaseDate)
    : dateString(row.firstAirDate);

  return {
    poplogId: row.id,
    mediaType: row.mediaType,
    title: resolveDisplayTitle({
      title: row.title,
      originalTitle: row.originalTitle,
      tmdbId: row.tmdbId,
      poplogId: row.id,
      mediaType: row.mediaType,
    }),
    originalTitle: row.originalTitle,
    overview: row.overview,
    year: row.year,
    releaseDate,
    lastAirDate: row.mediaType === "tv" ? dateString(row.lastAirDate) : null,
    numberOfSeasons: row.numberOfSeasons ?? null,
    numberOfEpisodes: row.numberOfEpisodes ?? null,
    posterUrl: imageUrl(row.posterPath, "w500"),
    backdropUrl: imageUrl(row.backdropPath, "w1280"),
    genres: localGenres(row.genres),
    runtime: row.mediaType === "movie"
      ? row.runtime
      : Array.isArray(row.episodeRunTime)
        ? Number(row.episodeRunTime[0] ?? 0) || null
        : null,
    voteAverage: row.voteAverage != null ? Number(row.voteAverage) : null,
    voteCount: row.voteCount,
    externalIds: mergeExternalIds(identity, row),
    sourceMeta: {
      primarySource: "local",
      confidence: identity.confidence,
      resolvedFrom: identity.resolvedFrom,
      rawSource: "local",
      aliasResolution: identity.aliasResolution,
    },
  };
}

function catalogTitleToDetails(
  identity: PoplogTitleIdentity,
  title: CatalogTitle,
  people?: CatalogPeople | null,
  videos?: CatalogVideo[],
  source: Exclude<PoplogTitleDetailsSource, "local" | "legacy"> = "trakt",
): PoplogTitleDetailsResult {
  return {
    poplogId: identity.poplogId,
    mediaType: title.mediaType === "show" ? "tv" : "movie",
    title: title.title || identity.title || "Sem titulo",
    originalTitle: title.originalTitle ?? undefined,
    overview: title.overview || null,
    year: title.year ?? null,
    releaseDate: title.year ? `${title.year}-01-01` : null,
    posterUrl: imageUrl(title.posterPath, "w500"),
    backdropUrl: imageUrl(title.backdropPath, "w1280"),
    genres: remoteGenres(title.genres),
    runtime: title.runtime ?? null,
    status: title.status ?? null,
    voteAverage: title.rating ?? null,
    voteCount: title.votes ?? null,
    numberOfSeasons: title.numberOfSeasons ?? null,
    numberOfEpisodes: title.numberOfEpisodes ?? null,
    externalIds: compactExternalIds({
      ...identity.externalIds,
      tmdbId: title.ids.tmdbId ?? identity.externalIds.tmdbId,
      imdbId: title.ids.imdbId ?? identity.externalIds.imdbId,
      tvdbId: title.ids.tvdbId ?? identity.externalIds.tvdbId,
      traktId: title.ids.traktId ?? identity.externalIds.traktId,
      slug: identity.externalIds.slug,
    }),
    cast: (people?.cast ?? []).map((person) => ({
      id: person.ids.imdbId ?? person.name,
      name: person.name,
      character: person.character ?? null,
      photoUrl: imageUrl(person.profileRemoteUrl, "w185"),
    })),
    crew: (people?.crew ?? []).map((person) => ({
      id: person.ids.imdbId ?? person.name,
      name: person.name,
      job: person.job ?? "Crew",
      department: person.department ?? null,
      photoUrl: imageUrl(person.profileRemoteUrl, "w185"),
    })),
    videos: (videos ?? []).map((video) => ({
      id: video.id,
      title: video.title,
      url: video.url,
      type: video.type,
      thumbnailUrl: video.thumbnailUrl ?? null,
    })),
    budget: title.budget ?? null,
    revenue: title.revenue ?? null,
    domesticGross: title.domesticGross ?? null,
    metacriticScore: title.metacriticScore ?? null,
    productionCompanies: title.productionCompanies,
    productionCountries: title.productionCountries,
    spokenLanguages: title.spokenLanguages,
    inProduction: title.inProduction ?? null,
    seriesType: title.seriesType ?? null,
    sourceMeta: {
      primarySource: source,
      confidence: identity.confidence,
      resolvedFrom: identity.resolvedFrom,
      rawSource: source,
      aliasResolution: identity.aliasResolution,
    },
  };
}

function localizeTitleDetails(details: PoplogTitleDetailsResult): PoplogTitleDetailsResult {
  // Titles, overviews and taglines are NEVER machine-translated.
  // PT-BR content must come from Trakt translations.
  // Genre labels use a static PT-BR mapping (not machine translation).
  return {
    ...details,
    genres: (details.genres ?? []).map((genre) => translateGenreName(genre) ?? genre),
  };
}

type RemoteTitleCandidate = {
  title: CatalogTitle;
  source: Exclude<PoplogTitleDetailsSource, "local" | "legacy">;
};

async function resolveMovieTitleCandidate(params: { imdbId: string }): Promise<RemoteTitleCandidate | null> {
  const trakt = await catalogGetMovie(params).catch(() => null);
  return trakt ? { title: trakt, source: "trakt" } : null;
}

async function resolveShowTitleCandidate(params: { imdbId: string; tvdbId?: number }): Promise<RemoteTitleCandidate | null> {
  const trakt = await catalogGetShow(params).catch(() => null);
  return trakt ? { title: trakt, source: "trakt" } : null;
}

async function findLocalTitle(identity: PoplogTitleIdentity): Promise<LocalTitleRow | null> {
  if (identity.poplogId) {
    const row = await db.poplog3Title.findFirst({
      where: { id: String(identity.poplogId), mediaType: identity.mediaType },
    }).catch(() => null);
    if (row) return row as LocalTitleRow;
  }

  const or = [
    identity.externalIds.tmdbId ? { tmdbId: identity.externalIds.tmdbId, mediaType: identity.mediaType } : null,
    identity.externalIds.imdbId ? { imdbId: identity.externalIds.imdbId, mediaType: identity.mediaType } : null,
    identity.externalIds.traktId ? { traktId: BigInt(String(identity.externalIds.traktId)), mediaType: identity.mediaType } : null,
    identity.externalIds.slug ? { slug: identity.externalIds.slug, mediaType: identity.mediaType } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (!or.length) return null;
  return db.poplog3Title.findFirst({ where: { OR: or } }).catch(() => null) as Promise<LocalTitleRow | null>;
}

function detailLookupId(identity: PoplogTitleIdentity): string | null {
  return identity.externalIds.imdbId ?? identity.externalIds.slug ?? (identity.externalIds.traktId ? String(identity.externalIds.traktId) : null);
}

export function getPoplogTitleDetailsDebugSource(
  details: PoplogTitleDetailsResult | null,
  options: {
    usedLegacy?: boolean;
    usedTmdbApi?: boolean;
    fallbackReason?: string | null;
  } = {},
): PoplogTitleDetailsDebugSource {
  const primarySource = details?.sourceMeta.primarySource ?? "unknown";
  const aliasResolution = details?.sourceMeta.aliasResolution;
  const usedLegacy = options.usedLegacy ?? primarySource === "legacy";
  const usedTmdbApi = options.usedTmdbApi ?? false;
  const source = usedTmdbApi
    ? "legacy_tmdb_fallback"
    : primarySource;

  return {
    source,
    resolvedFrom: details?.sourceMeta.resolvedFrom,
    poplogId: details?.poplogId ?? null,
    externalIds: details?.externalIds ?? {},
    fallbackUsed: Boolean(
      options.usedLegacy ||
        options.usedTmdbApi ||
        details?.sourceMeta.fallbackUsed,
    ),
    fallbackReason:
      options.fallbackReason ??
      details?.sourceMeta.fallbackReason ??
      (usedTmdbApi ? "legacy_tmdb_fallback" : null),
    rawSource: details?.sourceMeta.rawSource ?? primarySource,
    usedLegacy,
    usedTmdbApi,
    usedBalloonerismm: false,
    aliasLookupAttempted: aliasResolution?.aliasLookupAttempted,
    aliasLookupSource: aliasResolution?.aliasLookupSource,
    aliasLookupFound: aliasResolution?.aliasLookupFound,
    externalIdsBefore: aliasResolution?.externalIdsBefore,
    externalIdsAfter: aliasResolution?.externalIdsAfter,
    aliasPersisted: aliasResolution?.aliasPersisted,
    aliasPersistReason: aliasResolution?.aliasPersistReason,
  };
}

/**
 * Tenta obter numberOfSeasons de Trakt quando DB local retorna null.
 * Usado para séries com múltiplas temporadas onde a contagem é crítica para gerar os season stubs.
 */
async function resolveNumberOfSeasons(
  imdbId: string | undefined,
  _tvdbId: number | undefined,
): Promise<number | null> {
  // Trakt: /shows/{imdbId}/seasons retorna array de seasons, contamos os number > 0
  if (imdbId) {
    const seasons = await traktAdapter.getSeasons({ imdbId }).catch(() => []);
    const count = seasons.filter((s) => s.number > 0).length;
    if (count > 0) return count;
  }
  return null;
}

function hasSeriesEvidence(title: CatalogTitle | null): boolean {
  const seriesType =
    typeof title?.seriesType === "string"
      ? title.seriesType.trim().toLowerCase()
      : "";

  return Boolean(
    title &&
      title.mediaType === "show" &&
      (
        (typeof title.numberOfSeasons === "number" && title.numberOfSeasons > 0) ||
        (typeof title.numberOfEpisodes === "number" && title.numberOfEpisodes > 0) ||
        (
          seriesType.length > 0 &&
          !/\b(movie|film|feature)\b/.test(seriesType) &&
          /\b(tv\s*)?(series|miniseries|mini-series|show)\b/.test(seriesType)
        )
      ),
  );
}

function logMediaCorrection(input: {
  requested: MediaType;
  resolved: MediaType;
  id: string;
  reason: string;
  showTitle?: CatalogTitle | null;
}) {
  if (input.requested === input.resolved) return;
  console.log(
    `[SERIES-DIAG] title media corrected | requested=${input.requested} resolved=${input.resolved} id=${input.id} reason=${input.reason} seasons=${input.showTitle?.numberOfSeasons ?? "?"} episodes=${input.showTitle?.numberOfEpisodes ?? "?"}`,
  );
}

export async function getPoplogTitleDetails({
  mediaType,
  id,
  sourceHint = "auto",
}: LoaderInput): Promise<PoplogTitleDetailsResult | null> {
  const identity = await resolvePoplogTitleIdentity({ mediaType, id, sourceHint });
  const local = await findLocalTitle(identity);
  const lookupId = detailLookupId(identity);

  if (lookupId) {
    let remoteTitle: CatalogTitle | null = null;
    let remoteSource: Exclude<PoplogTitleDetailsSource, "local" | "legacy"> = "trakt";
    let effectiveMediaType: MediaType = mediaType;

    if (lookupId.startsWith("tt")) {
      // Resolução bidirecional: consulta os endpoints de filme E série em paralelo
      // e corrige a mídia conforme a evidência. Antes só filmes faziam isso, então
      // uma série cujo IMDb o Trakt só conhece como filme (ou vice-versa) caía em
      // "legacy" e a PÁGINA NÃO CARREGAVA. Agência simétrica para ambos os tipos.
      const [movieCandidate, showCandidate] = await Promise.all([
        resolveMovieTitleCandidate({ imdbId: lookupId }),
        resolveShowTitleCandidate({ imdbId: lookupId, tvdbId: identity.externalIds.tvdbId }),
      ]);
      const movieTitle = movieCandidate?.title ?? null;
      const showTitle = showCandidate?.title ?? null;

      if (mediaType === "tv") {
        // Solicitado série: prefere o show; cai para o filme só se não houver show.
        if (showTitle) {
          remoteTitle = showTitle;
          remoteSource = showCandidate?.source ?? "trakt";
          effectiveMediaType = "tv";
        } else if (movieTitle) {
          remoteTitle = movieTitle;
          remoteSource = movieCandidate?.source ?? "trakt";
          effectiveMediaType = "movie";
          logMediaCorrection({
            requested: mediaType,
            resolved: effectiveMediaType,
            id: lookupId,
            reason: "show_endpoint_empty_movie_endpoint_valid",
            showTitle: movieTitle,
          });
        }
      } else if (hasSeriesEvidence(showTitle) && (!movieTitle || showTitle?.ids.imdbId === movieTitle.ids.imdbId || showTitle?.title === movieTitle.title)) {
        remoteTitle = showTitle;
        remoteSource = showCandidate?.source ?? "trakt";
        effectiveMediaType = "tv";
        logMediaCorrection({
          requested: mediaType,
          resolved: effectiveMediaType,
          id: lookupId,
          reason: movieTitle ? "show_endpoint_valid" : "movie_endpoint_empty_show_endpoint_valid",
          showTitle,
        });
      } else {
        remoteTitle = movieTitle;
        remoteSource = movieCandidate?.source ?? "trakt";
      }
    } else {
      const candidate = mediaType === "movie"
        ? await resolveMovieTitleCandidate({ imdbId: lookupId })
        : await resolveShowTitleCandidate({ imdbId: lookupId, tvdbId: identity.externalIds.tvdbId });
      remoteTitle = candidate?.title ?? null;
      remoteSource = candidate?.source ?? "trakt";
    }

    const [people, videos] = await Promise.all([
      catalogGetPeople({ mediaType: effectiveMediaType === "movie" ? "movie" : "show", imdbId: lookupId }).catch(() => null),
      catalogGetVideos({ mediaType: effectiveMediaType === "movie" ? "movie" : "show", imdbId: lookupId }).catch(() => []),
    ]);

    if (remoteTitle) {
      const persisted = await upsertCanonicalTitle(canonicalInputFromCatalogTitle(remoteTitle, 86_400)).catch(() => null);
      const details = catalogTitleToDetails(
        persisted ? { ...identity, poplogId: persisted.id } : identity,
        remoteTitle,
        people,
        videos,
        remoteSource,
      );
      const mergedExternalIds = {
        ...mergeExternalIds(identity, local),
        ...details.externalIds,
      };

      // numberOfSeasons: Trakt → local DB.
      // Garante que séries com múltiplas temporadas nunca mostrem 0 tabs na UI.
      let numberOfSeasons = details.numberOfSeasons ?? local?.numberOfSeasons ?? null;
      if (numberOfSeasons == null && effectiveMediaType === "tv") {
        numberOfSeasons = await resolveNumberOfSeasons(
          mergedExternalIds.imdbId,
          mergedExternalIds.tvdbId,
        ).catch(() => null);
        // Persist so the next request doesn't need to call Trakt again.
        if (numberOfSeasons != null && local) {
          void db.poplog3Title.update({
            where: { id: local.id },
            data: { numberOfSeasons },
          }).catch(() => {});
        }
      }

      // ── Canonical text resolution (title, overview, tagline) ────────────────
      //
      // Priority for each field (highest → lowest):
      //   title   : Trakt PT-BR translation > local DB PT-BR > English
      //   overview: Trakt PT-BR translation > English
      //   tagline : Trakt PT-BR translation > English
      //
      // No machine translation — PT-BR must come from the APIs.

      const remoteEnglishTitle = details.title;

      // Fetch Trakt translations (title + overview + tagline in PT-BR)
      let traktTranslation: TraktPtBrTranslation | null = null;
      if (lookupId) {
        traktTranslation = await fetchTraktPtBrTranslation(lookupId, effectiveMediaType).catch(() => null);
      }

      const localPtBr = (local?.title && looksLikeLocalizedTitle(local.title)) ? local.title : null;
      const canonicalTitle = traktTranslation?.title ?? localPtBr ?? remoteEnglishTitle;

      // Overview: Trakt > English
      const canonicalOverview = traktTranslation?.overview ?? details.overview ?? null;

      // Tagline: Trakt > English
      const canonicalTagline = traktTranslation?.tagline ?? details.tagline ?? null;

      // The English original title falls back to the remote API title when a localized candidate won.
      const canonicalOriginalTitle: string | null | undefined =
        details.originalTitle ??
        (canonicalTitle !== remoteEnglishTitle ? remoteEnglishTitle : null);

      if (canonicalTitle !== remoteEnglishTitle) {
        console.log("[title-details] localized pt-BR title selected", {
          source: traktTranslation?.title ? "trakt" : "local_db",
          ptBrTitle: canonicalTitle,
          englishTitle: remoteEnglishTitle,
        });
      }

      return localizeTitleDetails({
        ...details,
        title: canonicalTitle,
        originalTitle: canonicalOriginalTitle ?? undefined,
        overview: canonicalOverview,
        tagline: canonicalTagline,
        poplogId: details.poplogId ?? local?.id,
        lastAirDate: details.lastAirDate ?? (local?.lastAirDate ? dateString(local.lastAirDate) : null),
        numberOfSeasons,
        numberOfEpisodes: details.numberOfEpisodes ?? local?.numberOfEpisodes ?? null,
        externalIds: mergedExternalIds,
      });
    }
  }

  if (local) {
    const localDetails = localToDetails(identity, local);

    // Se DB local tem numberOfSeasons null para série TV, tenta Trakt e agenda refresh.
    let numberOfSeasons = localDetails.numberOfSeasons;
    if (numberOfSeasons == null && mediaType === "tv") {
      numberOfSeasons = await resolveNumberOfSeasons(
        localDetails.externalIds.imdbId,
        localDetails.externalIds.tvdbId,
      ).catch(() => null);
      if (numberOfSeasons != null) {
        void db.poplog3Title.update({
          where: { id: local.id },
          data: { numberOfSeasons },
        }).catch(() => {});
      }
    }

    return localizeTitleDetails({
      ...localDetails,
      numberOfSeasons,
      sourceMeta: {
        primarySource: "local",
        fallbackUsed: Boolean(!lookupId),
        fallbackReason: lookupId ? undefined : "missing_trakt_lookup_alias",
        confidence: identity.confidence,
        resolvedFrom: identity.resolvedFrom,
        rawSource: "local",
        aliasResolution: identity.aliasResolution,
      },
    });
  }

  return {
    mediaType,
    title: identity.title ?? `Titulo ${id}`,
    year: identity.year ?? null,
    externalIds: identity.externalIds,
    sourceMeta: {
      primarySource: "legacy",
      fallbackUsed: true,
      fallbackReason: lookupId ? "trakt_empty" : "unresolved_external_identity",
      confidence: identity.confidence,
      resolvedFrom: identity.resolvedFrom,
      rawSource: "legacy",
      aliasResolution: identity.aliasResolution,
    },
  };
}
