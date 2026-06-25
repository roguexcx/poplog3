import { uiMessage } from "@/lib/i18n/ui-message";
import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, permanentRedirect } from "next/navigation";
import ActionButton from "@/components/ui/ActionButton";
import EmptyState from "@/components/ui/EmptyState";
import TitlePageView from "@/features/title/TitlePageView";
import {
    buildTitleJsonLd,
    buildTitleMetadata,
    canonicalTitlePath,
    jsonLdScriptContent,
} from "@/lib/seo/title-metadata";
import { getTitlePageData } from "@/server/titles/get-title-page-data";
import { getPoplogTitleDetails } from "@/server/titles/poplog-title-details";
import { formatDuration, logger } from "@/server/logging/logger";
import { resolvePoplogTitleIdentity, type PoplogTitleSourceHint, } from "@/server/titles/poplog-title-identity";
import { legacyTitlePath, publicTitlePathFromSlug, } from "@/server/titles/title-public-routes";
import { normalizeCatalogLanguage, normalizeCatalogRegion } from "@/server/source-engine/locale";
type MediaType = "movie" | "tv";
type PageProps = {
    params: Promise<{
        mediaType: MediaType;
        id: string;
    }>;
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
};
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { mediaType, id } = await params;
    if (mediaType !== "movie" && mediaType !== "tv") {
        return { title: uiMessage("ui.98a5efa60beb") };
    }
    const cookieStore = await cookies();
    const language = normalizeCatalogLanguage(cookieStore.get("poplog_catalog_language")?.value);
    const region = normalizeCatalogRegion(cookieStore.get("poplog_region")?.value);
    const localIdentity = await resolvePoplogTitleIdentity({
        mediaType,
        id,
        sourceHint: "auto",
    }).catch(() => null);
    const resolvedMediaType = localIdentity?.mediaType ?? mediaType;
    const resolvedId = String(localIdentity?.poplogId ?? localIdentity?.externalIds.imdbId ?? id);
    const title = await getPoplogTitleDetails({
        mediaType: resolvedMediaType,
        id: resolvedId,
        sourceHint: "auto",
        region,
        locale: language,
    }).catch(() => null);
    const metadataTitle = title ? {
        mediaType: title.mediaType,
        poplogId: title.poplogId ?? null,
        externalIds: title.externalIds,
        title: title.title,
        originalTitle: title.originalTitle ?? null,
        year: title.year ?? null,
        overview: title.overview ?? null,
        posterUrl: title.posterUrl ?? null,
        backdropUrl: title.backdropUrl ?? null,
        releaseDate: title.releaseDate ?? null,
        firstAirDate: null,
        runtime: title.runtime ?? null,
        voteAverage: title.voteAverage ?? null,
        genres: title.genres ?? [],
    } : localIdentity?.title ? {
        mediaType: localIdentity.mediaType,
        poplogId: localIdentity.poplogId ?? null,
        externalIds: localIdentity.externalIds,
        title: localIdentity.title,
        year: localIdentity.year ?? null,
    } : null;
    const fallbackPath = legacyTitlePath({ mediaType: metadataTitle?.mediaType ?? mediaType, id: metadataTitle?.poplogId ?? id });
    const canonicalPath = canonicalTitlePath(metadataTitle, fallbackPath);
    return buildTitleMetadata(title ? {
        mediaType: title.mediaType,
        poplogId: title.poplogId ?? null,
        externalIds: title.externalIds,
        title: title.title,
        originalTitle: title.originalTitle ?? null,
        year: title.year ?? null,
        overview: title.overview ?? null,
        posterUrl: title.posterUrl ?? null,
        backdropUrl: title.backdropUrl ?? null,
        releaseDate: title.releaseDate ?? null,
        runtime: title.runtime ?? null,
        voteAverage: title.voteAverage ?? null,
        genres: title.genres ?? [],
    } : metadataTitle, canonicalPath, {
        language,
        region,
        imageId: metadataTitle?.poplogId ?? metadataTitle?.externalIds?.imdbId ?? id,
        slug: metadataTitle?.externalIds?.slug ?? null,
    });
}
function pickFlag(value: string | string[] | undefined): boolean {
    if (Array.isArray(value))
        return value.some((v) => v === "1" || v === "true");
    return value === "1" || value === "true";
}
export default async function TitlePage({ params, searchParams }: PageProps) {
    const startedAt = Date.now();
    const { mediaType, id } = await params;
    const resolvedSearch = searchParams ? await searchParams : undefined;
    const refresh = pickFlag(resolvedSearch?.refresh) || pickFlag(resolvedSearch?.force);
    const sourceHint = Array.isArray(resolvedSearch?.sourceHint)
        ? resolvedSearch?.sourceHint[0]
        : resolvedSearch?.sourceHint;
    if (mediaType !== "movie" && mediaType !== "tv") {
        return (<section className="px-4 py-10 sm:px-6 md:px-10">
        <EmptyState kicker="Rota invalida" title={uiMessage("ui.110c405bba79")} description={uiMessage("ui.64084f1d9199")} accent="rose"/>
      </section>);
    }
    if (!id?.trim()) {
        return (<section className="px-4 py-10 sm:px-6 md:px-10">
        <EmptyState kicker="ID invalido" title={uiMessage("ui.310ab52b9602")} description={uiMessage("ui.cd8e4f045232")} accent="rose" action={<Link href="/buscar">
              <ActionButton variant="primary">{uiMessage("ui.8f1a85bb1fef")}</ActionButton>
            </Link>}/>
      </section>);
    }
    if (!refresh) {
        const localIdentity = await resolvePoplogTitleIdentity({
            mediaType,
            id,
            sourceHint: (sourceHint ?? "auto") as PoplogTitleSourceHint,
        }).catch(() => null);
        const publicSlugPath = publicTitlePathFromSlug(localIdentity?.externalIds.slug);
        if (publicSlugPath) {
            permanentRedirect(publicSlugPath);
        }
        const canonicalId = localIdentity?.poplogId ? String(localIdentity.poplogId) : null;
        if (canonicalId) {
            const canonicalPath = `/title/${localIdentity?.mediaType ?? mediaType}/${canonicalId}`;
            const currentPath = `/title/${mediaType}/${id}`;
            if (canonicalPath !== currentPath) {
                permanentRedirect(canonicalPath);
            }
        }
    }
    const title = await getTitlePageData({
        mediaType,
        id,
        sourceHint: (sourceHint ?? "auto") as PoplogTitleSourceHint,
        force: refresh,
    });
    // Normalização da URL canônica:
    // A URL oficial é sempre /title/{resolvedMediaType}/{poplogId}. Qualquer alias
    // redireciona uma única vez para o caminho resolvido, incluindo correção movie/tv.
    if (title?.poplogId) {
        const publicSlugPath = publicTitlePathFromSlug(title.externalIds?.slug);
        if (publicSlugPath && !refresh) {
            permanentRedirect(publicSlugPath);
        }
        const canonicalId = String(title.poplogId);
        const canonicalPath = `/title/${title.mediaType}/${canonicalId}`;
        const currentPath = `/title/${mediaType}/${id}`;
        if (canonicalId && canonicalPath !== currentPath && !refresh) {
            permanentRedirect(canonicalPath);
        }
    }
    else {
        // Fallback legado: se não há poplogId mas há um tmdbId positivo diferente do
        // id solicitado (ex: chegou por sintético negativo), redireciona para o tmdbId.
        const requestedNumeric = parseInt(id, 10);
        const canonicalTmdbId = title?.externalIds?.tmdbId;
        if (title &&
            typeof canonicalTmdbId === "number" &&
            canonicalTmdbId > 0 &&
            Number.isInteger(requestedNumeric) &&
            requestedNumeric < 0 &&
            canonicalTmdbId !== requestedNumeric) {
            const canonicalPath = `/title/${title.mediaType}/${canonicalTmdbId}`;
            const currentPath = `/title/${mediaType}/${id}`;
            if (canonicalPath !== currentPath && !refresh) {
                redirect(canonicalPath);
            }
        }
    }
    if (!title) {
        logger.warn(`[PAGE] /title/${mediaType}/${id} | failed | ${formatDuration(Date.now() - startedAt)}`);
        return (<section className="px-4 py-10 sm:px-6 md:px-10">
        <EmptyState kicker="Sem dados" title={uiMessage("ui.20ab66e32e83")} description={uiMessage("ui.eb187cee8966")} accent="rose" action={<Link href="/buscar">
              <ActionButton variant="primary">{uiMessage("ui.8f1a85bb1fef")}</ActionButton>
            </Link>}/>
      </section>);
    }
    logger.info(`[PAGE] /title/${mediaType}/${id} | ok | ${formatDuration(Date.now() - startedAt)}`);
    const titleCache = title.cacheInfo?.title;
    logger.info(`[ENGINE] resolved title | source=${titleCache?.source ?? "unknown"} | cache=${titleCache?.status ?? "unknown"} | persisted=${Boolean(title.poplogId || title.externalIds?.imdbId)}`);
    logger.info(`[RATINGS] loaded | userRating=${title.userState?.userRating == null ? "none" : "ok"} | aggregate=${title.communityRating == null && title.ratings == null ? "none" : "ok"}`);
    const canonicalPath = canonicalTitlePath(title, legacyTitlePath({ mediaType: title.mediaType, id: title.poplogId ?? title.externalIds?.imdbId ?? id }));
    const jsonLd = buildTitleJsonLd(title, canonicalPath, {
        language: "pt-BR",
        region: title.country ?? "BR",
        imageId: title.poplogId ?? title.externalIds?.imdbId ?? id,
        slug: title.externalIds?.slug ?? null,
    });
    return (<>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScriptContent(jsonLd) }}/>
        <TitlePageView title={title}/>
    </>);
}
