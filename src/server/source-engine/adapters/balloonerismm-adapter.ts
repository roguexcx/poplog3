/**
 * Balloonerismm Adapter — implementa CatalogAdapter usando a API Balloonerismm.
 *
 * Política de confiança:
 *   - source_confidence = "high"      quando IMDb ID confirmado no payload
 *   - source_confidence = "medium"    sem ID cruzado confirmado
 *   - source_confidence = "low"       dado incompleto ou não verificado
 *
 * Política operacional:
 *   - Nunca é primeira fonte global (BALLOONERISMM_ALLOW_PRIMARY=false por padrão)
 *   - Usado como enrichment/fallback forte, especialmente dados IMDb-first
 *   - Não deve ser chamado em massa no render — usar job/cache/hidratação sob demanda
 */

import { balloonerismGet } from "@/server/api-clients/balloonerismm/client";
import type {
  BalloonerismMovie,
  BalloonerismShow,
  BalloonerismCreditsResponse,
  BalloonerismSeasonResponse,
} from "@/server/api-clients/balloonerismm/types";

import type { CatalogAdapter } from "./catalog-adapter";
import type {
  CatalogTitle,
  CatalogSearchResult,
  CatalogSeason,
  CatalogEpisode,
  CatalogRatings,
  CatalogComment,
  CatalogPeople,
  CatalogVideo,
  CatalogCalendarItem,
  CatalogIds,
  SearchParams,
  GetTitleParams,
  GetSeasonsParams,
  GetEpisodesParams,
  TrendingParams,
  PopularParams,
  DiscoverParams,
  RelatedParams,
  RatingParams,
  CommentParams,
  PeopleParams,
  VideoParams,
  CalendarParams,
} from "../types/catalog.types";
import type { SourceMeta, SourceConfidence } from "../types/source.types";

import { normalizeTitle } from "../normalizers/normalize-title";
import { normalizeSearchResult } from "../normalizers/normalize-search";
import { normalizePeople } from "../normalizers/normalize-person";
import { normalizeEpisode } from "../normalizers/normalize-episode";
import { normalizeCatalogLanguage, normalizeCatalogRegion } from "../locale";

// ─── Helpers de confiança ─────────────────────────────────────────────────────

/**
 * Calcula confidence com base no IMDb ID e completude do payload.
 * Regra do plano:
 *   - IMDb ID confirmado → high ou very_high
 *   - Sem ID cruzado confirmado → medium
 */
function resolveConfidence(imdbId: string | undefined | null, fieldCount: number): SourceConfidence {
  if (imdbId && imdbId.startsWith("tt")) {
    return fieldCount >= 5 ? "high" : "medium";
  }
  return "medium";
}

function sourceMeta(imdbId?: string | null, fieldCount = 3): SourceMeta {
  return {
    primary: "balloonerismm",
    confidence: resolveConfidence(imdbId, fieldCount),
    usedFallback: false,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Helpers de IDs ───────────────────────────────────────────────────────────

function resolveId(params: { imdbId?: string; traktId?: number; traktSlug?: string; tvdbId?: number }): string | null {
  // Balloonerismm é IMDb-first: preferir imdbId
  return params.imdbId ?? params.traktSlug ?? (params.traktId ? String(params.traktId) : null) ?? null;
}

type BalloonerismTitleLike = {
  id?: string | number | null;
  imdb_id?: string | null;
  tmdb_id?: number | string | null;
  tvdb_id?: number | string | null;
  trakt_id?: number | string | null;
  slug?: string | null;
  title?: string | null;
  name?: string | null;
  original_title?: string | null;
  original_name?: string | null;
  year?: number | string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  overview?: string | null;
  tagline?: string | null;
  runtime?: number | string | null;
  status?: string | null;
  type?: string | null;
  genres?: Array<string | { name?: string | null }> | null;
  genre_ids?: Array<number | string> | null;
  country?: string | null;
  language?: string | null;
  certification?: string | null;
  rating?: number | string | null;
  votes?: number | string | null;
  vote_average?: number | string | null;
  vote_count?: number | string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  images?: { poster?: string | null; backdrop?: string | null };
  ids?: { imdb?: string | null; tmdb?: number | string | null; tvdb?: number | string | null; trakt?: number | string | null };
};

function numberFrom(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function yearFrom(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d{4}/.test(value)) return Number(value.slice(0, 4));
  }
  return undefined;
}

function imdbIdFrom(item: BalloonerismTitleLike): string | undefined {
  const directId = typeof item.id === "string" ? item.id : undefined;
  return item.imdb_id ?? item.ids?.imdb ?? (directId?.startsWith("tt") ? directId : undefined);
}

function genresFrom(item: BalloonerismTitleLike): string[] | undefined {
  const genres = [
    ...(item.genres ?? []).map((genre) => (typeof genre === "string" ? genre : genre.name)),
    ...(item.genre_ids ?? []).filter((genre): genre is string => typeof genre === "string"),
  ].filter((genre): genre is string => Boolean(genre));
  return genres.length > 0 ? genres : undefined;
}

function movieIds(item: BalloonerismMovie): CatalogIds {
  const detail = item as BalloonerismTitleLike;
  return {
    imdbId: imdbIdFrom(detail),
    tvdbId: numberFrom(detail.tvdb_id ?? detail.ids?.tvdb),
    tmdbId: numberFrom(detail.tmdb_id ?? detail.ids?.tmdb), // histórico apenas
    traktId: numberFrom(detail.trakt_id ?? detail.ids?.trakt),
    balloonerismmId: typeof detail.id === "string" ? detail.id : imdbIdFrom(detail),
    slug: detail.slug ?? undefined,
  };
}

function showIds(item: BalloonerismShow): CatalogIds {
  const detail = item as BalloonerismTitleLike;
  return {
    imdbId: imdbIdFrom(detail),
    tvdbId: numberFrom(detail.tvdb_id ?? detail.ids?.tvdb),
    tmdbId: numberFrom(detail.tmdb_id ?? detail.ids?.tmdb),
    traktId: numberFrom(detail.trakt_id ?? detail.ids?.trakt),
    balloonerismmId: typeof detail.id === "string" ? detail.id : imdbIdFrom(detail),
    slug: detail.slug ?? undefined,
  };
}

function countFields(obj: Record<string, unknown>): number {
  return Object.values(obj).filter((v) => v !== null && v !== undefined).length;
}

function isSeriesType(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized || /\b(movie|film|feature)\b/.test(normalized)) return false;
  return /\b(tv\s*)?(series|miniseries|mini-series|show)\b/.test(normalized);
}

function hasBalloonerismSeriesShape(show: BalloonerismShow): boolean {
  const detail = show as BalloonerismTitleLike;
  return Boolean(
    isSeriesType(show.type ?? detail.type) ||
      (typeof show.number_of_seasons === "number" && show.number_of_seasons > 0) ||
      (typeof show.number_of_episodes === "number" && show.number_of_episodes > 0) ||
      (Array.isArray(show.episode_run_time) && show.episode_run_time.length > 0) ||
      (detail.first_air_date && !detail.release_date) ||
      (detail.original_name && !detail.original_title),
  );
}

function looksPortugueseText(value: string | null | undefined): boolean {
  if (!value) return false;
  return /[áàâãéêíóôõúüç]/i.test(value) ||
    /\b(o|a|os|as|um|uma|de|do|da|dos|das|que|com|sem|para|por|não|muito|maior|gente|volta)\b/i.test(value);
}

/**
 * Extrai empresas de produção (filtra para apenas "Production Companies",
 * excluindo distribuidoras e outros tipos).
 */
function productionCompaniesFrom(
  companies: Array<{ name: string; category?: string | null }> | null | undefined,
): Array<{ name: string }> | undefined {
  if (!companies || companies.length === 0) return undefined;
  const filtered = companies
    .filter((c) => !c.category || c.category === "Production Companies")
    .map((c) => ({ name: c.name }));
  return filtered.length > 0 ? filtered : undefined;
}

// ─── Array extraction helper ─────────────────────────────────────────────────

/**
 * Extrai array de uma resposta da API que pode vir como array direto ou
 * como objeto wrapper ({ results, data, items }). Loga as keys quando o
 * formato for inválido para facilitar diagnóstico.
 */
function extractArray<T>(raw: unknown, path: string): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw !== null && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.results)) return obj.results as T[];
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (Array.isArray(obj.items)) return obj.items as T[];
    console.warn(
      `[balloonerismm] formato inválido em ${path} — keys recebidas: ${Object.keys(obj).join(", ")}`
    );
    return [];
  }
  console.warn(`[balloonerismm] resposta inesperada em ${path} — tipo: ${typeof raw}`);
  return [];
}

// ─── Converters ───────────────────────────────────────────────────────────────

function balloonerismMovieToTitle(movie: BalloonerismMovie): CatalogTitle {
  const detail = movie as BalloonerismTitleLike;
  const meta = sourceMeta(imdbIdFrom(detail), countFields(movie as unknown as Record<string, unknown>));
  const localizedTitle = detail.title ?? detail.name ?? null;
  const fallbackTitle = detail.original_title ?? detail.original_name ?? null;
  return normalizeTitle(
    {
      ids: movieIds(movie),
      mediaType: "movie",
      title: localizedTitle ?? fallbackTitle,
      // Preserve the original-language title so the UI can show it as subtitle.
      originalTitle: fallbackTitle && fallbackTitle !== localizedTitle ? fallbackTitle : undefined,
      year: yearFrom(detail.year, detail.release_date, detail.first_air_date),
      overview: detail.overview,
      tagline: detail.tagline,
      runtime: numberFrom(detail.runtime),
      status: detail.status,
      genres: genresFrom(detail),
      country: detail.country,
      language: detail.language,
      certification: movie.certificate?.rating ?? detail.certification,
      rating: numberFrom(detail.rating ?? detail.vote_average),
      votes: numberFrom(detail.votes ?? detail.vote_count),
      posterRemoteUrl: detail.poster_path ?? detail.images?.poster,
      backdropRemoteUrl: detail.backdrop_path ?? detail.images?.backdrop,
      budget: typeof movie.budget === "number" ? movie.budget : undefined,
      revenue: typeof movie.worldwide_gross === "number" ? movie.worldwide_gross : undefined,
      domesticGross: typeof movie.domestic_gross === "number" ? movie.domestic_gross : undefined,
      metacriticScore: typeof movie.metascore === "number" ? movie.metascore : undefined,
      productionCompanies: productionCompaniesFrom(movie.production_companies),
      productionCountries: movie.production_countries
        ?.filter((c) => c.name)
        .map((c) => ({ code: c.iso_3166_1 ?? "", name: c.name })),
      spokenLanguages: movie.spoken_languages
        ?.filter((l) => l.name)
        .map((l) => ({ code: l.iso_639_1 ?? "", name: l.name })),
    },
    meta,
  );
}

function balloonerismShowToTitle(show: BalloonerismShow): CatalogTitle {
  const detail = show as BalloonerismTitleLike;
  const meta = sourceMeta(imdbIdFrom(detail), countFields(show as unknown as Record<string, unknown>));
  const episodeRunTime = Array.isArray(show.episode_run_time)
    ? (show.episode_run_time[0] ?? null)
    : null;
  const localizedTitle = detail.title ?? detail.name ?? null;
  const fallbackTitle = detail.original_title ?? detail.original_name ?? null;
  return normalizeTitle(
    {
      ids: showIds(show),
      mediaType: "show",
      title: localizedTitle ?? fallbackTitle,
      originalTitle: fallbackTitle && fallbackTitle !== localizedTitle ? fallbackTitle : undefined,
      year: yearFrom(detail.year, detail.first_air_date, detail.release_date),
      overview: detail.overview,
      tagline: detail.tagline,
      runtime: numberFrom(episodeRunTime ?? detail.runtime),
      status: detail.status,
      genres: genresFrom(detail),
      country: detail.country,
      language: detail.language,
      certification: show.certificate?.rating ?? detail.certification,
      rating: numberFrom(detail.rating ?? detail.vote_average),
      votes: numberFrom(detail.votes ?? detail.vote_count),
      posterRemoteUrl: detail.poster_path ?? detail.images?.poster,
      backdropRemoteUrl: detail.backdrop_path ?? detail.images?.backdrop,
      numberOfSeasons: show.number_of_seasons ?? null,
      numberOfEpisodes: show.number_of_episodes ?? null,
      productionCompanies: productionCompaniesFrom(show.production_companies),
      productionCountries: show.production_countries
        ?.filter((c) => c.name)
        .map((c) => ({ code: c.iso_3166_1 ?? "", name: c.name })),
      spokenLanguages: show.spoken_languages
        ?.filter((l) => l.name)
        .map((l) => ({ code: l.iso_639_1 ?? "", name: l.name })),
      inProduction: show.in_production ?? null,
      seriesType: show.type ?? null,
    },
    meta,
  );
}

type BalloonerismSearchLike = {
  id?: string | number | null;
  imdb_id?: string | null;
  tmdb_id?: number | null;
  tvdb_id?: number | string | null;
  trakt_id?: number | string | null;
  slug?: string | null;
  media_type?: "movie" | "tv" | "show" | "person" | string | null;
  type?: string | null;
  title?: string | null;
  name?: string | null;
  original_title?: string | null;
  original_name?: string | null;
  year?: number | null;
  release_date?: string | null;
  first_air_date?: string | null;
  overview?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genre_ids?: Array<number | string> | null;
  genres?: Array<string | { name?: string | null }> | null;
  vote_average?: number | null;
  vote_count?: number | null;
  number_of_seasons?: number | string | null;
  number_of_episodes?: number | string | null;
  images?: { poster?: string | null; backdrop?: string | null };
  ids?: { imdb?: string | null; tmdb?: number | null; tvdb?: number | string | null; trakt?: number | string | null };
};

function toNumber(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function toYear(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d{4}/.test(value)) {
    return Number(value.slice(0, 4));
  }
  return undefined;
}

function normalizeMediaTypeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function inferSearchMediaType(item: BalloonerismSearchLike): "movie" | "show" {
  const rawMediaType = normalizeMediaTypeText(item.media_type);
  const rawType = normalizeMediaTypeText(item.type);
  const combinedType = `${rawMediaType} ${rawType}`.trim();

  if (["tv", "show", "series"].includes(rawMediaType)) return "show";
  if (["movie", "film"].includes(rawMediaType)) return "movie";
  if (/\b(tv|show|series|miniseries|mini-series)\b/.test(combinedType)) return "show";
  if (/\b(movie|film|feature)\b/.test(combinedType)) return "movie";

  const hasSeriesShape = Boolean(
    item.first_air_date ||
      item.original_name ||
      item.number_of_seasons != null ||
      item.number_of_episodes != null,
  );
  const hasMovieShape = Boolean(item.release_date || item.original_title);

  if (hasSeriesShape && !hasMovieShape) return "show";
  if (hasMovieShape && !hasSeriesShape) return "movie";
  if (hasSeriesShape && item.name && !item.title) return "show";

  return "movie";
}

function summarizeSearchMedia(items: BalloonerismSearchLike[], path: string, query?: string): void {
  const counts = items.reduce(
    (acc, item) => {
      const inferred = inferSearchMediaType(item);
      acc[inferred] += 1;
      if (!item.media_type) acc.missingMediaType += 1;
      return acc;
    },
    { movie: 0, show: 0, missingMediaType: 0 },
  );
  const sample = items.slice(0, 3).map((item) => {
    const id = item.imdb_id ?? item.ids?.imdb ?? item.id ?? "?";
    const title = item.title ?? item.name ?? "?";
    return `${id}:${inferSearchMediaType(item)}:${title}`;
  });

  console.log(
    `[SERIES-DIAG] search balloonerismm | path=${path} q="${query ?? ""}" raw=${items.length} tv=${counts.show} movie=${counts.movie} missingType=${counts.missingMediaType} sample=${sample.join(" | ")}`,
  );
}

function searchItemToResult(item: BalloonerismSearchLike): CatalogSearchResult {
  const itemId = typeof item.id === "string" ? item.id : undefined;
  const imdbId = item.imdb_id ?? item.ids?.imdb ?? (itemId?.startsWith("tt") ? itemId : undefined);
  const mediaType = inferSearchMediaType(item);
  const releaseDate = item.release_date ?? undefined;
  const firstAirDate = item.first_air_date ?? undefined;
  const genreValues = Array.isArray(item.genre_ids) ? item.genre_ids : [];
  const genreIds = genreValues.filter((genre): genre is number => typeof genre === "number");
  const genres = genreValues.filter((genre): genre is string => typeof genre === "string");
  const meta = sourceMeta(imdbId);

  return normalizeSearchResult(
    {
      ids: {
        imdbId,
        tmdbId: item.tmdb_id ?? item.ids?.tmdb ?? undefined,
        tvdbId: toNumber(item.tvdb_id ?? item.ids?.tvdb),
        traktId: toNumber(item.trakt_id ?? item.ids?.trakt),
        balloonerismmId: itemId ?? imdbId,
        slug: item.slug ?? undefined,
      },
      mediaType,
      title: item.title ?? item.name,
      originalTitle: item.original_title ?? item.original_name,
      year: item.year ?? toYear(releaseDate ?? firstAirDate),
      releaseDate,
      firstAirDate,
      overview: item.overview,
      posterRemoteUrl: item.poster_path ?? item.images?.poster,
      backdropRemoteUrl: item.backdrop_path ?? item.images?.backdrop,
      genres,
      genreIds,
      voteAverage: item.vote_average,
      voteCount: item.vote_count,
    },
    meta,
  );
}

// ─── Person search types ──────────────────────────────────────────────────────

export type PersonSearchResult = {
  imdbId?: string;
  name: string;
  profilePath?: string | null;
  knownForDepartment?: string | null;
  biography?: string | null;
  knownFor?: Array<{ imdbId?: string; title: string; mediaType: "movie" | "tv"; year?: number; posterPath?: string | null }>;
};

export type CompanySearchResult = {
  id?: string;
  name: string;
  logoPath?: string | null;
  originCountry?: string | null;
  description?: string | null;
};

type BalloonerismPersonSearchLike = {
  imdb_id?: string | null;
  id?: string | null;
  name?: string | null;
  profile_path?: string | null;
  known_for_department?: string | null;
  biography?: string | null;
  known_for?: Array<{
    imdb_id?: string | null;
    title?: string | null;
    name?: string | null;
    media_type?: string | null;
    year?: number | null;
    images?: { poster?: string | null };
    poster_path?: string | null;
  }>;
};

// ─── Helpers de filtro/dedup de busca ────────────────────────────────────────

/** Media types that are never legitimate movie/show catalog entries. */
const EXCLUDED_MEDIA_TYPES = new Set([
  "podcast", "episode", "clip", "video", "person", "news",
  "short_video", "music_video", "music", "game",
]);

/** TMDB genre IDs that indicate the item is a music video / concert film, not a narrative work. */
const MUSIC_GENRE_IDS = new Set([10402]); // 10402 = Music (TMDB)

/**
 * Returns true if the title looks like "ArtistName: SongTitle" — the canonical
 * pattern for music singles and EPs on TMDB/Balloonerismm.
 */
function looksLikeMusicArtistTitle(title: string, query: string): boolean {
  const t = title.trim();
  const q = query.trim();
  if (!t || !q) return false;
  // "Zendaya: Neverland" when query = "zendaya"
  const prefix = t.slice(0, q.length + 2).toLowerCase();
  const expectedPrefix = `${q.toLowerCase()}: `;
  return prefix === expectedPrefix;
}

/**
 * Strict filter: rejects music videos, podcast episodes, clips, and other
 * non-cinematic content from /search/multi results.
 */
function isValidTitleItem(item: BalloonerismSearchLike, query?: string): boolean {
  // 1. Explicit non-title media types
  const mt = normalizeMediaTypeText(item.media_type ?? "");
  if (mt && EXCLUDED_MEDIA_TYPES.has(mt)) return false;

  // 2. Music genre filter (genre_id 10402)
  const genreIds = Array.isArray(item.genre_ids) ? item.genre_ids : [];
  if (genreIds.some((g) => MUSIC_GENRE_IDS.has(Number(g)))) return false;

  // 3. String-based genre check ("Music" in genres array)
  const genres = Array.isArray(item.genres)
    ? (item.genres as Array<string | { name?: string }>).map((g) =>
        typeof g === "string" ? g.toLowerCase() : (g?.name ?? "").toLowerCase(),
      )
    : [];
  if (genres.includes("music")) return false;

  // 4. "Artist: Song" title pattern — clearly a music single
  const title = item.title ?? item.name ?? "";
  if (query && looksLikeMusicArtistTitle(title, query)) return false;

  // 5. Must have at least a title
  return Boolean(title);
}

/**
 * Deduplicates search items.
 * Priority: imdbId → title+year+mediaType key.
 * When duplicates exist (pt-BR vs EN), prefers the localized title.
 */
function deduplicateSearchItems(items: BalloonerismSearchLike[]): BalloonerismSearchLike[] {
  const byImdbId = new Map<string, BalloonerismSearchLike>();
  const byTitleKey = new Map<string, BalloonerismSearchLike>();
  const result: BalloonerismSearchLike[] = [];

  for (const item of items) {
    const itemId = typeof item.id === "string" ? item.id : "";
    const imdbId = item.imdb_id ?? item.ids?.imdb ?? (itemId.startsWith("tt") ? itemId : undefined);

    if (imdbId) {
      const existing = byImdbId.get(imdbId);
      if (!existing) {
        byImdbId.set(imdbId, item);
        result.push(item);
      } else {
        // Prefer localized (title ≠ original_title) over un-localized
        const existingIsLocalized = existing.title && existing.original_title && existing.title !== existing.original_title;
        const newIsLocalized = item.title && item.original_title && item.title !== item.original_title;
        if (newIsLocalized && !existingIsLocalized) {
          // Replace in-place in the result array
          const idx = result.indexOf(existing);
          if (idx !== -1) result[idx] = item;
          byImdbId.set(imdbId, item);
        }
      }
      continue;
    }

    // No imdbId: fall back to title+year+type key
    const title = (item.title ?? item.name ?? "").toLowerCase().trim();
    const year = item.year ?? toYear(item.release_date ?? item.first_air_date ?? undefined);
    const type = inferSearchMediaType(item);
    const key = `${type}:${title}:${year ?? ""}`;
    if (key && !byTitleKey.has(key)) {
      byTitleKey.set(key, item);
      result.push(item);
    }
  }

  return result;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export const balloonerismAdapter: CatalogAdapter & {
  searchPeople(params: { query: string }): Promise<PersonSearchResult[]>;
  searchCompanies(params: { query: string }): Promise<CompanySearchResult[]>;
} = {
  // ── Busca ──────────────────────────────────────────────────────────────────

  async searchTitles(params: SearchParams): Promise<CatalogSearchResult[]> {
    const path =
      params.mediaType === "movie" ? "/search/movie"
      : params.mediaType === "show" ? "/search/tv"
      : "/search/multi";
    const raw = await balloonerismGet<unknown>(path, {
      params: { query: params.query, page: params.page ?? 1, language: params.language ?? "pt-BR" },
      ttlSeconds: 3600,
    });
    if (raw === null) return [];
    const all = extractArray<BalloonerismSearchLike>(raw, path);
    const filtered = all.filter((item) => isValidTitleItem(item, params.query));
    const items = deduplicateSearchItems(filtered);
    summarizeSearchMedia(items, path, params.query);
    return items.map(searchItemToResult);
  },

  // ── Pessoas ────────────────────────────────────────────────────────────────

  async searchPeople({ query }: { query: string }): Promise<PersonSearchResult[]> {
    const raw = await balloonerismGet<unknown>("/search/person", {
      params: { query, language: "pt-BR" },
      ttlSeconds: 3600,
    });
    if (raw === null) return [];
    const items = extractArray<BalloonerismPersonSearchLike>(raw, "/search/person");
    return items
      .filter((p) => Boolean(p.name))
      .slice(0, 8)
      .map((p) => {
        // IMDb IDs for people start with "nm" (not "tt"). Accept both.
        const rawId = typeof p.id === "string" ? p.id : undefined;
        const imdbId = p.imdb_id
          ?? (rawId?.startsWith("tt") || rawId?.startsWith("nm") ? rawId : undefined)
          ?? undefined;
        const knownFor = (p.known_for ?? [])
          .filter((kf) => Boolean(kf.title ?? kf.name))
          .map((kf) => ({
            imdbId: kf.imdb_id ?? undefined,
            title: kf.title ?? kf.name ?? "",
            mediaType: (kf.media_type === "tv" || kf.media_type === "show" ? "tv" : "movie") as "movie" | "tv",
            year: kf.year ?? undefined,
            posterPath: kf.images?.poster ?? kf.poster_path ?? null,
          }));
        return {
          imdbId,
          name: p.name!,
          profilePath: p.profile_path ?? null,
          knownForDepartment: p.known_for_department ?? null,
          biography: p.biography ?? null,
          knownFor,
        };
      });
  },

  // ── Empresas ───────────────────────────────────────────────────────────────

  async searchCompanies({ query }: { query: string }): Promise<CompanySearchResult[]> {
    // Balloonerismm has /search/company — call it if available, safe fallback.
    const raw = await balloonerismGet<unknown>("/search/company", {
      params: { query },
      ttlSeconds: 3600,
    });
    if (raw === null) return [];
    type RawCompany = { id?: string; name?: string; logo_path?: string | null; origin_country?: string | null; description?: string | null };
    const items = extractArray<RawCompany>(raw, "/search/company");
    return items
      .filter((c) => Boolean(c.name))
      .slice(0, 5)
      .map((c) => ({
        id: c.id ?? c.name,
        name: c.name!,
        logoPath: c.logo_path ?? null,
        originCountry: c.origin_country ?? null,
        description: c.description ?? null,
      }));
  },

  // ── Filme ──────────────────────────────────────────────────────────────────

  async getMovie(params: GetTitleParams): Promise<CatalogTitle | null> {
    const id = resolveId(params);
    if (!id) return null;
    const data = await balloonerismGet<BalloonerismMovie>(`/movie/${id}`, { params: { language: "pt-BR" }, ttlSeconds: 604800 });
    if (!data) return null;
    return balloonerismMovieToTitle(data);
  },

  // ── Série ──────────────────────────────────────────────────────────────────

  async getShow(params: GetTitleParams): Promise<CatalogTitle | null> {
    const id = resolveId(params);
    if (!id) return null;
    const data = await balloonerismGet<BalloonerismShow>(`/tv/${id}`, { params: { language: "pt-BR" }, ttlSeconds: 86400 });
    if (!data) return null;
    if (!hasBalloonerismSeriesShape(data)) return null;
    return balloonerismShowToTitle(data);
  },

  // ── Temporadas e episódios — fallback quando cache e TVDB falham ──────────

  async getSeasons(params: GetSeasonsParams): Promise<CatalogSeason[]> {
    const id = params.imdbId;
    if (!id || params.season === undefined) return [];
    const path = `/tv/${id}/season/${params.season}`;
    const raw = await balloonerismGet<BalloonerismSeasonResponse>(path, { params: { language: "pt-BR" }, ttlSeconds: 86400 });
    if (!raw) return [];
    const meta = sourceMeta(params.imdbId);
    return [{
      ids: { imdbId: params.imdbId },
      number: typeof raw.season_number === "number" ? raw.season_number : params.season,
      title: raw.name ?? undefined,
      posterPath: raw.poster_path ?? undefined,
      source: meta,
    }];
  },

  async getEpisodes(params: GetEpisodesParams): Promise<CatalogEpisode[]> {
    const id = params.imdbId;
    if (!id) return [];
    const path = `/tv/${id}/season/${params.season}`;
    const raw = await balloonerismGet<BalloonerismSeasonResponse>(path, { params: { language: "pt-BR" }, ttlSeconds: 86400 });
    if (!raw?.episodes) {
      console.warn("[balloonerismm] temporada vazia", {
        path,
        imdbId: id,
        season: params.season,
        reason: raw ? "endpoint_vazio_ou_idioma_sem_dados" : "temporada_inexistente_ou_id_incorreto",
      });
      return [];
    }
    const meta = sourceMeta(params.imdbId);
    return raw.episodes.map((ep) => {
      const still =
        ep.still_path ??
        ep.image ??
        ep.thumbnail ??
        ep.screenshot ??
        ep.backdrop_path ??
        undefined;
      // Language detection must be based on actual CONTENT, not on the API's `language` field.
      // Balloonerismm always reports `language: "pt-BR"` because we requested it — but the
      // content might still be English when TMDB has no PT-BR translation for this title.
      // Falsely tagging English as pt-BR causes keepExistingPortuguese in upsertSeason to
      // protect that content and block real PT-BR data from TVDB/Trakt in the future.
      const titleLanguage = looksPortugueseText(ep.name) ? "pt-BR" : undefined;
      const overviewLanguage = looksPortugueseText(ep.overview) ? "pt-BR" : undefined;
      const textLanguage = titleLanguage ?? overviewLanguage;

      return normalizeEpisode(
        {
          ids: {
            imdbId: ep.imdb_id ?? undefined,
            tmdbId: ep.tmdb_id ?? undefined,
            tvdbId: ep.tvdb_id ?? undefined,
            traktId: ep.trakt_id ?? undefined,
            balloonerismmId: typeof ep.id === "string" ? ep.id : undefined,
          },
          season: ep.season_number ?? params.season,
          number: ep.episode_number,
          absoluteNumber: ep.absolute_number ?? undefined,
          title: ep.name ?? undefined,
          originalTitle: ep.original_name ?? undefined,
          overview: ep.overview ?? undefined,
          originalOverview: ep.original_overview ?? undefined,
          titleLanguage,
          overviewLanguage,
          textLanguage,
          firstAired: ep.air_date ?? undefined,
          runtime: typeof ep.runtime === "number" ? ep.runtime : undefined,
          stillRemoteUrl: still,
          stillSource: "balloonerismm",
          stillWidth: ep.still_width ?? undefined,
          stillHeight: ep.still_height ?? undefined,
          stillLanguage: undefined,
        },
        meta,
      );
    });
  },

  // ── Trending ───────────────────────────────────────────────────────────────

  async getTrending(params: TrendingParams): Promise<CatalogSearchResult[]> {
    const path = params.mediaType === "movie" ? "/popular/movie" : "/popular/tv";
    const raw = await balloonerismGet<unknown>(path, {
      params: {
        limit: params.limit ?? 20,
        page: params.page ?? 1,
        language: normalizeCatalogLanguage(params.language),
      },
      ttlSeconds: 3600,
    });
    if (raw === null) return [];
    return extractArray<BalloonerismSearchLike>(raw, path).map(searchItemToResult);
  },

  // ── Popular ────────────────────────────────────────────────────────────────

  async getPopular(params: PopularParams): Promise<CatalogSearchResult[]> {
    const path = params.mediaType === "movie" ? "/popular/movie" : "/popular/tv";
    const raw = await balloonerismGet<unknown>(path, {
      params: {
        limit: params.limit ?? 20,
        page: params.page ?? 1,
        language: normalizeCatalogLanguage(params.language),
      },
      ttlSeconds: 21600,
    });
    if (raw === null) return [];
    return extractArray<BalloonerismSearchLike>(raw, path).map(searchItemToResult);
  },

  // ── Discover por gênero ────────────────────────────────────────────────────

  async getDiscover(params: DiscoverParams): Promise<CatalogSearchResult[]> {
    const path = params.mediaType === "movie" ? "/discover/movie" : "/discover/tv";
    const raw = await balloonerismGet<unknown>(path, {
      params: {
        with_genres: params.genreId,
        language: normalizeCatalogLanguage(params.language),
        region: normalizeCatalogRegion(params.region),
        page: params.page ?? 1,
      },
      ttlSeconds: 7200,
    });
    if (raw === null) {
      console.warn(`[balloonerismm] getDiscover returned null — path=${path} genre=${params.genreId}`);
      return [];
    }
    const items = extractArray<BalloonerismSearchLike>(raw, path);
    console.log(`[balloonerismm] getDiscover path=${path} genre=${params.genreId} count=${items.length}`);
    return items.map(searchItemToResult);
  },

  // ── Relacionados ───────────────────────────────────────────────────────────

  async getRelated(params: RelatedParams): Promise<CatalogSearchResult[]> {
    const id = resolveId(params);
    if (!id) return [];
    const path = params.mediaType === "movie" ? `/movie/${id}/similar` : `/tv/${id}/similar`;
    const raw = await balloonerismGet<unknown>(path, {
      params: { limit: 10, language: normalizeCatalogLanguage(params.language) },
      ttlSeconds: 86400,
    });
    if (raw === null) return [];
    return extractArray<BalloonerismSearchLike>(raw, path).map(searchItemToResult);
  },

  // ── Ratings ────────────────────────────────────────────────────────────────

  async getRatings(params: RatingParams): Promise<CatalogRatings | null> {
    const id = resolveId(params);
    if (!id) return null;
    const path = params.mediaType === "movie" ? `/movie/${id}/ratings` : `/tv/${id}/ratings`;
    const data = await balloonerismGet<{ rating?: number; votes?: number }>(path, {
      ttlSeconds: 3600,
    });
    if (!data?.rating) return null;
    const meta = sourceMeta(params.imdbId, 2);
    return {
      rating: data.rating,
      votes: data.votes,
      source: meta,
    };
  },

  // ── Comentários — Balloonerismm não é fonte de comentários sociais ────────

  async getComments(_params: CommentParams): Promise<CatalogComment[]> {
    return [];
  },

  // ── Pessoas ────────────────────────────────────────────────────────────────

  async getPeople(params: PeopleParams): Promise<CatalogPeople | null> {
    const id = resolveId(params);
    if (!id) return null;
    const path = params.mediaType === "movie" ? `/movie/${id}/credits` : `/tv/${id}/credits`;
    const data = await balloonerismGet<BalloonerismCreditsResponse>(path, {
      params: { language: "pt-BR" },
      ttlSeconds: 2592000, // 30 dias — pessoas mudam raramente
    });
    if (!data) return null;

    const meta = sourceMeta(params.imdbId, 5);
    const cast = (data.cast ?? []).map((c) => ({
      ids: { imdbId: c.imdb_id },
      name: c.name,
      character: c.character,
      profileRemoteUrl: c.profile_path ?? undefined,
    }));
    const crew = (data.crew ?? []).map((c) => ({
      ids: { imdbId: c.imdb_id },
      name: c.name,
      job: c.job,
      department: c.department,
      profileRemoteUrl: c.profile_path ?? undefined,
    }));

    return normalizePeople(cast, crew, meta);
  },

  // ── Vídeos ─────────────────────────────────────────────────────────────────

  async getVideos(params: VideoParams): Promise<CatalogVideo[]> {
    const id = resolveId(params);
    if (!id) return [];
    const path = params.mediaType === "movie" ? `/movie/${id}/videos` : `/tv/${id}/videos`;
    // A API retorna { id, results: [...] } — não um array direto.
    const raw = await balloonerismGet<unknown>(
      path,
      { params: { language: "pt-BR" }, ttlSeconds: 21600 }, // 6h — URLs de vídeo têm TTL curto
    );
    if (!raw) return [];
    type VideoEntry = {
      id?: number | string;
      url?: string;
      name?: string;
      site?: string;
      type?: string;
      thumbnail?: string | null;
    };
    const results = extractArray<VideoEntry>(raw, path);
    const meta = sourceMeta(params.imdbId, 2);
    // Retorna todos os vídeos com URL (YouTube e IMDb).
    // O componente TitleTrailer decide como exibir com base no site.
    return results
      .filter((v) => Boolean(v.url))
      .map((v, i) => ({
        id: typeof v.id === "number" ? v.id : i,
        title: v.name ?? "Trailer",
        url: v.url!,
        type: (v.type?.toLowerCase() ?? "trailer"),
        thumbnailUrl: v.thumbnail ?? null,
        source: meta,
      }));
  },

  // ── Calendário — Balloonerismm não é fonte de calendário ──────────────────

  async getCalendar(_params: CalendarParams): Promise<CatalogCalendarItem[]> {
    return [];
  },
};
