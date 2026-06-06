/**
 * Series Canonical Engine — merge multi-fonte de metadados de série.
 *
 * Equivalente ao `canonical()` / `mergeAll()` do poplog-series-visual-engine.html,
 * mas operando como serviço real interno do POPLOG.
 *
 * Estratégia:
 *   1. Busca em paralelo: TVDB + Trakt + Balloonerismm
 *   2. Normaliza cada fonte para SeriesSourceNormalized
 *   3. Merge canônico: campos com prioridade por tipo de dado
 *   4. Nenhuma fonte útil é descartada por outra ter respondido primeiro
 *
 * Prioridade de campos:
 *   ids         : imdb > tvdb > trakt > slug > tmdb
 *   episodes    : tvdb > trakt > balloonerismm
 *   images      : tvdb > balloonerismm > trakt
 *   text/pt-br  : trakt (translations) > tvdb > balloonerismm
 *   status      : trakt > tvdb > balloonerismm
 *   dates       : trakt > tvdb > balloonerismm
 *   trailer     : trakt > balloonerismm > tvdb
 *   homepage    : trakt > balloonerismm > tvdb
 *   tagline     : trakt > balloonerismm > tvdb
 *   companies   : balloonerismm > tvdb > trakt
 *   ratings     : trakt > balloonerismm > tvdb
 *   translations: trakt > tvdb > balloonerismm
 */

import { tvdbAdapter } from "./adapters/tvdb-adapter";
import { traktAdapter } from "./adapters/trakt-adapter";
import { balloonerismGet } from "@/server/api-clients/balloonerismm/client";
import type { BalloonerismShow } from "@/server/api-clients/balloonerismm/types";
import type { CatalogTitle } from "./types/catalog.types";

// ── Types ──────────────────────────────────────────────────────────────────────

export type SeriesCanonicalIds = {
  imdb?: string;
  tvdb?: number;
  trakt?: number | string;
  tmdb?: number;
  slug?: string;
};

export type SeriesSourceEntry = {
  source: "balloonerismm" | "tvdb" | "trakt";
  sourceId: string | number;
  confidence: number;
  ids: SeriesCanonicalIds;
  title?: string;
  year?: number;
  hasEpisodes: boolean;
  hasImages: boolean;
  hasTrailer: boolean;
  hasMetadata: boolean;
};

/**
 * Resultado canônico de metadados de série mesclados de múltiplas fontes.
 * Todos os campos são opcionais — a engine retorna o máximo possível sem garantir completude.
 */
export type SeriesCanonicalMeta = {
  // ── Metadados principais ─────────────────────────────────────────────────
  title?: string;
  originalTitle?: string;
  year?: number;
  overview?: string;
  status?: string;
  language?: string;

  // ── Identificadores ──────────────────────────────────────────────────────
  ids: SeriesCanonicalIds;

  // ── Imagens ──────────────────────────────────────────────────────────────
  poster?: string;
  backdrop?: string;
  thumbnail?: string;
  logo?: string;
  /** Pool completo de imagens de todas as fontes, sem duplicatas. */
  imagePool: string[];

  // ── Mídia complementar ───────────────────────────────────────────────────
  trailerUrl?: string;
  homepage?: string;
  tagline?: string;

  // ── Métricas ─────────────────────────────────────────────────────────────
  runtime?: number;
  rating?: number;
  votes?: number;

  // ── Taxonomia e estrutura ────────────────────────────────────────────────
  network?: string;
  networks: string[];
  genres: string[];
  companies: string[];
  availableTranslations: string[];

  // ── Contadores de episódios/temporadas ───────────────────────────────────
  lastAirDate?: string;
  airedEpisodes?: number;
  numberOfEpisodes?: number;
  numberOfSeasons?: number;

  // ── Meta de merge ────────────────────────────────────────────────────────
  sources: SeriesSourceEntry[];
  sourceCount: number;
  mergeConfidence: number;

  debug?: {
    fieldSources?: Record<string, string>;
  };
};

// ── Helpers internos ──────────────────────────────────────────────────────────

function uniq<T>(arr: (T | null | undefined)[]): T[] {
  return [...new Set(arr.filter((v): v is T => v != null && v !== ("" as unknown as T)))] as T[];
}

function first<T>(...vals: (T | null | undefined)[]): T | undefined {
  return vals.find((v): v is T => v != null && v !== ("" as unknown as T));
}

function imagePool(...urls: (string | null | undefined)[]): string[] {
  return uniq(urls.map((u) => u?.startsWith("//") ? `https:${u}` : u).filter(Boolean));
}

type SourceNorm = {
  source: "balloonerismm" | "tvdb" | "trakt";
  confidence: number;
  title?: string;
  year?: number;
  overview?: string;
  status?: string;
  language?: string;
  tagline?: string;
  ids: SeriesCanonicalIds;
  poster?: string;
  backdrop?: string;
  thumbnail?: string;
  logo?: string;
  trailerUrl?: string;
  homepage?: string;
  runtime?: number;
  rating?: number;
  votes?: number;
  network?: string;
  networks: string[];
  genres: string[];
  companies: string[];
  availableTranslations: string[];
  lastAirDate?: string;
  airedEpisodes?: number;
  numberOfEpisodes?: number;
  numberOfSeasons?: number;
};

function normFromCatalog(
  ct: CatalogTitle,
  source: "balloonerismm" | "tvdb" | "trakt",
  confidence: number,
): SourceNorm {
  return {
    source,
    confidence,
    title: ct.title || undefined,
    year: ct.year,
    overview: ct.overview,
    status: ct.status,
    language: ct.language,
    tagline: ct.tagline,
    ids: {
      imdb: ct.ids.imdbId,
      tvdb: ct.ids.tvdbId,
      trakt: ct.ids.traktId,
      tmdb: ct.ids.tmdbId,
      slug: ct.ids.traktSlug,
    },
    poster: ct.posterPath ?? undefined,
    backdrop: ct.backdropPath ?? undefined,
    trailerUrl: ct.trailerUrl ?? undefined,
    homepage: ct.homepage ?? undefined,
    runtime: ct.runtime,
    rating: ct.rating,
    votes: ct.votes,
    network: ct.network ?? undefined,
    networks: ct.networks ?? [],
    genres: ct.genres ?? [],
    companies: (ct.productionCompanies ?? []).map((c) => c.name),
    availableTranslations: ct.availableTranslations ?? [],
    airedEpisodes: ct.airedEpisodes ?? undefined,
    numberOfEpisodes: ct.numberOfEpisodes ?? undefined,
    numberOfSeasons: ct.numberOfSeasons ?? undefined,
    // rich fields set by adapters
    logo: ct.logoUrl ?? undefined,
    thumbnail: undefined,
  };
}

function normFromBalloon(data: BalloonerismShow, imdbId: string): SourceNorm {
  const trailer = data.trailers?.find((t) => t.type === "trailer" || !t.type);
  return {
    source: "balloonerismm",
    confidence: 0.72,
    title: data.title || undefined,
    year: data.year ?? undefined,
    overview: data.overview ?? undefined,
    status: data.status ?? undefined,
    language: data.language ?? undefined,
    tagline: data.tagline ?? undefined,
    ids: {
      imdb: imdbId,
      tvdb: data.ids?.tvdb ?? undefined,
      tmdb: data.ids?.tmdb ?? undefined,
    },
    poster: data.images?.poster ?? undefined,
    backdrop: data.images?.backdrop ?? undefined,
    logo: data.images?.logo ?? undefined,
    trailerUrl: trailer?.url ?? undefined,
    homepage: undefined, // Balloonerismm não retorna homepage
    runtime: data.runtime ?? data.episode_run_time?.[0] ?? undefined,
    rating: data.vote_average ?? undefined,
    votes: data.vote_count ?? undefined,
    network: undefined,
    networks: [],
    genres: data.genres ?? [],
    companies: (data.production_companies ?? []).map((c) => c.name),
    availableTranslations: [],
    numberOfEpisodes: data.number_of_episodes ?? undefined,
    numberOfSeasons: data.number_of_seasons ?? undefined,
  };
}

// ── Merge canônico ─────────────────────────────────────────────────────────────

function mergeCanonical(sources: SourceNorm[]): SeriesCanonicalMeta {
  const bySource = Object.fromEntries(sources.map((s) => [s.source, s])) as
    Record<string, SourceNorm | undefined>;

  const bal = bySource["balloonerismm"];
  const tvdb = bySource["tvdb"];
  const trakt = bySource["trakt"];

  // Campo texto: trakt > tvdb > balloonerismm
  const textOrder = [trakt, tvdb, bal].filter(Boolean) as SourceNorm[];
  // Imagens: tvdb > balloonerismm > trakt
  const imgOrder = [tvdb, bal, trakt].filter(Boolean) as SourceNorm[];
  // Trailer/homepage: trakt > balloonerismm > tvdb
  const trailerOrder = [trakt, bal, tvdb].filter(Boolean) as SourceNorm[];
  // Companies: balloonerismm > tvdb > trakt
  const companyOrder = [bal, tvdb, trakt].filter(Boolean) as SourceNorm[];

  // Merge de IDs: todos os IDs disponíveis são preservados
  const ids: SeriesCanonicalIds = {};
  for (const s of sources) {
    if (s.ids.imdb && !ids.imdb) ids.imdb = s.ids.imdb;
    if (s.ids.tvdb && !ids.tvdb) ids.tvdb = s.ids.tvdb;
    if (s.ids.trakt && !ids.trakt) ids.trakt = s.ids.trakt;
    if (s.ids.tmdb && !ids.tmdb) ids.tmdb = s.ids.tmdb;
    if (s.ids.slug && !ids.slug) ids.slug = s.ids.slug;
  }

  // Merge de imagePool: union de todas as imagens de todas as fontes
  const pool = imagePool(
    ...sources.flatMap((s) => [s.poster, s.backdrop, s.thumbnail, s.logo]),
  );

  // Merge de genres: union com deduplicação case-insensitive
  // Guard against non-string entries (can come from API responses returning objects)
  const genreSet = new Map<string, string>();
  for (const s of sources) {
    for (const g of s.genres) {
      if (typeof g === "string" && g) {
        genreSet.set(g.toLowerCase(), g);
      } else if (g && typeof g === "object") {
        // Handle {id, name} format (TMDB/some APIs return genre objects)
        const name = (g as Record<string, unknown>).name;
        if (typeof name === "string" && name) {
          genreSet.set(name.toLowerCase(), name);
        }
      }
    }
  }

  // Merge de companies: ordem de prioridade; deduplicação
  const companySet = new Set<string>();
  const companiesMerged: string[] = [];
  for (const s of companyOrder) {
    for (const c of s.companies) {
      if (!companySet.has(c)) {
        companySet.add(c);
        companiesMerged.push(c);
      }
    }
  }

  // availableTranslations: union de todas as fontes
  const availableTranslations = uniq(sources.flatMap((s) => s.availableTranslations));

  // Calcula confiança de merge
  const totalConf = sources.reduce((acc, s) => acc + s.confidence, 0);
  const mergeConfidence = sources.length > 0 ? Math.min(1, totalConf / sources.length) : 0;

  // Mapa de debug: qual fonte forneceu cada campo
  const fieldSources: Record<string, string> = {};
  const pickField = <T>(
    fieldName: string,
    order: SourceNorm[],
    getter: (s: SourceNorm) => T | null | undefined,
  ): T | undefined => {
    for (const s of order) {
      const v = getter(s);
      if (v != null && v !== "") {
        fieldSources[fieldName] = s.source;
        return v as T;
      }
    }
    return undefined;
  };

  return {
    title: pickField("title", textOrder, (s) => s.title),
    year: pickField("year", textOrder, (s) => s.year),
    overview: pickField("overview", textOrder, (s) => s.overview),
    status: pickField("status", [trakt, tvdb, bal].filter(Boolean) as SourceNorm[], (s) => s.status),
    language: pickField("language", textOrder, (s) => s.language),
    tagline: pickField("tagline", trailerOrder, (s) => s.tagline),

    ids,

    poster: pickField("poster", imgOrder, (s) => s.poster),
    backdrop: pickField("backdrop", imgOrder, (s) => s.backdrop),
    thumbnail: pickField("thumbnail", imgOrder, (s) => s.thumbnail),
    logo: pickField("logo", imgOrder, (s) => s.logo),
    imagePool: pool,

    trailerUrl: pickField("trailerUrl", trailerOrder, (s) => s.trailerUrl),
    homepage: pickField("homepage", trailerOrder, (s) => s.homepage),

    runtime: pickField("runtime", textOrder, (s) => s.runtime),
    rating: pickField("rating", [trakt, bal, tvdb].filter(Boolean) as SourceNorm[], (s) => s.rating),
    votes: pickField("votes", [trakt, bal, tvdb].filter(Boolean) as SourceNorm[], (s) => s.votes),

    network: pickField("network", [trakt, tvdb, bal].filter(Boolean) as SourceNorm[], (s) => s.network),
    networks: uniq(sources.flatMap((s) => s.networks)),
    genres: [...genreSet.values()],
    companies: companiesMerged,
    availableTranslations,

    lastAirDate: pickField("lastAirDate", [trakt, tvdb, bal].filter(Boolean) as SourceNorm[], (s) => s.lastAirDate),
    airedEpisodes: pickField("airedEpisodes", [trakt, tvdb, bal].filter(Boolean) as SourceNorm[], (s) => s.airedEpisodes),
    numberOfEpisodes: pickField("numberOfEpisodes", [trakt, tvdb, bal].filter(Boolean) as SourceNorm[], (s) => s.numberOfEpisodes),
    numberOfSeasons: pickField("numberOfSeasons", [tvdb, trakt, bal].filter(Boolean) as SourceNorm[], (s) => s.numberOfSeasons),

    sources: sources.map((s) => ({
      source: s.source,
      sourceId: first(s.ids.imdb, s.ids.tvdb, s.ids.trakt, s.ids.tmdb) ?? s.source,
      confidence: s.confidence,
      ids: s.ids,
      title: s.title,
      year: s.year,
      hasEpisodes: false, // season-level, não calculado aqui
      hasImages: Boolean(s.poster || s.backdrop || s.logo),
      hasTrailer: Boolean(s.trailerUrl),
      hasMetadata: Boolean(s.overview || s.tagline || s.homepage),
    })),
    sourceCount: sources.length,
    mergeConfidence,

    debug: { fieldSources },
  };
}

// ── Entry point ────────────────────────────────────────────────────────────────

/**
 * Resolve metadados canônicos de série a partir de múltiplas fontes.
 *
 * Fase 1 (paralela):  TVDB + Trakt
 * Fase 2 (fallback):  Balloonerismm (apenas quando fase 1 não entregou overview nem poster)
 *
 * Retorna null se nenhuma fonte retornar dados utilizáveis.
 */
export async function resolveCanonicalSeriesMeta(params: {
  imdbId?: string | null;
  tvdbId?: number | null;
  traktId?: number | string | null;
  traktSlug?: string | null;
  tmdbId?: number | null;
}): Promise<SeriesCanonicalMeta | null> {
  const { imdbId, tvdbId, traktId, traktSlug, tmdbId } = params;

  if (!imdbId && !tvdbId && !traktId && !traktSlug) {
    return null;
  }

  // ── Fase 1: TVDB + Trakt em paralelo ──────────────────────────────────────

  const [tvdbResult, traktResult] = await Promise.all([
    tvdbId
      ? tvdbAdapter.getShow({ tvdbId, imdbId: imdbId ?? undefined, tmdbId: tmdbId ?? undefined }).catch((err) => {
          console.warn("[series-engine] TVDB getShow erro:", (err as Error)?.message);
          return null;
        })
      : Promise.resolve<CatalogTitle | null>(null),

    imdbId || traktSlug || traktId
      ? traktAdapter.getShow({
          imdbId: imdbId ?? undefined,
          traktSlug: traktSlug ?? undefined,
          traktId: typeof traktId === "number" ? traktId : undefined,
          tvdbId: tvdbId ?? undefined,
        }).catch((err) => {
          console.warn("[series-engine] Trakt getShow erro:", (err as Error)?.message);
          return null;
        })
      : Promise.resolve<CatalogTitle | null>(null),
  ]);

  const phase1Sources: SourceNorm[] = [];
  if (tvdbResult) phase1Sources.push(normFromCatalog(tvdbResult, "tvdb", 0.92));
  if (traktResult) phase1Sources.push(normFromCatalog(traktResult, "trakt", 0.86));

  // Fase 2: Balloonerismm — sempre consulta quando há imdbId, para complementar dados
  // (poster, tagline, companies que podem não vir do TVDB/Trakt)
  let balloonSource: SourceNorm | null = null;
  if (imdbId) {
    const balloonData = await balloonerismGet<BalloonerismShow>(`/tv/${imdbId}`, {
      params: { language: "pt-BR", region: "BR" },
      ttlSeconds: 86400,
    }).catch(() => null);

    if (balloonData) {
      balloonSource = normFromBalloon(balloonData, imdbId);
    }
  }

  const allSources = [
    ...phase1Sources,
    ...(balloonSource ? [balloonSource] : []),
  ];

  if (allSources.length === 0) {
    console.warn("[series-engine] sem dados em nenhuma fonte", { imdbId, tvdbId, traktId });
    return null;
  }

  const canonical = mergeCanonical(allSources);

  // Enriquecer IDs com qualquer informação extra retornada pelos adapters
  if (tvdbResult?.ids.tvdbId && !canonical.ids.tvdb) canonical.ids.tvdb = tvdbResult.ids.tvdbId;
  if (traktResult?.ids.imdbId && !canonical.ids.imdb) canonical.ids.imdb = traktResult.ids.imdbId;
  if (traktResult?.ids.tvdbId && !canonical.ids.tvdb) canonical.ids.tvdb = traktResult.ids.tvdbId;
  if (traktResult?.ids.traktId && !canonical.ids.trakt) canonical.ids.trakt = traktResult.ids.traktId;
  if (traktResult?.ids.traktSlug && !canonical.ids.slug) canonical.ids.slug = traktResult.ids.traktSlug;

  console.log("[series-engine] merge canônico concluído", {
    imdbId,
    tvdbId,
    sourceCount: allSources.length,
    sources: allSources.map((s) => s.source),
    hasPoster: Boolean(canonical.poster),
    hasTrailer: Boolean(canonical.trailerUrl),
    numberOfSeasons: canonical.numberOfSeasons,
  });

  return canonical;
}
