/**
 * Canonical episode merge utility.
 * Combines episode arrays from multiple sources into a single deduplicated list.
 *
 * Priority rules per field:
 *   stillPath   : tvdb > balloonerismm > trakt  (trakt has no stills)
 *   firstAired  : trakt > tvdb > balloonerismm  (trakt has precise UTC timestamps)
 *   title       : first non-placeholder
 *   overview    : first non-null
 *   runtime     : first non-null
 *   ids         : union (preserves source-specific IDs across sources)
 *
 * Gap fill: episodes present in lower-priority sources but missing from higher-priority
 * ones are included — no data is discarded just because one source lacks it.
 */

import type {
  CatalogEpisode,
  EpisodeImageCandidate,
  EpisodeTextCandidate,
} from "../types/catalog.types";

const PLACEHOLDER_TITLE_RE = /^(Episode #\d+\.\d+|Episode \d+|Epis[oó]dio \d+)$/i;

function isPlaceholder(title?: string | null): boolean {
  return !title || PLACEHOLDER_TITLE_RE.test(title);
}

function normalizeTitle(title?: string | null): string {
  return String(title ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type MergedCatalogEpisode = CatalogEpisode & {
  /** Names of all sources that contributed data to this episode. */
  mergedFrom: string[];
};

const PT_BR_LANGS = new Set(["pt-br", "pt_br", "por-br", "por_br"]);
const EN_LANGS = new Set(["en", "eng", "en-us", "en-gb"]);

function localeRank(candidate: EpisodeTextCandidate): number {
  const lang = candidate.language?.toLowerCase();
  const country = candidate.country?.toLowerCase();
  if (!lang) return 80;
  if (PT_BR_LANGS.has(lang)) return 0;
  if ((lang === "pt" || lang === "por") && country === "br") return 1;
  if (lang === "por") return 2;
  if (lang === "pt") return 3;
  if (EN_LANGS.has(lang)) return 8;
  return 50;
}

function sourceTextRank(source: string): number {
  if (source === "tvdb") return 0;
  if (source === "balloonerismm") return 1;
  if (source === "trakt") return 2;
  return 9;
}

function stillRank(candidate: EpisodeImageCandidate): number {
  const source =
    candidate.source === "tvdb" ? 0
    : candidate.source === "trakt" ? 1
    : candidate.source === "balloonerismm" ? 2
    : 9;
  const completeness =
    candidate.width && candidate.height ? 0
    : candidate.width || candidate.height ? 1
    : 2;
  const area = (candidate.width ?? 0) * (candidate.height ?? 0);
  return source * 100_000 + completeness * 10_000 - Math.min(area, 9_999);
}

function textCandidatesFrom(ep?: CatalogEpisode | null): EpisodeTextCandidate[] {
  if (!ep) return [];
  const source = ep.source.primary as EpisodeTextCandidate["source"];
  const candidates = [...(ep.textCandidates ?? [])];
  if (candidates.length > 0) return candidates;
  if ((source === "tvdb" || source === "trakt" || source === "balloonerismm") && (ep.title || ep.overview || ep.originalTitle || ep.originalOverview)) {
    candidates.push({
      source,
      title: ep.title,
      originalTitle: ep.originalTitle,
      overview: ep.overview,
      originalOverview: ep.originalOverview,
      language: ep.textLanguage ?? ep.titleLanguage ?? ep.overviewLanguage,
      confidence: ep.source.confidence === "high" ? "high" : "medium",
    });
  }
  return candidates;
}

function imageCandidatesFrom(ep?: CatalogEpisode | null): EpisodeImageCandidate[] {
  if (!ep) return [];
  const candidates = [...(ep.imageCandidates ?? [])];
  if (candidates.length > 0) {
    return candidates.filter((candidate, index, arr) =>
      candidate.url && arr.findIndex((other) => other.url === candidate.url) === index,
    );
  }
  const source = ep.stillSource ?? (
    ep.source.primary === "tvdb" || ep.source.primary === "trakt" || ep.source.primary === "balloonerismm"
      ? ep.source.primary
      : undefined
  );
  // stillUrl é o campo de entrada canônico, mas stillPath também é uma referência
  // de imagem válida (normalize-episode grava ambos). Usar stillPath como fallback
  // evita perder silenciosamente a still quando só ele está preenchido.
  const stillRef = ep.stillUrl ?? ep.stillPath;
  if (stillRef && source) {
    candidates.push({
      source,
      url: stillRef,
      width: ep.stillWidth,
      height: ep.stillHeight,
      language: ep.stillLanguage,
      kind: "episode-still",
      confidence: ep.source.confidence === "high" ? "high" : "medium",
    });
  }
  return candidates.filter((candidate, index, arr) =>
    candidate.url && arr.findIndex((other) => other.url === candidate.url) === index,
  );
}

export function resolveEpisodeText(input: {
  tvdbEpisode?: CatalogEpisode | null;
  traktEpisode?: CatalogEpisode | null;
  balloonEpisode?: CatalogEpisode | null;
  preferredLocale?: "pt-BR" | string;
}): Pick<
  CatalogEpisode,
  "title" | "originalTitle" | "overview" | "originalOverview" | "textLanguage" | "titleLanguage" | "overviewLanguage" | "textCandidates" | "discardedCandidates"
> {
  const candidates = [
    ...textCandidatesFrom(input.tvdbEpisode),
    ...textCandidatesFrom(input.traktEpisode),
    ...textCandidatesFrom(input.balloonEpisode),
  ].filter((candidate) => candidate.title || candidate.overview || candidate.originalTitle || candidate.originalOverview);

  const sorted = [...candidates].sort((a, b) =>
    localeRank(a) - localeRank(b) ||
    sourceTextRank(a.source) - sourceTextRank(b.source)
  );

  const bestTitle = sorted.find((candidate) => candidate.title && !isPlaceholder(candidate.title))
    ?? sorted.find((candidate) => candidate.title);
  const bestOverview = sorted.find((candidate) => candidate.overview);
  const originalTitle = sorted.find((candidate) =>
    candidate.originalTitle || (candidate.title && EN_LANGS.has((candidate.language ?? "").toLowerCase()))
  );
  const originalOverview = sorted.find((candidate) =>
    candidate.originalOverview || (candidate.overview && EN_LANGS.has((candidate.language ?? "").toLowerCase()))
  );

  const chosenSource = bestTitle?.source ?? bestOverview?.source;
  const discardedCandidates = sorted
    .filter((candidate) => candidate.source !== chosenSource)
    .map((candidate) => ({
      field: "text",
      source: candidate.source,
      reason: localeRank(candidate) > localeRank(bestTitle ?? bestOverview ?? candidate)
        ? "idioma com prioridade menor que pt-BR"
        : "fonte com prioridade menor para o mesmo idioma",
    }));

  return {
    title: bestTitle?.title,
    originalTitle: originalTitle?.originalTitle ?? originalTitle?.title,
    overview: bestOverview?.overview,
    originalOverview: originalOverview?.originalOverview ?? originalOverview?.overview,
    textLanguage: bestTitle?.language ?? bestOverview?.language,
    titleLanguage: bestTitle?.language,
    overviewLanguage: bestOverview?.language,
    textCandidates: candidates,
    discardedCandidates,
  };
}

export function resolveEpisodeStill(input: {
  tvdbEpisode?: CatalogEpisode | null;
  traktEpisode?: CatalogEpisode | null;
  balloonEpisode?: CatalogEpisode | null;
}): Pick<
  CatalogEpisode,
  "stillPath" | "stillUrl" | "stillSource" | "stillWidth" | "stillHeight" | "stillLanguage" | "imageCandidates" | "discardedCandidates"
> {
  const candidates = [
    ...imageCandidatesFrom(input.tvdbEpisode),
    ...imageCandidatesFrom(input.traktEpisode),
    ...imageCandidatesFrom(input.balloonEpisode),
  ];
  const best = [...candidates].sort((a, b) => stillRank(a) - stillRank(b))[0];
  return {
    stillPath: best?.url,
    stillUrl: best?.url,
    stillSource: best?.source,
    stillWidth: best?.width,
    stillHeight: best?.height,
    stillLanguage: best?.language,
    imageCandidates: candidates,
    discardedCandidates: candidates
      .filter((candidate) => candidate.url !== best?.url)
      .map((candidate) => ({
        field: "still",
        source: candidate.source,
        reason: best ? "still de fonte ou completude inferior" : "sem still válida",
      })),
  };
}

function episodeKey(ep: CatalogEpisode): string {
  return `${ep.season}:${ep.number}`;
}

function externalIdKeys(ep: CatalogEpisode): string[] {
  return [
    ep.ids.imdbId ? `imdb:${ep.ids.imdbId}` : null,
    ep.ids.tvdbId ? `tvdb:${ep.ids.tvdbId}` : null,
    ep.ids.traktId ? `trakt:${ep.ids.traktId}` : null,
    ep.ids.tmdbId ? `tmdb:${ep.ids.tmdbId}` : null,
    ep.ids.balloonerismmId ? `balloonerismm:${ep.ids.balloonerismmId}` : null,
  ].filter((key): key is string => Boolean(key));
}

function fallbackDedupKey(ep: CatalogEpisode): string | null {
  const title = normalizeTitle(ep.title);
  const airDate = ep.firstAired?.slice(0, 10);
  if (!title || !airDate) return null;
  return `fallback:${ep.season}:${airDate}:${title}`;
}

function absoluteKey(ep: CatalogEpisode): string | null {
  return ep.absoluteNumber ? `absolute:${ep.absoluteNumber}` : null;
}

function findExistingKey(
  episode: CatalogEpisode,
  map: Map<string, MergedCatalogEpisode>,
  idIndex: Map<string, string>,
  fallbackIndex: Map<string, string>,
  absoluteIndex: Map<string, string>,
): string | undefined {
  for (const idKey of externalIdKeys(episode)) {
    const indexed = idIndex.get(idKey);
    if (indexed) return indexed;
  }

  const direct = episodeKey(episode);
  if (map.has(direct)) return direct;

  const fallback = fallbackDedupKey(episode);
  const byFallback = fallback ? fallbackIndex.get(fallback) : undefined;
  if (byFallback) return byFallback;

  const absolute = absoluteKey(episode);
  return absolute ? absoluteIndex.get(absolute) : undefined;
}

function indexEpisode(
  key: string,
  episode: CatalogEpisode,
  idIndex: Map<string, string>,
  fallbackIndex: Map<string, string>,
  absoluteIndex: Map<string, string>,
) {
  for (const idKey of externalIdKeys(episode)) {
    idIndex.set(idKey, key);
  }

  const fallback = fallbackDedupKey(episode);
  if (fallback) fallbackIndex.set(fallback, key);
  const absolute = absoluteKey(episode);
  if (absolute) absoluteIndex.set(absolute, key);
}

/**
 * Merges two episodes where `hi` has higher source priority than `lo`.
 * Most fields: hi wins; gaps filled by lo.
 * Exception: firstAired prefers Trakt regardless of priority order.
 */
function mergePair(hi: CatalogEpisode, lo: CatalogEpisode): MergedCatalogEpisode {
  const hiSrc = hi.source.primary;
  const loSrc = lo.source.primary;

  // firstAired: Trakt timestamps are UTC-precise; prefer unconditionally
  const traktEp = hiSrc === "trakt" ? hi : loSrc === "trakt" ? lo : null;
  const firstAired = traktEp?.firstAired ?? hi.firstAired ?? lo.firstAired;

  const tvdbEp = hiSrc === "tvdb" ? hi : loSrc === "tvdb" ? lo : null;
  const traktEpForMerge = hiSrc === "trakt" ? hi : loSrc === "trakt" ? lo : null;
  const balEp = hiSrc === "balloonerismm" ? hi : loSrc === "balloonerismm" ? lo : null;
  const text = resolveEpisodeText({ tvdbEpisode: tvdbEp, traktEpisode: traktEpForMerge, balloonEpisode: balEp, preferredLocale: "pt-BR" });
  const still = resolveEpisodeStill({ tvdbEpisode: tvdbEp, traktEpisode: traktEpForMerge, balloonEpisode: balEp });

  const title = !isPlaceholder(text.title)
    ? text.title
    : !isPlaceholder(hi.title)
      ? hi.title
      : !isPlaceholder(lo.title)
        ? lo.title
        : text.title ?? hi.title;

  const hiMergedFrom = (hi as MergedCatalogEpisode).mergedFrom ?? [hiSrc];
  const loMergedFrom = (lo as MergedCatalogEpisode).mergedFrom ?? [loSrc];

  // episodeType: Trakt is the authoritative source for episode type classification
  const episodeType = traktEpForMerge?.episodeType ?? hi.episodeType ?? lo.episodeType;

  // voteAverage/voteCount: prefer Trakt (community ratings), then any source
  const voteAverage = traktEpForMerge?.voteAverage ?? hi.voteAverage ?? lo.voteAverage;
  const voteCount = traktEpForMerge?.voteCount ?? hi.voteCount ?? lo.voteCount;

  return {
    ids: {
      ...lo.ids,
      ...hi.ids,
      tvdbId: hi.ids.tvdbId ?? lo.ids.tvdbId,
      traktId: hi.ids.traktId ?? lo.ids.traktId,
      tmdbId: hi.ids.tmdbId ?? lo.ids.tmdbId,
      imdbId: hi.ids.imdbId ?? lo.ids.imdbId,
    },
    season: hi.season,
    number: hi.number,
    absoluteNumber: hi.absoluteNumber ?? lo.absoluteNumber,
    title,
    originalTitle: text.originalTitle ?? hi.originalTitle ?? lo.originalTitle,
    overview: text.overview ?? hi.overview ?? lo.overview,
    originalOverview: text.originalOverview ?? hi.originalOverview ?? lo.originalOverview,
    firstAired,
    runtime: hi.runtime ?? lo.runtime,
    episodeType,
    voteAverage,
    voteCount,
    stillPath: still.stillPath,
    stillUrl: still.stillUrl,
    stillSource: still.stillSource,
    stillWidth: still.stillWidth,
    stillHeight: still.stillHeight,
    stillLanguage: still.stillLanguage,
    textLanguage: text.textLanguage,
    titleLanguage: text.titleLanguage,
    overviewLanguage: text.overviewLanguage,
    sourcePriority: ["tvdb", "trakt", "balloonerismm"].filter((source) => [hiSrc, loSrc].includes(source)),
    imageCandidates: still.imageCandidates,
    textCandidates: text.textCandidates,
    discardedCandidates: [
      ...(text.discardedCandidates ?? []),
      ...(still.discardedCandidates ?? []),
    ],
    source: hi.source,
    mergedFrom: [...new Set([...hiMergedFrom, ...loMergedFrom])].filter(Boolean),
  };
}

/**
 * Merges episode arrays from multiple sources.
 *
 * Arguments are in **priority order**: first argument = highest priority.
 * Episodes are deduplicated by (season, number).
 * Episodes absent in higher-priority sources are still included from lower ones (gap fill).
 *
 * @example
 * // TVDB wins for stills; Trakt wins for dates; both cover episode gaps
 * const merged = mergeEpisodeSources(tvdbEps, traktEps);
 */
export function mergeEpisodeSources(...sources: CatalogEpisode[][]): MergedCatalogEpisode[] {
  const map = new Map<string, MergedCatalogEpisode>();
  const idIndex = new Map<string, string>();
  const fallbackIndex = new Map<string, string>();
  const absoluteIndex = new Map<string, string>();

  // Process from lowest to highest priority so higher-priority episodes overwrite lower ones
  for (let i = sources.length - 1; i >= 0; i--) {
    for (const ep of sources[i]) {
      if (ep.number <= 0) continue;
      const key = findExistingKey(ep, map, idIndex, fallbackIndex, absoluteIndex) ?? episodeKey(ep);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...ep, mergedFrom: [ep.source.primary] });
        indexEpisode(key, ep, idIndex, fallbackIndex, absoluteIndex);
      } else {
        // ep (index i) has higher priority than existing (added at i+1..n)
        const merged = mergePair(ep, existing);
        map.set(key, merged);
        indexEpisode(key, merged, idIndex, fallbackIndex, absoluteIndex);
      }
    }
  }

  return [...map.values()].sort((a, b) =>
    a.season !== b.season ? a.season - b.season : a.number - b.number,
  );
}

export const mergeEpisodeCandidates = mergeEpisodeSources;
