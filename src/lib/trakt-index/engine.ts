/**
 * Trakt Index TOP 50 — engine de scoring com 7 sinais públicos da Trakt.
 *
 * Fórmula de score (alinhada com o laboratório HTML de referência):
 *   rankScore  = max(0, 120 - sourceRank * 4)      ← rank 1 = 116, rank 30 = 0
 *   popScore   = min(120, log10(metric + 1) * 32)
 *   signalScore = (rankScore + popScore) * peso
 *   totalScore  = Σ signalScore + (uniqueSignals - 1) * 18
 *
 * Confidence:
 *   min(100, round(42 + signalCount*12 + idCount*5))
 *
 * TOP 50 final: ordenado por score, alternando 1 filme / 1 série.
 */

import { traktGet } from "@/server/api-clients/trakt/client";
import { isExcludedFormat } from "@/lib/content-format/excluded-formats";
import { syntheticTmdbFromImdbId } from "@/lib/ids/synthetic-tmdb-id";
import type { LocalizedCatalogText } from "@/lib/i18n/catalog-localization";
import type {
  TraktIndexItem,
  TraktIndexIds,
  TraktIndexItemDetail,
  TraktIndexSignal,
  TraktIndexTranslation,
  TrendingRecency,
} from "./types";

// ─── Recência ("termômetro vivo") ─────────────────────────────────────────────
// O Trending favorece movimentação atual: lançamentos recentes, novas temporadas
// e títulos com spike real agora. Popularidade histórica acumulada NÃO basta —
// um clássico evergreen só sobe se aparecer num sinal `*_trending` (spike vivo).
const RECENCY_RECENT_DAYS = 120; // estreia/temporada recente forte
const RECENCY_FRESH_DAYS = 545; // ~18 meses, ainda fresco
const RECENCY_MID_DAYS = 1825; // 5 anos — limite do "atual"
const RECENCY_BOOST_RECENT = 60;
const RECENCY_BOOST_FRESH = 28;
const RECENCY_BOOST_MID = 8;
const EVERGREEN_DAMP = 0.55; // multiplicador para antigo sem spike vivo

// ─── Configuração dos sinais ──────────────────────────────────────────────────

export const TRAKT_INDEX_SIGNALS: TraktIndexSignal[] = [
  {
    id: "movies_trending",
    label: "Movies Trending",
    kind: "movie",
    endpoint: "/movies/trending",
    period: false,
    weight: 2.20,
    metric: "watchers",
  },
  {
    id: "movies_watched",
    label: "Movies Watched",
    kind: "movie",
    endpoint: "/movies/watched/{period}",
    period: true,
    weight: 1.35,
    metric: "watcher_count",
  },
  {
    id: "movies_played",
    label: "Movies Played",
    kind: "movie",
    endpoint: "/movies/played/{period}",
    period: true,
    weight: 1.15,
    metric: "play_count",
  },
  {
    id: "movies_favorited",
    label: "Movies Favorited",
    kind: "movie",
    endpoint: "/movies/favorited/{period}",
    period: true,
    weight: 0.55,
    metric: "user_count",
  },
  {
    id: "shows_trending",
    label: "Shows Trending",
    kind: "show",
    endpoint: "/shows/trending",
    period: false,
    weight: 2.20,
    metric: "watchers",
  },
  {
    id: "shows_watched",
    label: "Shows Watched",
    kind: "show",
    endpoint: "/shows/watched/{period}",
    period: true,
    weight: 1.35,
    metric: "watcher_count",
  },
  {
    id: "shows_favorited",
    label: "Shows Favorited",
    kind: "show",
    endpoint: "/shows/favorited/{period}",
    period: true,
    weight: 0.50,
    metric: "user_count",
  },
];

// ─── Tipos internos de resposta da API Trakt ──────────────────────────────────

type TraktMediaIds = {
  trakt?: number;
  slug?: string;
  imdb?: string;
  tmdb?: number;
  tvdb?: number;
  tvrage?: number;
};

type TraktMediaObj = {
  title: string;
  year?: number | null;
  ids: TraktMediaIds;
  overview?: string | null;
  tagline?: string | null;
  released?: string | null;
  first_aired?: string | null;
  runtime?: number | null;
  certification?: string | null;
  rating?: number | null;
  votes?: number | null;
  genres?: string[] | null;
  network?: string | null;
  status?: string | null;
  trailer?: string | null;
  images?: {
    poster?: string[] | null;
    fanart?: string[] | null;
    thumb?: string[] | null;
    banner?: string[] | null;
  } | null;
};

type TraktTrendingRow = {
  watchers: number;
  movie?: TraktMediaObj;
  show?: TraktMediaObj;
};

type TraktPeriodRow = {
  watcher_count?: number;
  play_count?: number;
  user_count?: number;
  movie?: TraktMediaObj;
  show?: TraktMediaObj;
};

type TraktTranslationRaw = {
  title: string;
  overview: string;
  tagline?: string;
  language: string;
  country: string;
};

// ─── Opções públicas ──────────────────────────────────────────────────────────

export type TraktIndexOptions = {
  period?: "daily" | "weekly" | "monthly" | "yearly" | "all";
  limit?: number;
  translationLimit?: number;
  /** Janela de validade para cache HTTP das chamadas Trakt (em segundos). */
  ttlSeconds?: number;
};

const DEFAULT_OPTIONS: Required<TraktIndexOptions> = {
  period: "daily",
  limit: 50,
  translationLimit: 24,
  ttlSeconds: 1_800, // 30 min
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function pickImage(arr?: string[] | null): string | null {
  if (!arr?.length) return null;
  const url = arr[0];
  if (!url) return null;
  if (/^https?:\/\//.test(url)) return url;
  if (/^\/\//.test(url)) return `https:${url}`;
  if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(url)) return `https://${url}`;
  return url;
}

function metricValue(row: TraktPeriodRow | TraktTrendingRow, metric: TraktIndexSignal["metric"]): number {
  if (metric === "watchers") return +((row as TraktTrendingRow).watchers ?? 0);
  if (metric === "watcher_count") return +((row as TraktPeriodRow).watcher_count ?? 0);
  if (metric === "play_count") return +((row as TraktPeriodRow).play_count ?? 0);
  if (metric === "user_count") return +((row as TraktPeriodRow).user_count ?? 0);
  return 0;
}

function mediaObjFrom(row: TraktPeriodRow | TraktTrendingRow, kind: "movie" | "show"): TraktMediaObj | null {
  return (kind === "movie" ? row.movie : row.show) ?? null;
}

/**
 * Deriva um tmdb_id sintético quando não há TMDB ID real.
 *
 * IMDb-first: usa o sintético canônico derivado do IMDb (round-trip estável via
 * `imdbIdFromSyntheticTmdbId`), depois Trakt. Sem ID estável → null (o item é
 * descartado) para nunca gerar rotas instáveis com `Math.random()`.
 */
function syntheticTmdbId(ids: TraktMediaIds): number | null {
  if (ids.tmdb) return ids.tmdb;
  if (ids.imdb) {
    const synthetic = syntheticTmdbFromImdbId(ids.imdb);
    if (synthetic != null) return synthetic;
  }
  if (ids.trakt) return -(ids.trakt);
  return null;
}

// ─── Recência ─────────────────────────────────────────────────────────────────

function parseAgeDays(date: string | null | undefined): number | null {
  if (!date) return null;
  const ms = Date.parse(date);
  if (Number.isNaN(ms)) return null;
  return Math.floor((Date.now() - ms) / 86_400_000);
}

/**
 * Núcleo PURO do "termômetro vivo" (testável isoladamente).
 *
 * Lançamentos/temporadas recentes ganham boost; um título antigo (> 5 anos) que
 * NÃO aparece em nenhum sinal `*_trending` (ou seja, sobe só por popularidade
 * acumulada) é amortizado para não dominar "Em alta agora". Se houver spike vivo,
 * o título antigo é poupado do damp (revival/relançamento/viralização real).
 */
export function recencyContribution(input: {
  ageDays: number | null;
  hasLiveSpike: boolean;
  baseScore: number;
}): {
  boost: number;
  isRecent: boolean;
  isEvergreenWithoutSpike: boolean;
  recencyScore: number;
} {
  const { ageDays, hasLiveSpike, baseScore } = input;
  const isRecent = ageDays != null && ageDays <= RECENCY_FRESH_DAYS;
  const isEvergreenWithoutSpike =
    ageDays != null && ageDays > RECENCY_MID_DAYS && !hasLiveSpike;

  let boost = 0;
  if (ageDays != null) {
    if (ageDays <= RECENCY_RECENT_DAYS) boost = RECENCY_BOOST_RECENT;
    else if (ageDays <= RECENCY_FRESH_DAYS) boost = RECENCY_BOOST_FRESH;
    else if (ageDays <= RECENCY_MID_DAYS) boost = RECENCY_BOOST_MID;
  }
  const damp = isEvergreenWithoutSpike ? -(baseScore * (1 - EVERGREEN_DAMP)) : 0;
  const recencyScore = Math.round((boost + damp) * 10) / 10;

  return { boost, isRecent, isEvergreenWithoutSpike, recencyScore };
}

/** Calcula sinais de recência do grupo (data, spike vivo, evergreen). */
function computeRecency(group: Group, baseScore: number): TrendingRecency {
  const dated = group.items
    .map((i) =>
      group.mediaType === "movie" ? i.obj.released : i.obj.first_aired,
    )
    .find((d): d is string => Boolean(d)) ?? null;
  const date = dated ? dated.slice(0, 10) : null;
  const ageDays = parseAgeDays(date);
  const hasLiveSpike = group.items.some((i) => i.signal.id.endsWith("_trending"));

  const { isRecent, isEvergreenWithoutSpike, recencyScore } = recencyContribution({
    ageDays,
    hasLiveSpike,
    baseScore,
  });

  return { date, ageDays, isRecent, hasLiveSpike, isEvergreenWithoutSpike, recencyScore };
}

// ─── Deduplicação e agrupamento ───────────────────────────────────────────────

type RawSignalItem = {
  signal: TraktIndexSignal;
  sourceRank: number;
  metric: number;
  obj: TraktMediaObj;
  mediaType: "movie" | "tv";
};

function sameGroup(
  a: TraktMediaIds, b: TraktMediaIds,
  titleA: string, titleB: string,
  yearA: number | null | undefined, yearB: number | null | undefined,
): boolean {
  if (a.imdb && b.imdb && a.imdb === b.imdb) return true;
  if (a.tmdb && b.tmdb && a.tmdb === b.tmdb) return true;
  if (a.trakt && b.trakt && a.trakt === b.trakt) return true;
  if (a.tvdb && b.tvdb && a.tvdb === b.tvdb) return true;
  if (a.slug && b.slug && a.slug === b.slug) return true;
  if (slugify(titleA) === slugify(titleB) && yearA === yearB) return true;
  return false;
}

type Group = {
  mediaType: "movie" | "tv";
  items: RawSignalItem[];
};

function mergeIntoGroups(flat: RawSignalItem[]): Group[] {
  const groups: Group[] = [];

  for (const item of flat) {
    const found = groups.find(
      (g) =>
        g.mediaType === item.mediaType &&
        g.items.some((x) =>
          sameGroup(
            x.obj.ids, item.obj.ids,
            x.obj.title, item.obj.title,
            x.obj.year, item.obj.year,
          )
        )
    );

    if (found) {
      found.items.push(item);
    } else {
      groups.push({ mediaType: item.mediaType, items: [item] });
    }
  }

  return groups;
}

// ─── Scoring (fórmula idêntica ao laboratório HTML) ───────────────────────────

/**
 * rankScore = max(0, 120 - sourceRank * 4)
 * NOTA: sourceRank começa em 1, logo rank 1 → 116, rank 2 → 112, ..., rank 30 → 0
 */
function scoreGroup(items: RawSignalItem[]): number {
  let total = 0;
  for (const item of items) {
    const rankScore = Math.max(0, 120 - item.sourceRank * 4);
    const popScore = Math.min(120, Math.log10(item.metric + 1) * 32);
    total += (rankScore + popScore) * item.signal.weight;
  }
  const uniqueSignals = new Set(items.map((i) => i.signal.id)).size;
  total += (uniqueSignals - 1) * 18;
  return Math.round(total * 10) / 10;
}

function calcConfidence(signalCount: number, ids: TraktIndexIds): number {
  const idCount = Object.values(ids).filter(Boolean).length;
  return Math.min(100, Math.round(42 + signalCount * 12 + idCount * 5));
}

// ─── Interleave ───────────────────────────────────────────────────────────────

function interleave<T extends { mediaType: "movie" | "tv" }>(sorted: T[]): T[] {
  const movies = sorted.filter((g) => g.mediaType === "movie");
  const shows = sorted.filter((g) => g.mediaType === "tv");
  const out: T[] = [];
  const len = Math.max(movies.length, shows.length);
  for (let i = 0; i < len; i++) {
    if (i < movies.length) out.push(movies[i]);
    if (i < shows.length) out.push(shows[i]);
  }
  return out;
}

// ─── Fetch de um sinal ────────────────────────────────────────────────────────

async function fetchSignal(
  signal: TraktIndexSignal,
  opts: Required<TraktIndexOptions>,
): Promise<RawSignalItem[]> {
  const endpoint = signal.period
    ? signal.endpoint.replace("{period}", opts.period)
    : signal.endpoint;

  const params: Record<string, string | number | boolean> = {
    extended: "full,images",
    page: 1,
    limit: opts.limit,
  };

  type Row = TraktTrendingRow | TraktPeriodRow;
  const data = await traktGet<Row[]>(endpoint, { params, ttlSeconds: opts.ttlSeconds });

  if (!Array.isArray(data)) return [];

  const items: RawSignalItem[] = [];
  let rank = 0;

  for (const row of data) {
    rank++;
    const obj = mediaObjFrom(row, signal.kind);
    if (!obj?.ids || !obj.title) continue;

    const metric = metricValue(row, signal.metric);
    items.push({
      signal,
      sourceRank: rank,
      metric,
      obj,
      mediaType: signal.kind === "show" ? "tv" : "movie",
    });
  }

  return items;
}

// ─── Tradução pt-BR ───────────────────────────────────────────────────────────

async function fetchTranslation(
  mediaType: "movie" | "tv",
  ids: TraktIndexIds,
  lang: "pt",
  ttlSeconds: number,
): Promise<TraktTranslationRaw | null> {
  const id = ids.slug ?? ids.trakt;
  if (!id) return null;

  const base = mediaType === "tv" ? "/shows" : "/movies";
  const data = await traktGet<TraktTranslationRaw[]>(
    `${base}/${encodeURIComponent(String(id))}/translations/${lang}`,
    { ttlSeconds },
  );

  if (!Array.isArray(data)) return null;
  // pt-BR preferencial; cai para qualquer variante do idioma.
  const preferredCountry = lang === "pt" ? "br" : null;
  return (
    (preferredCountry
      ? data.find((t) => String(t.country).toLowerCase() === preferredCountry)
      : null) ??
    data.find((t) => String(t.language).toLowerCase() === lang) ??
    data[0] ??
    null
  );
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function mergeIds(idsList: TraktMediaIds[]): TraktIndexIds {
  const merged: TraktIndexIds = {};
  for (const ids of idsList) {
    if (ids.imdb && !merged.imdb) merged.imdb = ids.imdb;
    if (ids.tmdb && !merged.tmdb) merged.tmdb = ids.tmdb;
    if (ids.trakt && !merged.trakt) merged.trakt = ids.trakt;
    if (ids.tvdb && !merged.tvdb) merged.tvdb = ids.tvdb;
    if (ids.slug && !merged.slug) merged.slug = ids.slug;
  }
  return merged;
}

// ─── Função principal ─────────────────────────────────────────────────────────

export async function buildTraktIndex(
  opts: TraktIndexOptions = {},
): Promise<TraktIndexItem[]> {
  const options = { ...DEFAULT_OPTIONS, ...opts };

  const buildStart = Date.now();
  console.log(
    "[trakt-index] build start period=%s limit=%d translationLimit=%d",
    options.period, options.limit, options.translationLimit,
  );

  // 1. Busca todos os sinais em paralelo
  const signalResults = await Promise.allSettled(
    TRAKT_INDEX_SIGNALS.map((s) => fetchSignal(s, options)),
  );

  const flat: RawSignalItem[] = [];
  for (let i = 0; i < signalResults.length; i++) {
    const result = signalResults[i];
    const signal = TRAKT_INDEX_SIGNALS[i];
    if (result.status === "fulfilled") {
      console.log("[trakt-index] signal=%s items=%d", signal.id, result.value.length);
      flat.push(...result.value);
    } else {
      console.warn("[trakt-index] signal=%s error=%s", signal.id,
        result.reason instanceof Error ? result.reason.message : result.reason);
    }
  }

  if (flat.length === 0) return [];

  // 2. Agrupa duplicatas por IDs confiáveis (imdb > tmdb > trakt > tvdb > slug > título+ano)
  const groups = mergeIntoGroups(flat);

  // 2b. Censura formatos não-roteirizados (talk show, variedades, reality, telejornal,
  // game show) do índice de trending/HERO. Usa os gêneros Trakt de qualquer item do grupo.
  const filteredGroups = groups.filter(
    (g) => !g.items.some((i) => isExcludedFormat(i.obj.genres)),
  );

  // 3. Score base + recência ("termômetro vivo") + sort.
  //    Lançamentos/temporadas recentes ganham boost; antigos sem spike vivo são
  //    amortizados para não dominarem por popularidade histórica acumulada.
  const scored = filteredGroups
    .map((g) => {
      const baseScore = scoreGroup(g.items);
      const recency = computeRecency(g, baseScore);
      const finalScore = Math.round((baseScore + recency.recencyScore) * 10) / 10;
      return { ...g, score: finalScore, baseScore, recency };
    })
    .sort((a, b) => b.score - a.score);

  // 4. Interleave filmes/séries (1 filme / 1 série alternado)
  const interleaved = interleave(scored);

  // 5. Monta TOP N
  const top = interleaved.slice(0, options.limit);

  console.log(
    "[trakt-index] raw=%d groups=%d top=%d period=%s ms=%d",
    flat.length, groups.length, top.length, options.period, Date.now() - buildStart,
  );

  // 6. Constrói TraktIndexItem base (descarta itens sem ID estável)
  const items: TraktIndexItem[] = top.map((g, idx): TraktIndexItem | null => {
    // Escolhe o objeto com mais metadados (overview mais longa)
    const best = [...g.items].sort(
      (a, b) => (b.obj.overview?.length ?? 0) - (a.obj.overview?.length ?? 0),
    )[0];
    const obj = best.obj;
    const ids = mergeIds(g.items.map((i) => i.obj.ids));

    // Imagem: varre todos os items do grupo para encontrar a melhor
    const poster =
      pickImage(obj.images?.poster) ??
      g.items.find((i) => i.obj.images?.poster?.length)?.obj.images?.poster?.[0] ??
      null;
    const backdrop =
      pickImage(obj.images?.fanart) ??
      pickImage(obj.images?.thumb) ??
      g.items.find((i) => i.obj.images?.fanart?.length)?.obj.images?.fanart?.[0] ??
      null;

    const tmdbIdNum = syntheticTmdbId(ids);
    if (tmdbIdNum == null) return null;

    const date =
      g.mediaType === "movie"
        ? (obj.released ?? null)
        : (obj.first_aired ?? null);

    const release_date = g.mediaType === "movie" ? (obj.released ?? null) : null;
    const first_air_date =
      g.mediaType === "tv" ? (obj.first_aired?.slice(0, 10) ?? null) : null;

    const uniqueSignalCount = new Set(g.items.map((i) => i.signal.id)).size;
    const confidence = calcConfidence(uniqueSignalCount, ids);

    // Detalhes de cada sinal (equivale ao "items" do JSON de referência)
    const signalItems: TraktIndexItemDetail[] = g.items.map((i) => ({
      signal: i.signal.id,
      label: i.signal.label,
      rank: i.sourceRank,
      metric: i.metric,
      title: i.obj.title,
      year: i.obj.year ?? null,
      ids: mergeIds([i.obj.ids]),
    }));

    return {
      rank: idx + 1,
      score: g.score,
      confidence,
      signalCount: uniqueSignalCount,
      items: signalItems,

      mediaType: g.mediaType,
      tmdb_id: tmdbIdNum,
      media_type: g.mediaType,

      title: obj.title,
      original_title: obj.title,
      year: obj.year ?? null,
      date,
      overview: obj.overview ?? null,
      tagline: obj.tagline ?? null,

      release_date,
      first_air_date,

      poster_path: poster,
      backdrop_path: backdrop,

      vote_average: obj.rating ?? null,
      vote_count: obj.votes ?? null,
      popularity: g.score,
      certification: obj.certification ?? null,
      runtime: obj.runtime ?? null,
      genres: obj.genres ?? [],
      network: obj.network ?? null,
      status: obj.status ?? null,
      trailer: obj.trailer ?? null,

      ids,
      translation: null,
      // Fonte da verdade multilíngue: en-US = original do Trakt; pt-BR preenchido
      // pela etapa de tradução (passo 7) sem inventar texto manualmente.
      localized: {
        "en-US": {
          title: obj.title ?? null,
          overview: obj.overview ?? null,
          tagline: obj.tagline ?? null,
        } satisfies LocalizedCatalogText,
      },
      recency: g.recency,

      poplogId: null,
      externalIds: {
        ...(ids.tmdb ? { tmdbId: ids.tmdb } : {}),
        ...(ids.imdb ? { imdbId: ids.imdb } : {}),
        ...(ids.tvdb ? { tvdbId: ids.tvdb } : {}),
        ...(ids.trakt ? { traktId: ids.trakt } : {}),
        ...(ids.slug ? { slug: ids.slug } : {}),
      },
      identityUsed: "trakt_index" as const,
      linkIdUsed: ids.imdb ?? ids.slug ?? tmdbIdNum,
      hasPoplogId: false as const,
      normalizedFrom: "trakt_index" as const,
      legacyCompatibilityUsed: true as const,
    };
  }).filter((item): item is TraktIndexItem => item !== null);

  // 7. Busca traduções pt-BR para os top N e armazena em `localized['pt-BR']`.
  //    NÃO sobrescreve os campos legados (que ficam no original/en-US): a
  //    projeção por idioma é responsabilidade do consumo, evitando contaminação
  //    de idioma no payload bilíngue cacheado.
  if (options.translationLimit > 0) {
    const toTranslate = items.slice(0, options.translationLimit);
    await Promise.allSettled(
      toTranslate.map(async (item) => {
        const t = await fetchTranslation(item.media_type, item.ids, "pt", options.ttlSeconds);
        if (!t) return;
        const translation: TraktIndexTranslation = {
          title: t.title ?? null,
          overview: t.overview ?? null,
          tagline: t.tagline ?? null,
          language: t.language,
          country: t.country,
        };
        item.translation = translation;
        item.localized = {
          ...item.localized,
          "pt-BR": {
            title: t.title?.trim() ? t.title : null,
            overview: t.overview?.trim() ? t.overview : null,
            tagline: t.tagline?.trim() ? t.tagline : null,
          },
        };
      }),
    );
  }

  console.log(
    "[trakt-index] build done period=%s final=%d ms=%d",
    options.period, items.length, Date.now() - buildStart,
  );

  return items;
}

/** Retorna true se a integração Trakt Index está habilitada. */
export function isTraktIndexEnabled(): boolean {
  const flag = process.env.TRAKT_INDEX_ENABLED;
  if (flag === "false" || flag === "0") return false;
  const traktActive = process.env.TRAKT_ACTIVE;
  if (traktActive === "false" || traktActive === "0") return false;
  return true;
}
