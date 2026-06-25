import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";

import TitlePageView from "@/features/title/TitlePageView";
import {
  buildTitleJsonLd,
  buildTitleMetadata,
  canonicalTitlePath,
  jsonLdScriptContent,
} from "@/lib/seo/title-metadata";
import { getTitlePageData } from "@/server/titles/get-title-page-data";
import { getPoplogTitleDetails } from "@/server/titles/poplog-title-details";
import {
  resolvePoplogTitleIdentity,
  type PoplogTitleIdentity,
} from "@/server/titles/poplog-title-identity";
import {
  legacyTitlePath,
  normalizePublicTitleSlug,
  publicTitlePathFromSlug,
} from "@/server/titles/title-public-routes";
import { normalizeCatalogLanguage, normalizeCatalogRegion } from "@/server/source-engine/locale";

type PageProps = {
  params: Promise<{ slug: string }>;
};

async function resolveSlug(slug: string): Promise<PoplogTitleIdentity | null> {
  const clean = normalizePublicTitleSlug(slug);
  if (!clean) return null;

  for (const mediaType of ["movie", "tv"] as const) {
    const identity = await resolvePoplogTitleIdentity({
      mediaType,
      id: clean,
      sourceHint: "slug",
    }).catch(() => null);

    if (identity?.poplogId || identity?.externalIds.imdbId || (identity?.confidence ?? 0) >= 0.8) {
      return identity;
    }
  }

  return null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const identity = await resolveSlug(slug);
  if (!identity) return { title: "Titulo" };

  const cookieStore = await cookies();
  const language = normalizeCatalogLanguage(cookieStore.get("poplog_catalog_language")?.value);
  const region = normalizeCatalogRegion(cookieStore.get("poplog_region")?.value);
  const resolvedId = String(identity.poplogId ?? identity.externalIds.imdbId ?? slug);
  const details = await getPoplogTitleDetails({
    mediaType: identity.mediaType,
    id: resolvedId,
    sourceHint: identity.poplogId ? "poplog" : identity.externalIds.imdbId ? "imdb" : "slug",
    region,
    locale: language,
  }).catch(() => null);

  const metadataTitle = details ? {
    mediaType: details.mediaType,
    poplogId: details.poplogId ?? null,
    externalIds: details.externalIds,
    title: details.title,
    originalTitle: details.originalTitle ?? null,
    year: details.year ?? null,
    overview: details.overview ?? null,
    posterUrl: details.posterUrl ?? null,
    backdropUrl: details.backdropUrl ?? null,
    releaseDate: details.releaseDate ?? null,
    runtime: details.runtime ?? null,
    voteAverage: details.voteAverage ?? null,
    genres: details.genres ?? [],
  } : identity.title ? {
    mediaType: identity.mediaType,
    poplogId: identity.poplogId ?? null,
    externalIds: identity.externalIds,
    title: identity.title,
    year: identity.year ?? null,
  } : null;

  const canonicalPath = canonicalTitlePath(
    metadataTitle,
    publicTitlePathFromSlug(identity.externalIds.slug ?? slug) ??
      legacyTitlePath({ mediaType: identity.mediaType, id: identity.poplogId ?? identity.externalIds.imdbId ?? slug }),
  );

  return buildTitleMetadata(metadataTitle, canonicalPath, {
    language,
    region,
    imageId: metadataTitle?.poplogId ?? metadataTitle?.externalIds?.imdbId ?? resolvedId,
    slug: metadataTitle?.externalIds?.slug ?? slug,
  });
}

export default async function PublicSlugTitlePage({ params }: PageProps) {
  const { slug } = await params;
  const clean = normalizePublicTitleSlug(slug);
  if (!clean) notFound();

  const identity = await resolveSlug(clean);
  if (!identity) notFound();

  const canonicalPath = publicTitlePathFromSlug(identity.externalIds.slug ?? clean);
  if (canonicalPath && canonicalPath !== `/${clean}`) {
    permanentRedirect(canonicalPath);
  }

  const id = String(identity.poplogId ?? identity.externalIds.imdbId ?? clean);
  const sourceHint = identity.poplogId ? "poplog" : identity.externalIds.imdbId ? "imdb" : "slug";
  const title = await getTitlePageData({
    mediaType: identity.mediaType,
    id,
    sourceHint,
  });

  if (!title) notFound();

  const titleCanonicalPath = canonicalTitlePath(
    title,
    publicTitlePathFromSlug(identity.externalIds.slug ?? clean) ??
      legacyTitlePath({ mediaType: title.mediaType, id: title.poplogId ?? title.externalIds?.imdbId ?? clean }),
  );
  const jsonLd = buildTitleJsonLd(title, titleCanonicalPath, {
    language: "pt-BR",
    region: title.country ?? "BR",
    imageId: title.poplogId ?? title.externalIds?.imdbId ?? clean,
    slug: title.externalIds?.slug ?? clean,
  });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScriptContent(jsonLd) }} />
      <TitlePageView title={title} />
    </>
  );
}
