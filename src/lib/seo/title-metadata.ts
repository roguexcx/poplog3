import type { Metadata } from "next";

import type { TitlePageData } from "@/features/title/types";
import { resolveForRender } from "@/lib/images/proxy";
import { legacyTitlePath, publicTitlePathFromSlug } from "@/server/titles/title-public-routes";

type TitleMetadataInput = Pick<TitlePageData, "title"> & Partial<Pick<
  TitlePageData,
  | "originalTitle"
  | "year"
  | "overview"
  | "posterUrl"
  | "backdropUrl"
  | "mediaType"
  | "poplogId"
  | "externalIds"
  | "releaseDate"
  | "firstAirDate"
  | "lastAirDate"
  | "runtime"
  | "episodeRunTimeMinutes"
  | "numberOfSeasons"
  | "numberOfEpisodes"
  | "genres"
  | "certification"
  | "voteAverage"
  | "ratings"
  | "cast"
  | "crew"
  | "metadata"
>>;

type BuildTitleMetadataOptions = {
  language?: string | null;
  region?: string | null;
  imageId?: string | number | null;
  slug?: string | null;
};

export function siteBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

export function absoluteUrl(urlOrPath: string | null | undefined): string | undefined {
  if (!urlOrPath) return undefined;
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  return `${siteBaseUrl()}${urlOrPath.startsWith("/") ? "" : "/"}${urlOrPath}`;
}

function compactDescription(value: string | null | undefined): string | undefined {
  const clean = value?.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length > 155 ? `${clean.slice(0, 152).trim()}...` : clean;
}

function ogLocale(language: string | null | undefined): string {
  return (language || "pt-BR").replace("-", "_");
}

function yearSuffix(title: Pick<TitleMetadataInput, "year">): string {
  return title.year ? ` (${title.year})` : "";
}

export function canonicalTitlePath(title: Pick<TitleMetadataInput, "mediaType" | "poplogId" | "externalIds"> | null, fallbackPath: string): string {
  if (!title?.mediaType) return fallbackPath;
  return (
    publicTitlePathFromSlug(title.externalIds?.slug) ??
    legacyTitlePath({
      mediaType: title.mediaType,
      id: title.poplogId ?? title.externalIds?.imdbId ?? title.externalIds?.tmdbId ?? "",
    })
  );
}

export function buildTitleSocialImagePath(title: TitleMetadataInput | null, options: BuildTitleMetadataOptions = {}): string {
  const params = new URLSearchParams();
  if (title?.mediaType) params.set("mediaType", title.mediaType);
  const id =
    options.imageId ??
    title?.poplogId ??
    title?.externalIds?.imdbId ??
    title?.externalIds?.tmdbId ??
    null;
  if (id != null) params.set("id", String(id));
  const slug = options.slug ?? title?.externalIds?.slug ?? null;
  if (slug) params.set("slug", slug);
  if (options.language) params.set("language", options.language);
  if (options.region) params.set("region", options.region);
  if (title?.title) params.set("title", title.title);
  if (title?.year) params.set("year", String(title.year));
  return `/api/og/title?${params.toString()}`;
}

export function resolveSocialImageUrl(title: TitleMetadataInput | null, options: BuildTitleMetadataOptions = {}): string {
  return absoluteUrl(buildTitleSocialImagePath(title, options)) ?? `${siteBaseUrl()}/api/og/title?fallback=1`;
}

function titleImageCandidates(title: TitleMetadataInput, socialImageUrl: string): string[] {
  return Array.from(new Set([
    socialImageUrl,
    absoluteUrl(resolveForRender(title.posterUrl, "w780")),
    absoluteUrl(resolveForRender(title.backdropUrl, "w1280")),
  ].filter((value): value is string => Boolean(value))));
}

export function buildTitleMetadata(
  title: TitleMetadataInput | null,
  canonicalPath: string,
  options: BuildTitleMetadataOptions = {},
): Metadata {
  if (!title) {
    const fallbackImage = resolveSocialImageUrl(null, options);
    return {
      title: "Titulo",
      alternates: { canonical: absoluteUrl(canonicalPath) ?? canonicalPath },
      openGraph: {
        title: "POPLOG",
        description: "POPLOG: catalogo, disponibilidade e biblioteca pessoal.",
        url: absoluteUrl(canonicalPath) ?? canonicalPath,
        siteName: "POPLOG",
        locale: ogLocale(options.language),
        images: [{ url: fallbackImage, width: 1200, height: 630, alt: "POPLOG" }],
      },
      twitter: {
        card: "summary_large_image",
        title: "POPLOG",
        images: [fallbackImage],
      },
    };
  }

  const pageTitle = `${title.title}${yearSuffix(title)}`;
  const description =
    compactDescription(title.overview) ??
    `${title.title} no POPLOG: detalhes, disponibilidade, biblioteca e recomendacoes.`;
  const canonical = absoluteUrl(canonicalPath) ?? canonicalPath;
  const image = resolveSocialImageUrl(title, options);
  const mediaType = title.mediaType === "tv" ? "video.tv_show" : "video.movie";
  const locale = ogLocale(options.language);

  return {
    title: pageTitle,
    description,
    alternates: { canonical },
    openGraph: {
      title: pageTitle,
      description,
      url: canonical,
      siteName: "POPLOG",
      type: mediaType,
      locale,
      images: [{ url: image, width: 1200, height: 630, alt: pageTitle }],
    },
    twitter: {
      card: "summary_large_image",
      title: pageTitle,
      description,
      images: [image],
    },
  };
}

function isoDurationFromMinutes(minutes: number | null | undefined): string | undefined {
  if (!minutes || minutes <= 0) return undefined;
  const hours = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);
  return `PT${hours > 0 ? `${hours}H` : ""}${mins > 0 ? `${mins}M` : ""}`;
}

function personList(names: Array<string | null | undefined>) {
  return Array.from(new Set(names.map((name) => name?.trim()).filter(Boolean))).map((name) => ({
    "@type": "Person",
    name,
  }));
}

function ratingForTitle(title: TitleMetadataInput) {
  const ratingValue =
    title.voteAverage ??
    title.ratings?.imdbRating ??
    title.ratings?.tmdbRating ??
    null;
  const ratingCount = title.ratings?.imdbVotes ?? undefined;
  if (!ratingValue) return undefined;
  return {
    "@type": "AggregateRating",
    ratingValue: Number(ratingValue.toFixed(1)),
    bestRating: 10,
    worstRating: 0,
    ...(ratingCount ? { ratingCount } : {}),
  };
}

export function buildTitleJsonLd(
  title: TitleMetadataInput,
  canonicalPath: string,
  options: BuildTitleMetadataOptions = {},
) {
  const canonical = absoluteUrl(canonicalPath) ?? canonicalPath;
  const socialImage = resolveSocialImageUrl(title, options);
  const images = titleImageCandidates(title, socialImage);
  const datePublished = title.mediaType === "tv" ? title.firstAirDate : title.releaseDate;
  const directors = personList([
    ...(title.metadata?.directors ?? []),
    ...(title.crew ?? [])
      .filter((member) => /director|diretor/i.test(member.job))
      .map((member) => member.name),
  ]);
  const creators = personList([
    ...(title.metadata?.creators ?? []),
    ...(title.metadata?.showrunners ?? []),
  ]);

  const base = {
    "@context": "https://schema.org",
    "@type": title.mediaType === "tv" ? "TVSeries" : "Movie",
    "@id": `${canonical}#${title.mediaType === "tv" ? "tvseries" : "movie"}`,
    url: canonical,
    mainEntityOfPage: canonical,
    name: title.title,
    ...(title.originalTitle && title.originalTitle !== title.title ? { alternateName: title.originalTitle } : {}),
    ...(title.overview ? { description: title.overview } : {}),
    ...(images.length ? { image: images } : {}),
    ...(datePublished ? { datePublished } : {}),
    ...(title.genres?.length ? { genre: title.genres } : {}),
    ...(title.certification ? { contentRating: title.certification } : {}),
    ...(ratingForTitle(title) ? { aggregateRating: ratingForTitle(title) } : {}),
    ...(title.cast?.length
      ? {
          actor: title.cast.slice(0, 12).map((member) => ({
            "@type": "Person",
            name: member.name,
            ...(member.character ? { characterName: member.character } : {}),
          })),
        }
      : {}),
    ...(directors.length ? { director: directors } : {}),
    ...(title.metadata?.productionCompanies?.length
      ? {
          productionCompany: title.metadata.productionCompanies.slice(0, 8).map((company) => ({
            "@type": "Organization",
            name: company.name,
          })),
        }
      : {}),
    ...(title.externalIds?.imdbId ? { sameAs: [`https://www.imdb.com/title/${title.externalIds.imdbId}/`] } : {}),
  };

  if (title.mediaType === "tv") {
    return {
      ...base,
      ...(title.firstAirDate ? { startDate: title.firstAirDate } : {}),
      ...(title.lastAirDate ? { endDate: title.lastAirDate } : {}),
      ...(title.numberOfSeasons ? { numberOfSeasons: title.numberOfSeasons } : {}),
      ...(title.numberOfEpisodes ? { numberOfEpisodes: title.numberOfEpisodes } : {}),
      ...(title.episodeRunTimeMinutes ? { timeRequired: isoDurationFromMinutes(title.episodeRunTimeMinutes) } : {}),
      ...(creators.length ? { creator: creators } : {}),
      ...(title.metadata?.networks?.length
        ? {
            broadcaster: title.metadata.networks.slice(0, 4).map((network) => ({
              "@type": "Organization",
              name: network.name,
            })),
          }
        : {}),
    };
  }

  return {
    ...base,
    ...(title.runtime ? { duration: isoDurationFromMinutes(title.runtime) } : {}),
  };
}

export function jsonLdScriptContent(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
