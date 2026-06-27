/**
 * balloon-engine.ts — Balloonerismm-primary recommendation engine.
 *
 * Balloonerismm é a fonte decisiva de relevância/ranking.
 * Trakt é usado apenas como camada de hidratação: IDs canônicos, pt-BR, imagens, slugs.
 *
 * Fluxo interno:
 *   1. fetchBalloonerismForSeed  — /recommendations + /similar com rastreamento de fonte
 *   2. mergeBalloonCandidates    — dedup cross-seeds, score por peso + rank + fonte
 *   3. hydrateCandidatesWithTrakt— lookup Trakt por imdbId para metadata canônica
 */

import {
  balloonerismGet,
  isBalloonerismActive,
  getCooldownRemainingMs,
} from "@/server/api-clients/balloonerismm/client";
import { traktGet, isTraktActive } from "@/server/api-clients/trakt/client";
import { logger } from "@/server/logging/logger";
import type { TraktMovieFull, TraktShowFull, TraktTranslation } from "@/server/api-clients/trakt/types";
import { normalizeCatalogLanguage } from "@/server/source-engine/locale";

// ─── Balloonerismm raw item (from /recommendations or /similar) ───────────────

export type BalloonRelatedItem = {
  id: string;            // IMDb ID: "tt..."
  title: string;
  original_title?: string;
  overview?: string;
  poster_path?: string;  // full URL (not a TMDB relative path)
  vote_average?: number;
  vote_count?: number;
  release_date?: string;   // "YYYY-MM-DD" (movies)
  first_air_date?: string; // "YYYY-MM-DD" (shows)
  genre_ids?: number[];
};

type BalloonRelatedResponse = { results?: BalloonRelatedItem[] } | BalloonRelatedItem[];

// ─── Internal: item with source tracking ─────────────────────────────────────

type BalloonRawItem = BalloonRelatedItem & {
  _source: "recommendations" | "similar" | "both";
  _rank: number; // 0-indexed position in the originating list
};

/**
 * Infere o tipo de midia REAL do item recomendado.
 *
 * /recommendations e /similar de uma semente de FILME podem conter SERIES (e vice-versa).
 * Herdar cegamente o tipo da semente produz candidatos com mediaType errado, o que
 * quebra tanto a pagina do titulo quanto, criticamente, a exclusao da biblioteca pela
 * chave `${mediaType}:tmdb:...`. O payload do Balloon traz release_date (filmes) e
 * first_air_date (series); usamos esse sinal e so caimos no tipo da semente quando
 * ambos estao ausentes.
 */
function inferItemMediaType(
  item: BalloonRelatedItem,
  seedMediaType: "movie" | "tv",
): "movie" | "tv" {
  const hasAirDate = Boolean(item.first_air_date);
  const hasReleaseDate = Boolean(item.release_date);
  if (hasAirDate && !hasReleaseDate) return "tv";
  if (hasReleaseDate && !hasAirDate) return "movie";
  return seedMediaType;
}

// ─── Per-seed result bundle ────────────────────────────────────────────────────

export type BalloonSeedResult = {
  seedImdbId: string;
  seedMediaType: "movie" | "tv";
  seedWeight: number;
  seedTitle: string;
  seedReason: string;
  items: BalloonRawItem[];
};

// ─── Fetch result (richer than bare array) ────────────────────────────────────

export type BalloonSeedFetchResult = {
  items: BalloonRawItem[];
  /** True quando um dos endpoints retornou itens mas o outro foi bloqueado/falhou. */
  partial: boolean;
  /** Quais endpoints falharam (retornaram null/vazio sem dado algum). */
  failedEndpoints: Array<"recommendations" | "similar">;
  /** True quando AMBOS os endpoints foram bloqueados/falharam (seed inválida). */
  allBlocked: boolean;
  /** Tempo de espera estimado se cooldown ativo (0 = sem cooldown). */
  retryAfterMs: number;
};

// ─── Seed origin info (for multi-seed reason aggregation) ─────────────────────

export type SeedOrigin = {
  seedImdbId: string;
  seedTitle: string;
  seedReason: string;
  seedWeight: number;
  rank: number;
};

// ─── Merged candidate (output of multi-seed aggregation) ─────────────────────

export type BalloonMergedCandidate = {
  imdbId: string;
  title: string;
  overview?: string | null;
  posterUrl?: string | null;
  voteAverage?: number | null;
  voteCount?: number | null;
  year?: string | null;
  genreIds?: number[];
  mediaType: "movie" | "tv";
  balloonSource: "recommendations" | "similar" | "both";
  bestBalloonRank: number;
  appearedFromSeeds: number;
  seedWeightSum: number;
  seedBestWeight: number;
  internalScore: number;
  seedTitle: string;
  seedReason: string;
  seedOrigins: SeedOrigin[];
};

// ─── Hydration quality counters (calculados por request, nunca globais) ───────

export type HydrationStats = {
  candidatesTotal: number;
  hydratedTrakt: number;
  hydratedDbLocal: number;   // preenchido pelo enriquecimento de DB no caller
  balloonOnly: number;
  traktNotFound: number;
  wrongTypePossible: number;
  missingPtBrTranslation: number;
  missingPoster: number;
  missingOverview: number;
  fallbackImageBalloon: number;
  fallbackTitleBalloon: number;
};

// ─── Score breakdown (per final candidate) ────────────────────────────────────

export type ScoreBreakdown = {
  seedWeightBest: number;
  rrfScoreSum: number;
  sourceMultiplier: number;
  multiSeedBonus: number;
  internalScore: number;
  visualScore: number;
  localizationScore: number;
  hydrationPenalty: number;
  finalScore: number;
};

// ─── Trakt-hydrated candidate ─────────────────────────────────────────────────

export type TraktHydratedCandidate = BalloonMergedCandidate & {
  tmdbId: number | null;
  traktId: number | null;
  traktSlug: string | null;
  tvdbId: number | null;
  originalTitle: string | null;
  backdropUrl: string | null;
  hydrationSource: "trakt" | "balloon";
  langSource: "pt-BR:trakt" | "en:trakt" | "en:balloon";
  scoreBreakdown: ScoreBreakdown;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractBalloonItems(
  r: PromiseSettledResult<BalloonRelatedResponse | null>,
  source: "recommendations" | "similar",
): BalloonRawItem[] {
  if (r.status === "rejected" || !r.value) return [];
  const v = r.value;
  const items = Array.isArray(v) ? v : (v.results ?? []);
  return items
    .filter(
      (i): i is BalloonRelatedItem =>
        typeof (i as BalloonRelatedItem)?.id === "string" &&
        (i as BalloonRelatedItem).id.startsWith("tt"),
    )
    .map((item, rank) => ({ ...item, _source: source, _rank: rank }));
}

function bestPtBr(
  translations: TraktTranslation[] | null | undefined,
): { title: string; overview?: string } | null {
  if (!Array.isArray(translations)) return null;
  const match =
    translations.find((t) => t.language === "pt" && t.country === "br" && t.title) ??
    translations.find((t) => t.language === "pt" && t.title) ??
    null;
  return match?.title ? { title: match.title, overview: match.overview ?? undefined } : null;
}

// ─── 1. Fetch for one seed ────────────────────────────────────────────────────

/**
 * Chama /recommendations e /similar para uma seed.
 * Retorna BalloonSeedFetchResult com items, partial flag e cooldown info.
 * Items aparecendo em ambas as listas são tagueados como "both" (rank de /recommendations).
 */
export async function fetchBalloonerismForSeed(
  imdbId: string,
  mediaType: "movie" | "tv",
  surface = "unknown",
  language?: string | null,
): Promise<BalloonSeedFetchResult> {
  const empty: BalloonSeedFetchResult = {
    items: [], partial: false, failedEndpoints: [], allBlocked: true, retryAfterMs: 0,
  };

  if (!imdbId || !isBalloonerismActive()) return empty;

  const kind    = mediaType === "movie" ? "movie" : "tv";
  const recPath = `/${kind}/${encodeURIComponent(imdbId)}/recommendations`;
  const simPath = `/${kind}/${encodeURIComponent(imdbId)}/similar`;
  const t0      = Date.now();
  const providerLanguage = normalizeCatalogLanguage(language);

  const [recsResult, simResult] = await Promise.allSettled([
    balloonerismGet<BalloonRelatedResponse>(recPath, {
      params: { language: providerLanguage },
      ttlSeconds: 86_400,
    }),
    balloonerismGet<BalloonRelatedResponse>(simPath, {
      params: { language: providerLanguage },
      ttlSeconds: 86_400,
    }),
  ]);

  const recs = extractBalloonItems(recsResult, "recommendations");
  const sims = extractBalloonItems(simResult, "similar");

  // Detectar endpoints bloqueados (null = cooldown/rate-limit/erro, não dados vazios)
  const recsBlocked = recsResult.status === "fulfilled" && recsResult.value === null;
  const simsBlocked = simResult.status === "fulfilled" && simResult.value === null;

  const failedEndpoints: Array<"recommendations" | "similar"> = [];
  if (recsBlocked && recs.length === 0) failedEndpoints.push("recommendations");
  if (simsBlocked && sims.length === 0) failedEndpoints.push("similar");

  const allBlocked = failedEndpoints.length === 2;

  // Retry-after: maior cooldown remanescente entre os dois endpoints
  const retryAfterMs = Math.max(
    getCooldownRemainingMs(recPath),
    getCooldownRemainingMs(simPath),
  );

  // Merge: recs primeiro, dedup por imdbId, tag "both" quando item aparece nos dois
  const seen = new Map<string, BalloonRawItem>();
  for (const item of recs) seen.set(item.id, item);
  for (const item of sims) {
    const existing = seen.get(item.id);
    if (existing) {
      seen.set(item.id, { ...existing, _source: "both" });
    } else {
      seen.set(item.id, item);
    }
  }

  const items  = Array.from(seen.values());
  const partial = failedEndpoints.length > 0 && items.length > 0;

  logger.debug(`[balloon-engine] fetchBalloonerismForSeed`, {
    surface,
    mediaType,
    imdbId,
    language: providerLanguage,
    recsCount:        recs.length,
    simsCount:        sims.length,
    mergedCount:      items.length,
    partial,
    failedEndpoints,
    allBlocked,
    retryAfterMs,
    durationMs:       Date.now() - t0,
  });

  if (allBlocked) {
    logger.warn(`[balloon-engine] seed blocked`, {
      surface, mediaType, imdbId,
      seedSkippedByCooldown: retryAfterMs > 0,
      cooldownKey: retryAfterMs > 0 ? `${recPath}|${simPath}` : null,
      retryAfterMs,
      staleCacheUsed: false,
    });
  } else if (partial) {
    logger.warn(`[balloon-engine] partial seed result`, {
      surface, mediaType, imdbId,
      partial: true,
      failedEndpoint: failedEndpoints[0],
      recs: recs.length,
      sim:  sims.length,
    });
  }

  return { items, partial, failedEndpoints, allBlocked, retryAfterMs };
}

// ─── 2. Merge across seeds ────────────────────────────────────────────────────

const RRF_K = 60;

// both=1.25 (aparece em /recs e /similar → maior confiança)
// recommendations=1.15 (só editorial)
// similar=0.95 (só similar)
const SOURCE_MULTIPLIER: Record<"recommendations" | "similar" | "both", number> = {
  both:            1.25,
  recommendations: 1.15,
  similar:         0.95,
};

const MULTI_SEED_BONUS = 0.35;

/**
 * Agrega BalloonSeedResults de múltiplas seeds em uma lista ranqueada de candidatos.
 *
 * Scoring:
 *   scoreSum = Σ (seedWeight × 1/(RRF_K + rank + 1)) por seed
 *   internalScore = scoreSum × sourceMultiplier × (1 + (seeds-1) × MULTI_SEED_BONUS)
 */
export function mergeBalloonCandidates(
  seedResults: BalloonSeedResult[],
): BalloonMergedCandidate[] {
  type Acc = {
    item: BalloonRawItem;
    mediaType: "movie" | "tv";
    seedWeightSum: number;
    seedBestWeight: number;
    bestRank: number;
    appearedFromSeeds: number;
    scoreSum: number;
    sources: Set<"recommendations" | "similar">;
    seedTitle: string;
    seedReason: string;
    seedOrigins: SeedOrigin[];
  };

  const map = new Map<string, Acc>();

  for (const { items, seedWeight, seedMediaType, seedTitle, seedReason, seedImdbId } of seedResults) {
    for (const item of items) {
      const posScore = seedWeight / (RRF_K + item._rank + 1);
      const existing = map.get(item.id);

      if (!existing) {
        const sources = new Set<"recommendations" | "similar">();
        if (item._source !== "similar")         sources.add("recommendations");
        if (item._source !== "recommendations") sources.add("similar");

        map.set(item.id, {
          item,
          mediaType:       inferItemMediaType(item, seedMediaType),
          seedWeightSum:   seedWeight,
          seedBestWeight:  seedWeight,
          bestRank:        item._rank,
          appearedFromSeeds: 1,
          scoreSum:        posScore,
          sources,
          seedTitle,
          seedReason,
          seedOrigins: [{ seedImdbId, seedTitle, seedReason, seedWeight, rank: item._rank }],
        });
      } else {
        if (item._source !== "similar")         existing.sources.add("recommendations");
        if (item._source !== "recommendations") existing.sources.add("similar");
        existing.scoreSum         += posScore;
        existing.appearedFromSeeds++;
        existing.bestRank          = Math.min(existing.bestRank, item._rank);
        existing.seedWeightSum    += seedWeight;
        existing.seedOrigins.push({ seedImdbId, seedTitle, seedReason, seedWeight, rank: item._rank });
        if (seedWeight >= existing.seedBestWeight) {
          existing.seedTitle  = seedTitle;
          existing.seedReason = seedReason;
        }
        existing.seedBestWeight = Math.max(existing.seedBestWeight, seedWeight);
      }
    }
  }

  const results: BalloonMergedCandidate[] = [];

  for (const acc of map.values()) {
    const { sources } = acc;
    const balloonSource: "recommendations" | "similar" | "both" =
      sources.has("recommendations") && sources.has("similar") ? "both"
      : sources.has("recommendations") ? "recommendations"
      : "similar";

    const multiBonus    = 1 + (acc.appearedFromSeeds - 1) * MULTI_SEED_BONUS;
    const internalScore = acc.scoreSum * SOURCE_MULTIPLIER[balloonSource] * multiBonus;
    const seedOrigins   = acc.seedOrigins.slice().sort((a, b) => b.seedWeight - a.seedWeight);

    results.push({
      imdbId:            acc.item.id,
      title:             acc.item.title,
      overview:          acc.item.overview ?? null,
      posterUrl:         acc.item.poster_path ?? null,
      voteAverage:       acc.item.vote_average ?? null,
      voteCount:         acc.item.vote_count ?? null,
      year:              acc.item.release_date?.slice(0, 4) ?? acc.item.first_air_date?.slice(0, 4) ?? null,
      genreIds:          acc.item.genre_ids ?? [],
      mediaType:         acc.mediaType,
      balloonSource,
      bestBalloonRank:   acc.bestRank,
      appearedFromSeeds: acc.appearedFromSeeds,
      seedWeightSum:     acc.seedWeightSum,
      seedBestWeight:    acc.seedBestWeight,
      internalScore,
      seedTitle:         acc.seedTitle,
      seedReason:        acc.seedReason,
      seedOrigins,
    });
  }

  results.sort((a, b) => b.internalScore - a.internalScore);
  return results;
}

// ─── 3. Trakt hydration ───────────────────────────────────────────────────────

type TraktFullItem = TraktMovieFull | TraktShowFull;

function buildScoreBreakdown(
  c: BalloonMergedCandidate,
  hasPoster: boolean,
  hasPtBr: boolean,
  hydrationSource: "trakt" | "balloon",
): ScoreBreakdown {
  const sourceMultiplier = SOURCE_MULTIPLIER[c.balloonSource];
  const multiSeedBonus   = 1 + (c.appearedFromSeeds - 1) * MULTI_SEED_BONUS;
  const rrfScoreSum      = c.internalScore / (sourceMultiplier * multiSeedBonus);
  const visualScore      = hasPoster ? 1 : 0;
  const localizationScore = hasPtBr ? 1 : 0;
  const hydrationPenalty = hydrationSource === "balloon"
    ? (hasPoster ? 0 : -0.05) + (hasPtBr ? 0 : -0.03)
    : 0;
  return {
    seedWeightBest:   c.seedBestWeight,
    rrfScoreSum,
    sourceMultiplier,
    multiSeedBonus,
    internalScore:    c.internalScore,
    visualScore,
    localizationScore,
    hydrationPenalty,
    finalScore:       c.internalScore * (1 + hydrationPenalty),
  };
}

function balloonOnly(c: BalloonMergedCandidate): TraktHydratedCandidate {
  return {
    ...c,
    tmdbId:          null,
    traktId:         null,
    traktSlug:       null,
    tvdbId:          null,
    originalTitle:   null,
    backdropUrl:     null,
    hydrationSource: "balloon",
    langSource:      "en:balloon",
    scoreBreakdown:  buildScoreBreakdown(c, Boolean(c.posterUrl), false, "balloon"),
  };
}

/**
 * Enriquece candidatos Balloon com dados canônicos do Trakt.
 *
 * Usa `c.mediaType` por candidato (sem parâmetro mediaType compartilhado).
 * Retorna `{ results, stats }` com contadores de qualidade calculados por request.
 *
 * Apenas os top `cap` candidatos são hidratados via Trakt; o restante é wrapped
 * como balloon-only. Os stats são exclusivos desta chamada (sem acúmulo global).
 */
export async function hydrateCandidatesWithTrakt(
  candidates: BalloonMergedCandidate[],
  cap = 40,
  concurrency = 8,
): Promise<{ results: TraktHydratedCandidate[]; stats: HydrationStats }> {
  // Stats são locais a esta invocação — nunca globais
  const stats: HydrationStats = {
    candidatesTotal:        candidates.length,
    hydratedTrakt:          0,
    hydratedDbLocal:        0,
    balloonOnly:            0,
    traktNotFound:          0,
    wrongTypePossible:      0,
    missingPtBrTranslation: 0,
    missingPoster:          0,
    missingOverview:        0,
    fallbackImageBalloon:   0,
    fallbackTitleBalloon:   0,
  };

  if (!candidates.length) return { results: [], stats };

  const toHydrate = candidates.slice(0, cap);
  // tail: candidatos além do cap — todos balloon-only, sem incremento duplicado
  const tail      = candidates.slice(cap).map(balloonOnly);
  stats.balloonOnly += tail.length; // contado uma vez aqui

  const hydrated: TraktHydratedCandidate[] = new Array(toHydrate.length);
  let idx = 0;

  async function worker() {
    while (idx < toHydrate.length) {
      const i = idx++;
      const c = toHydrate[i];

      if (!isTraktActive()) {
        stats.balloonOnly++;
        hydrated[i] = balloonOnly(c);
        continue;
      }

      // Usa c.mediaType por candidato (não parâmetro global)
      const traktKind = c.mediaType === "movie" ? "movies" : "shows";
      const endpoint  = `/${traktKind}/${encodeURIComponent(c.imdbId)}`;

      const data = await traktGet<TraktFullItem>(endpoint, {
        params:     { extended: "full,images,translations" },
        ttlSeconds: 86_400,
      }).catch(() => null);

      if (!data) {
        stats.traktNotFound++;
        stats.balloonOnly++;
        // Sinaliza possível mediaType errado — imdbId existe mas Trakt não encontrou neste tipo
        stats.wrongTypePossible++;
        hydrated[i] = balloonOnly(c);
        continue;
      }

      const ptBr   = bestPtBr((data as TraktMovieFull).translations ?? null);
      const images = (data as TraktMovieFull).images;
      const poster = images?.poster?.[0] ?? null;
      const fanart = images?.fanart?.[0] ?? null;

      const resolvedPoster   = poster ?? c.posterUrl ?? null;
      const resolvedTitle    = ptBr?.title ?? data.title;
      const resolvedOverview = ptBr?.overview ?? data.overview ?? c.overview ?? null;

      const hasPoster = Boolean(resolvedPoster);
      const hasPtBr   = Boolean(ptBr);

      if (!hasPtBr)          stats.missingPtBrTranslation++;
      if (!hasPoster)        stats.missingPoster++;
      if (!resolvedOverview) stats.missingOverview++;
      if (!poster && c.posterUrl)          stats.fallbackImageBalloon++;
      if (!ptBr?.title && data.title !== c.title) stats.fallbackTitleBalloon++;

      stats.hydratedTrakt++;

      hydrated[i] = {
        ...c,
        tmdbId:          data.ids.tmdb   ?? null,
        traktId:         data.ids.trakt  ?? null,
        traktSlug:       data.ids.slug   ?? null,
        tvdbId:          (data.ids as TraktShowFull["ids"]).tvdb ?? null,
        title:           resolvedTitle,
        originalTitle:   ptBr ? data.title : null,
        overview:        resolvedOverview,
        posterUrl:       resolvedPoster,
        backdropUrl:     fanart,
        voteAverage:     data.rating ?? c.voteAverage ?? null,
        voteCount:       data.votes  ?? c.voteCount   ?? null,
        hydrationSource: "trakt",
        langSource:      ptBr ? "pt-BR:trakt" : "en:trakt",
        scoreBreakdown:  buildScoreBreakdown(c, hasPoster, hasPtBr, "trakt"),
      };
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, toHydrate.length) }, worker),
  );

  // Invariante: hydratedTrakt + balloonOnly === candidatesTotal
  logger.debug(`[balloon-engine] hydrateCandidatesWithTrakt`, {
    stats,
    invariantOk: stats.hydratedTrakt + stats.balloonOnly === stats.candidatesTotal,
  });

  return { results: [...hydrated, ...tail], stats };
}
