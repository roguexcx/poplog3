import { resolveCatalogImage } from "@/lib/images/resolve";
import type {
  CatalogIds,
  CatalogEpisode,
  EpisodeImageCandidate,
  EpisodeTextCandidate,
} from "../types/catalog.types";
import type { SourceMeta } from "../types/source.types";

type NormalizeEpisodeInput = {
  ids: CatalogIds;
  season: number;
  number: number;
  absoluteNumber?: number;
  title?: string;
  originalTitle?: string;
  overview?: string;
  originalOverview?: string;
  titleLanguage?: string;
  overviewLanguage?: string;
  textLanguage?: string;
  firstAired?: string;
  runtime?: number;
  episodeType?: string;
  voteAverage?: number;
  voteCount?: number;
  stillRemoteUrl?: string;
  stillSource?: EpisodeImageCandidate["source"];
  stillWidth?: number;
  stillHeight?: number;
  stillLanguage?: string;
  imageCandidates?: EpisodeImageCandidate[];
  textCandidates?: EpisodeTextCandidate[];
};

function sourceFromMeta(meta: SourceMeta): EpisodeImageCandidate["source"] | undefined {
  return meta.primary === "tvdb" || meta.primary === "trakt" || meta.primary === "balloonerismm"
    ? meta.primary
    : undefined;
}

function compactText(value?: string | null): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

export function normalizeEpisodeStillUrl(
  value: string | null | undefined,
  source?: EpisodeImageCandidate["source"],
): string | undefined {
  if (!value || value.trim() === "") return undefined;
  const raw = value.trim();
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(raw)) return `https://${raw}`;
  // TVDB returns relative paths under /banners/ — prefix with the TVDB image CDN domain
  if (source === "tvdb" && raw.startsWith("/")) {
    return `https://artworks.thetvdb.com${raw}`;
  }
  if (source === "balloonerismm" || raw.startsWith("/")) {
    return resolveCatalogImage(raw, "original") ?? undefined;
  }
  return raw;
}

export function normalizeEpisode(input: NormalizeEpisodeInput, meta: SourceMeta): CatalogEpisode {
  const stillSource = input.stillSource ?? sourceFromMeta(meta);
  const stillUrl = normalizeEpisodeStillUrl(input.stillRemoteUrl, stillSource);
  const imageCandidates = [
    ...(input.imageCandidates ?? []).map((candidate) => ({
      ...candidate,
      url: normalizeEpisodeStillUrl(candidate.url, candidate.source) ?? candidate.url,
    })),
    ...(stillUrl && stillSource
      ? [{
          source: stillSource,
          url: stillUrl,
          width: input.stillWidth,
          height: input.stillHeight,
          language: input.stillLanguage,
          kind: "episode-still",
          confidence: meta.confidence === "high" ? "high" as const : "medium" as const,
        }]
      : []),
  ];

  const textSource: EpisodeTextCandidate["source"] | undefined =
    meta.primary === "tvdb" || meta.primary === "trakt" || meta.primary === "balloonerismm"
      ? meta.primary
      : undefined;
  const language = input.textLanguage ?? input.titleLanguage ?? input.overviewLanguage;
  const generatedTextCandidates: EpisodeTextCandidate[] = [];
  if (textSource) {
    const title = compactText(input.title);
    const overview = compactText(input.overview);
    const originalTitle = compactText(input.originalTitle);
    const originalOverview = compactText(input.originalOverview);
    const confidence = meta.confidence === "high" ? "high" as const : "medium" as const;
    if (title || originalTitle) {
      generatedTextCandidates.push({
        source: textSource,
        title,
        originalTitle,
        language: input.titleLanguage ?? input.textLanguage,
        confidence,
      });
    }
    if (overview || originalOverview) {
      generatedTextCandidates.push({
        source: textSource,
        overview,
        originalOverview,
        language: input.overviewLanguage ?? input.textLanguage,
        confidence,
      });
    }
  }

  const textCandidates = [
    ...(input.textCandidates ?? []),
    ...generatedTextCandidates,
  ];

  return {
    ids: input.ids,
    season: input.season,
    number: input.number,
    absoluteNumber: input.absoluteNumber,
    title: compactText(input.title),
    originalTitle: compactText(input.originalTitle),
    overview: compactText(input.overview),
    originalOverview: compactText(input.originalOverview),
    firstAired: input.firstAired,
    runtime: input.runtime,
    episodeType: input.episodeType,
    voteAverage: input.voteAverage,
    voteCount: input.voteCount,
    stillPath: stillUrl ?? input.stillRemoteUrl,
    stillUrl,
    stillSource,
    stillWidth: input.stillWidth,
    stillHeight: input.stillHeight,
    stillLanguage: input.stillLanguage,
    textLanguage: language,
    titleLanguage: input.titleLanguage ?? language,
    overviewLanguage: input.overviewLanguage ?? language,
    sourcePriority: [meta.primary],
    imageCandidates,
    textCandidates,
    discardedCandidates: [],
    source: { ...meta, fetchedAt: meta.fetchedAt ?? new Date().toISOString() },
  };
}
