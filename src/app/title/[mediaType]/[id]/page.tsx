import Link from "next/link";

import ActionButton from "@/components/ui/ActionButton";
import EmptyState from "@/components/ui/EmptyState";
import TitlePageView from "@/features/title/TitlePageView";
import { getTitlePageData } from "@/server/titles/get-title-page-data";
import type { PoplogTitleSourceHint } from "@/server/titles/poplog-title-identity";

type MediaType = "movie" | "tv";

type PageProps = {
  params: Promise<{
    mediaType: MediaType;
    id: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function pickFlag(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.some((v) => v === "1" || v === "true");
  return value === "1" || value === "true";
}

export default async function TitlePage({ params, searchParams }: PageProps) {
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

  if (!title) {
    return (
      <section className="px-4 py-10 sm:px-6 md:px-10">
        <EmptyState
          kicker="Sem dados"
          title="Titulo nao encontrado."
          description="Nao foi possivel carregar os dados deste titulo. Pode ser um ID inexistente no TMDB ou uma falha temporaria."
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

  return <TitlePageView title={title} />;
}
