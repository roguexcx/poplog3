import { headers } from "next/headers";
import Link from "next/link";

import ActionButton from "@/components/ui/ActionButton";
import EmptyState from "@/components/ui/EmptyState";
import TitlePageView from "@/features/title/TitlePageView";
import type { TitlePageData } from "@/features/title/types";
import { resolveAvailability } from "@/server/streaming/resolve-availability";
import { getUserProviderPreferences } from "@/server/streaming/user-provider-preferences";

type MediaType = "movie" | "tv";

type PageProps = {
  params: Promise<{
    mediaType: MediaType;
    id: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

async function getTitlePageData(
  mediaType: MediaType,
  id: string,
  refresh: boolean
): Promise<TitlePageData | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? "http";
  const cookie = h.get("cookie") ?? "";

  if (!host) return null;

  try {
    const refreshParam = refresh ? "?refresh=1" : "";

    const res = await fetch(
      `${protocol}://${host}/api/poplog3/titles/${mediaType}/${id}${refreshParam}`,
      {
        cache: "no-store",
        headers: {
          cookie,
        },
      }
    );

    if (!res.ok) return null;

    return (await res.json()) as TitlePageData;
  } catch (error) {
    console.error("[title/page] fetch falhou:", error);
    return null;
  }
}

function pickFlag(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.some((v) => v === "1" || v === "true");
  return value === "1" || value === "true";
}

async function applyGlobalAvailability(
  title: TitlePageData
): Promise<TitlePageData> {
  const preferences =
    await getUserProviderPreferences();

  const availability =
    resolveAvailability({
      providers: title.providers ?? [],
      region:
        preferences.region ?? "BR",
      preferences,
    });

  return {
    ...title,
    providers:
      availability.providers,
  };
}

export default async function TitlePage({ params, searchParams }: PageProps) {
  const { mediaType, id } = await params;
  const resolvedSearch = searchParams ? await searchParams : undefined;

  const refresh =
    pickFlag(resolvedSearch?.refresh) || pickFlag(resolvedSearch?.force);

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

  const title = await getTitlePageData(mediaType, id, refresh);

  if (!title) {
    return (
      <section className="px-4 py-10 sm:px-6 md:px-10">
        <EmptyState
          kicker="Sem dados"
          title="Titulo nao encontrado."
          description="A API interna da POPLOG nao devolveu nenhum dado para este id. Pode ser um sync que ainda nao rodou ou um id inexistente no TMDB."
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

  const titleWithAvailability =
  await applyGlobalAvailability(
    title
  );

  return <TitlePageView title={titleWithAvailability} />;
}