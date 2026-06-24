import Link from "next/link";
import type { Metadata } from "next";
import { redirect, permanentRedirect } from "next/navigation";

import ActionButton from "@/components/ui/ActionButton";
import EmptyState from "@/components/ui/EmptyState";
import TitlePageView from "@/features/title/TitlePageView";
import { getTitlePageData } from "@/server/titles/get-title-page-data";
import { getPoplogTitleDetails } from "@/server/titles/poplog-title-details";
import { formatDuration, logger } from "@/server/logging/logger";
import type { PoplogTitleSourceHint } from "@/server/titles/poplog-title-identity";

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
    return { title: "Título" };
  }

  const title = await getPoplogTitleDetails({
    mediaType,
    id,
    sourceHint: "auto",
    region: "BR",
    locale: "pt-BR",
  });

  return {
    title: title?.title ?? "Título",
  };
}

function pickFlag(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.some((v) => v === "1" || v === "true");
  return value === "1" || value === "true";
}

export default async function TitlePage({ params, searchParams }: PageProps) {
  const startedAt = Date.now();
  const { mediaType, id } = await params;
  const resolvedSearch = searchParams ? await searchParams : undefined;

  const refresh =
    pickFlag(resolvedSearch?.refresh) || pickFlag(resolvedSearch?.force);
  const sourceHint = Array.isArray(resolvedSearch?.sourceHint)
    ? resolvedSearch?.sourceHint[0]
    : resolvedSearch?.sourceHint;

  if (mediaType !== "movie" && mediaType !== "tv") {
    return (
      <section className="px-4 py-10 sm:px-6 md:px-10">
        <EmptyState
          kicker="Rota invalida"
          title="Tipo de midia desconhecido."
          description="O caminho desta pagina espera /title/movie/{id} ou /title/tv/{id}."
          accent="rose"
        />
      </section>
    );
  }

  if (!id?.trim()) {
    return (
      <section className="px-4 py-10 sm:px-6 md:px-10">
        <EmptyState
          kicker="ID invalido"
          title="ID do titulo invalido."
          description="O ID na URL nao e um numero valido."
          accent="rose"
          action={
            <Link href="/buscar">
              <ActionButton variant="primary">Voltar pra busca</ActionButton>
            </Link>
          }
        />
      </section>
    );
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
    const canonicalId = String(title.poplogId);
    const canonicalPath = `/title/${title.mediaType}/${canonicalId}`;
    const currentPath = `/title/${mediaType}/${id}`;

    if (canonicalId && canonicalPath !== currentPath && !refresh) {
      permanentRedirect(canonicalPath);
    }
  } else {
    // Fallback legado: se não há poplogId mas há um tmdbId positivo diferente do
    // id solicitado (ex: chegou por sintético negativo), redireciona para o tmdbId.
    const requestedNumeric = parseInt(id, 10);
    const canonicalTmdbId = title?.externalIds?.tmdbId;
    if (
      title &&
      typeof canonicalTmdbId === "number" &&
      canonicalTmdbId > 0 &&
      Number.isInteger(requestedNumeric) &&
      requestedNumeric < 0 &&
      canonicalTmdbId !== requestedNumeric
    ) {
      const canonicalPath = `/title/${title.mediaType}/${canonicalTmdbId}`;
      const currentPath = `/title/${mediaType}/${id}`;
      if (canonicalPath !== currentPath && !refresh) {
        redirect(canonicalPath);
      }
    }
  }

  if (!title) {
    logger.warn(`[PAGE] /title/${mediaType}/${id} | failed | ${formatDuration(Date.now() - startedAt)}`);
    return (
      <section className="px-4 py-10 sm:px-6 md:px-10">
        <EmptyState
          kicker="Sem dados"
          title="Titulo nao encontrado."
          description="Nao foi possivel carregar os dados deste titulo. Pode ser um ID inexistente ou uma falha temporaria."
          accent="rose"
          action={
            <Link href="/buscar">
              <ActionButton variant="primary">Voltar pra busca</ActionButton>
            </Link>
          }
        />
      </section>
    );
  }

  logger.info(`[PAGE] /title/${mediaType}/${id} | ok | ${formatDuration(Date.now() - startedAt)}`);
  const titleCache = title.cacheInfo?.title;
  logger.info(
    `[ENGINE] resolved title | source=${titleCache?.source ?? "unknown"} | cache=${titleCache?.status ?? "unknown"} | persisted=${Boolean(title.poplogId || title.externalIds?.imdbId)}`,
  );
  logger.info(
    `[RATINGS] loaded | userRating=${title.userState?.userRating == null ? "none" : "ok"} | aggregate=${title.communityRating == null && title.ratings == null ? "none" : "ok"}`,
  );

  return <TitlePageView title={title} />;
}
