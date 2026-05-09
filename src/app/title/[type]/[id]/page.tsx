// src/app/title/[type]/[id]/page.tsx

import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { tmdbFetch } from "@/lib/tmdb";
import { getContentTypeLabel, normalizeKeywordName } from "@/lib/title-utils";
import { getStreamingInfo } from "@/lib/streaming";
import type { StreamingProvider } from "@/lib/streaming";
import TitleActions from "@/features/title/TitleActions";
import TitleTabs from "@/features/title/TitleTabs";
import MoreLikeThis from "@/features/title/MoreLikeThis";
import type {
  TMDBTitleDetail,
  TMDBSeason,
  RawCandidate,
} from "@/features/title/title-types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  params: Promise<{ type: string; id: string }>;
};

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type, id } = await params;
  const data = await getData(type, id);
  if (!data) return { title: "POPLOG" };
  const title = data.title ?? data.name ?? "Título";
  const year = data.release_date?.slice(0, 4) ?? data.first_air_date?.slice(0, 4);
  return {
    title: year ? `${title} (${year}) — POPLOG` : `${title} — POPLOG`,
    description: data.overview || undefined,
  };
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getData(type: string, id: string): Promise<TMDBTitleDetail | null> {
  if (type !== "movie" && type !== "tv") return null;
  const appendTo =
    type === "movie"
      ? "credits,keywords,recommendations,similar,release_dates"
      : "credits,keywords,recommendations,similar,content_ratings";
  try {
    return await tmdbFetch<TMDBTitleDetail>(`/${type}/${id}`, {
      append_to_response: appendTo,
    });
  } catch {
    return null;
  }
}

async function getSeasons(tvId: string, seasonNumbers: number[]): Promise<TMDBSeason[]> {
  const results = await Promise.all(
    seasonNumbers.map(async (n) => {
      try {
        const data = await tmdbFetch<Record<string, unknown>>(`/tv/${tvId}/season/${n}`);
        const episodes = ((data.episodes ?? []) as Record<string, unknown>[]).map((ep) => ({
          id: ep.id as number,
          episode_number: ep.episode_number as number,
          name: (ep.name as string) ?? "",
          overview: (ep.overview as string) ?? "",
          runtime: (ep.runtime as number) ?? null,
          still_path: (ep.still_path as string) ?? null,
          air_date: (ep.air_date as string) ?? null,
        }));
        return {
          id: (data.id as number) ?? 0,
          season_number: data.season_number as number,
          name: (data.name as string) ?? `Temporada ${n}`,
          episode_count: episodes.length,
          air_date: (data.air_date as string) ?? null,
          poster_path: (data.poster_path as string) ?? null,
          overview: (data.overview as string) ?? "",
          episodes,
        } as TMDBSeason;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((s): s is TMDBSeason => s !== null);
}

async function getTrailerKey(type: string, id: string): Promise<string | null> {
  type VideoResult = { site: string; type: string; key: string };

  function pick(results: VideoResult[]): string | null {
    const yt = results.filter((v) => v.site === "YouTube");
    return (yt.find((v) => v.type === "Trailer") ?? yt.find((v) => v.type === "Teaser"))?.key ?? null;
  }

  try {
    const ptBR = await tmdbFetch<{ results: VideoResult[] }>(`/${type}/${id}/videos`, { language: "pt-BR" });
    const key = pick(ptBR.results ?? []);
    if (key) return key;

    const fallback = await tmdbFetch<{ results: VideoResult[] }>(`/${type}/${id}/videos`);
    return pick(fallback.results ?? []);
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LANGUAGE_NAMES: Record<string, string> = {
  en: "Inglês", pt: "Português", es: "Espanhol", fr: "Francês",
  de: "Alemão", it: "Italiano", ja: "Japonês", ko: "Coreano",
  zh: "Chinês", ru: "Russo", ar: "Árabe", hi: "Hindi",
  nl: "Holandês", sv: "Sueco", pl: "Polonês", tr: "Turco",
  da: "Dinamarquês", fi: "Finlandês", nb: "Norueguês", th: "Tailandês",
};

const STATUS_LABELS: Record<string, string> = {
  "Returning Series":  "Em exibição",
  "Ended":             "Encerrada",
  "Canceled":          "Cancelada",
  "In Production":     "Em produção",
  "Post Production":   "Pós-produção",
  "Planned":           "Planejada",
  "Rumored":           "Em rumores",
  "Released":          "Lançado",
};

function getGenreIds(data: TMDBTitleDetail): number[] {
  return (data.genres ?? []).map((g) => g.id).filter(Boolean);
}

function getSourceKeywords(data: TMDBTitleDetail): string[] {
  const raw = data.keywords?.keywords ?? data.keywords?.results ?? [];
  return raw.map((k) => normalizeKeywordName(k.name ?? "")).filter(Boolean);
}

function getCandidates(data: TMDBTitleDetail): RawCandidate[] {
  const candidatesMap = new Map<number, RawCandidate>();

  (data.recommendations?.results ?? []).forEach((item) => {
    if (!item?.id || item.id === data.id) return;
    if (!item.poster_path && !item.backdrop_path) return;
    candidatesMap.set(item.id, { ...item, _fromRecommendations: true, _fromSimilar: false });
  });

  (data.similar?.results ?? []).forEach((item) => {
    if (!item?.id || item.id === data.id) return;
    if (!item.poster_path && !item.backdrop_path) return;
    const prev = candidatesMap.get(item.id);
    candidatesMap.set(item.id, {
      ...(prev ?? item),
      ...item,
      _fromRecommendations: Boolean(prev?._fromRecommendations),
      _fromSimilar: true,
    });
  });

  return Array.from(candidatesMap.values());
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SidebarCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[1.65rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.38)]">
      {children}
    </div>
  );
}

function SidebarLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">
      {children}
    </p>
  );
}

function ProviderChips({
  label,
  providers,
}: {
  label: string;
  providers: StreamingProvider[];
}) {
  if (!providers.length) return null;
  return (
    <div>
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {providers.slice(0, 6).map((p) => (
          <div
            key={p.id}
            title={p.name}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] transition hover:scale-105 hover:border-sky-300/40"
          >
            {p.logo && (
              <Image
                src={`https://image.tmdb.org/t/p/w92${p.logo}`}
                alt={p.name}
                width={28}
                height={28}
                className="h-6 w-6 rounded-md object-contain"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function TitleDetailPage({ params }: Props) {
  const { type, id } = await params;

  if (type !== "movie" && type !== "tv") notFound();

  const data = await getData(type, id);
  if (!data) notFound();

  const title         = data.title ?? data.name ?? "Título";
  const originalTitle = data.original_title ?? data.original_name;
  const year          = data.release_date?.slice(0, 4) ?? data.first_air_date?.slice(0, 4);
  const runtime       = type === "movie" && data.runtime ? `${data.runtime} min` : null;
  const rating        = typeof data.vote_average === "number" ? data.vote_average.toFixed(1) : null;
  const genreIds      = getGenreIds(data);
  const contentTypeLabel = getContentTypeLabel(type, genreIds);
  const genres: string[] = (data.genres ?? []).map((g) => g.name);

  const directors  = (data.credits?.crew ?? []).filter((p) => p.job === "Director");
  const writers    = (data.credits?.crew ?? [])
    .filter((p) => p.department === "Writing" && (p.job === "Screenplay" || p.job === "Writer" || p.job === "Story"))
    .slice(0, 3);
  const cast       = (data.credits?.cast ?? []).slice(0, 8);
  const creators   = data.created_by ?? [];
  const trailerKey = await getTrailerKey(type, id);

  const candidates      = getCandidates(data);
  const sourceGenreIds  = genreIds;
  const sourceKeywords  = getSourceKeywords(data);
  const sourceYear      = Number(year) || null;

  // Providers via utilitário centralizado
  const streaming = await getStreamingInfo(data.id, type as "movie" | "tv", {
    releaseDate:         data.release_date ?? data.first_air_date ?? undefined,
    productionCompanies: data.production_companies ?? [],
    budget:              data.budget ?? 0,
    revenue:             data.revenue ?? 0,
    seasons:             data.number_of_seasons ?? null,
    genre:               data.genres?.[0]?.name ?? null,
  });

  const subscriptionProviders = [
    ...streaming.flatrate,
    ...streaming.free,
    ...streaming.ads,
  ].filter((p, i, arr) => arr.findIndex((q) => q.id === p.id) === i);

  const featuredProvider = subscriptionProviders[0] ?? streaming.rent[0] ?? streaming.buy[0] ?? null;
  const featuredProviderLabel = subscriptionProviders[0]
    ? "Streaming"
    : streaming.rent[0]
      ? "Alugar"
      : "Comprar";
  const hasWatchProviders = Boolean(
    subscriptionProviders.length || streaming.rent.length || streaming.buy.length,
  );

  // Ficha técnica
  const originCountry   = data.production_countries?.[0]?.name ?? null;
  const langCode        = data.original_language ?? null;
  const langName        = langCode ? (LANGUAGE_NAMES[langCode] ?? langCode.toUpperCase()) : null;
  const statusLabel     = data.status ? (STATUS_LABELS[data.status] ?? data.status) : null;

  // Séries: busca temporadas completas (com episódios)
  let seasons: TMDBSeason[] = [];
  if (type === "tv" && data.seasons) {
    const seasonNums = (data.seasons)
      .filter((s) => s.season_number > 0)
      .map((s) => s.season_number);
    const BATCH_SIZE = 10;
    for (let i = 0; i < seasonNums.length; i += BATCH_SIZE) {
      const batch = seasonNums.slice(i, i + BATCH_SIZE);
      const batchResults = await getSeasons(id, batch);
      seasons = [...seasons, ...batchResults];
    }
  }

  const overviewContent = (
    <div className="space-y-10">
      <section>
        <h2 className="mb-3 text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">
          Sinopse
        </h2>
        <p className="leading-relaxed text-zinc-300">
          {data.overview || "Sem descrição disponível."}
        </p>
      </section>

      {trailerKey && (
        <section>
          <h2 className="mb-3 text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">
            Trailer
          </h2>
          <div className="overflow-hidden rounded-2xl border border-white/10 shadow-[0_18px_60px_rgba(0,0,0,0.5)]">
            <iframe
              src={`https://www.youtube.com/embed/${trailerKey}`}
              title={`Trailer de ${title}`}
              allowFullScreen
              className="aspect-video w-full"
            />
          </div>
        </section>
      )}

      <MoreLikeThis
        candidates={candidates}
        sourceGenreIds={sourceGenreIds}
        sourceKeywords={sourceKeywords}
        sourceYear={sourceYear}
        mediaType={type as "movie" | "tv"}
      />
    </div>
  );

  return (
    <main className="min-h-screen bg-[#020617] text-white">

      {/* Hero — backdrop cinematográfico com camadas de gradiente */}
      <div className="relative h-[48vh] min-h-[320px] overflow-hidden md:h-[54vh]">
        {data.backdrop_path ? (
          <Image
            src={`https://image.tmdb.org/t/p/original${data.backdrop_path}`}
            alt={title}
            fill
            priority
            sizes="100vw"
            className="object-cover object-center opacity-45"
          />
        ) : (
          <div className="absolute inset-0 bg-[#020617]" />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(2,6,23,0.96)_0%,rgba(2,6,23,0.55)_40%,rgba(2,6,23,0.20)_70%,rgba(2,6,23,0.60)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.70)_0%,transparent_28%,rgba(2,6,23,0.30)_58%,#020617_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_68%_8%,rgba(56,189,248,0.18),transparent_38%)]" />
        <div className="absolute inset-0 opacity-[0.03] [background-image:radial-gradient(circle_at_center,white_1px,transparent_1px)] [background-size:24px_24px]" />
      </div>

      {/* Poster + título — sobrepõe o hero */}
      <div className="relative z-10 mx-auto -mt-40 max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-end sm:gap-8">
          {/* Poster */}
          <div className="w-36 shrink-0 overflow-hidden rounded-2xl border border-white/[0.12] shadow-[0_24px_80px_rgba(0,0,0,0.75)] sm:w-44 md:w-52">
            {data.poster_path ? (
              <Image
                src={`https://image.tmdb.org/t/p/w500${data.poster_path}`}
                alt={title}
                width={500}
                height={750}
                priority
                className="w-full object-cover"
              />
            ) : (
              <div className="flex aspect-[2/3] items-center justify-center bg-white/5 text-sm text-zinc-500">
                Sem poster
              </div>
            )}
          </div>

          {/* Info textual */}
          <div className="flex-1 text-center sm:pb-2 sm:text-left">
            <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl md:text-[2.8rem]">
              {title}
            </h1>
            {originalTitle && originalTitle !== title && (
              <p className="mt-1.5 text-sm text-zinc-500">{originalTitle}</p>
            )}
            <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-sm font-semibold text-zinc-400 sm:justify-start">
              <span>{contentTypeLabel}</span>
              {year && <span>· {year}</span>}
              {runtime && <span>· {runtime}</span>}
              {rating && <span className="font-black text-amber-400">· ★ {rating}</span>}
              {data.original_language && (
                <span>· {data.original_language.toUpperCase()}</span>
              )}
            </div>
            {directors.length > 0 && (
              <p className="mt-2 text-sm text-zinc-500">
                Direção{" "}
                <span className="font-bold text-zinc-300">
                  {directors.map((d) => d.name).join(", ")}
                </span>
              </p>
            )}
            <div className="mt-4 flex justify-center sm:justify-start">
              <TitleActions
                tmdbId={data.id}
                mediaType={type as "movie" | "tv"}
                title={title}
                releaseYear={year ? parseInt(year) : null}
                seasons={seasons}
                inline
              />
            </div>
          </div>
        </div>
      </div>

      {/* Conteúdo principal */}
      <div className="mx-auto mt-10 max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">

          {/* Sidebar */}
          <div className="w-full space-y-4 lg:w-[280px] lg:shrink-0">

            {/* Onde assistir */}
            <div className="rounded-[1.65rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <h2 className="mb-4 text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">
                Onde assistir
              </h2>
              {hasWatchProviders && featuredProvider ? (
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-xl border border-sky-400/20 bg-sky-400/[0.08] p-4 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.12)]">
                    <div className="flex items-center gap-3">
                      {featuredProvider.logo && (
                        <Image
                          src={`https://image.tmdb.org/t/p/w185${featuredProvider.logo}`}
                          alt={featuredProvider.name}
                          width={64}
                          height={64}
                          className="h-11 w-11 rounded-xl object-cover shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-black uppercase tracking-widest text-sky-400">
                          {featuredProviderLabel}
                        </p>
                        <p className="truncate text-base font-black text-white">
                          {featuredProvider.name}
                        </p>
                      </div>
                    </div>
                  </div>
                  <ProviderChips
                    label="Outros streamings"
                    providers={subscriptionProviders.filter((p) => p.id !== featuredProvider.id)}
                  />
                  <ProviderChips
                    label="Alugar"
                    providers={streaming.rent.filter((p) => p.id !== featuredProvider.id)}
                  />
                  <ProviderChips
                    label="Comprar"
                    providers={streaming.buy.filter((p) => p.id !== featuredProvider.id)}
                  />
                </div>
              ) : streaming.streamStatus === "cinemas" ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-rose-400/30 bg-rose-500/[0.12] px-4 py-2.5">
                    <p className="text-[10px] font-black uppercase tracking-[0.12em] text-rose-300">
                      Nos cinemas
                    </p>
                  </div>
                  <div className="space-y-2 px-0.5">
                    {streaming.estimatedPvodMonth && (
                      <p className="text-[12px] text-zinc-400">
                        Aluguel digital previsto para{" "}
                        <span className="font-semibold text-zinc-200">{streaming.estimatedPvodMonth}</span>
                      </p>
                    )}
                    {streaming.estimatedPlatform && streaming.estimatedMonth && (
                      <p className="text-[12px] text-zinc-400">
                        <span className="font-semibold text-zinc-200">{streaming.estimatedPlatform}</span>{" "}
                        previsto para{" "}
                        <span className="font-semibold text-zinc-200">{streaming.estimatedMonth}</span>
                      </p>
                    )}
                    {!streaming.estimatedPvodMonth && !streaming.estimatedPlatform && (
                      <p className="text-[12px] text-zinc-500">
                        Streaming em breve — janela de distribuição em andamento
                      </p>
                    )}
                  </div>
                </div>
              ) : streaming.streamStatus === "chegando" ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-amber-400/30 bg-amber-500/[0.12] px-4 py-2.5">
                    <p className="text-[10px] font-black uppercase tracking-[0.12em] text-amber-300">
                      Chegando em breve
                    </p>
                  </div>
                  <div className="space-y-2 px-0.5">
                    {streaming.estimatedPlatform && streaming.estimatedMonth ? (
                      <p className="text-[12px] text-zinc-400">
                        Previsto para{" "}
                        <span className="font-semibold text-zinc-200">{streaming.estimatedMonth}</span>{" "}
                        no{" "}
                        <span className="font-semibold text-zinc-200">{streaming.estimatedPlatform}</span>
                      </p>
                    ) : (
                      <p className="text-[12px] text-zinc-500">
                        Ainda não disponível no Brasil
                      </p>
                    )}
                    {streaming.availableAbroad && (
                      <p className="text-[11px] text-zinc-600">Disponível fora do Brasil</p>
                    )}
                  </div>
                </div>
              ) : streaming.availableAbroad ? (
                <p className="text-sm text-zinc-400">
                  Disponível fora do Brasil
                </p>
              ) : (
                <p className="text-sm text-zinc-500">Nenhuma opção disponível no Brasil no momento.</p>
              )}
            </div>

            {/* Gêneros */}
            {genres.length > 0 && (
              <SidebarCard>
                <SidebarLabel>Gêneros</SidebarLabel>
                <div className="flex flex-wrap gap-2">
                  {genres.map((g) => (
                    <span
                      key={g}
                      className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs font-semibold text-zinc-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              </SidebarCard>
            )}

            {/* Elenco */}
            {cast.length > 0 && (
              <SidebarCard>
                <SidebarLabel>Elenco</SidebarLabel>
                <div className="space-y-3">
                  {cast.map((person) => (
                    <div key={person.id} className="flex items-center gap-3">
                      {person.profile_path ? (
                        <Image
                          src={`https://image.tmdb.org/t/p/w185${person.profile_path}`}
                          alt={person.name}
                          width={40}
                          height={40}
                          className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/10"
                        />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10 text-xs text-zinc-500">
                          {person.name.charAt(0)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-zinc-200">{person.name}</p>
                        <p className="truncate text-[11px] text-zinc-500">{person.character}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </SidebarCard>
            )}

            {/* Ficha técnica */}
            <SidebarCard>
              <SidebarLabel>Ficha técnica</SidebarLabel>
              <dl className="space-y-3">

                {/* Diretor (filmes) */}
                {type === "movie" && directors.length > 0 && (
                  <div>
                    <dt className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-600">Direção</dt>
                    <dd className="mt-0.5 text-xs font-semibold text-zinc-300">
                      {directors.map((d) => d.name).join(", ")}
                    </dd>
                  </div>
                )}

                {/* Criador (séries) */}
                {type === "tv" && creators.length > 0 && (
                  <div>
                    <dt className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-600">Criação</dt>
                    <dd className="mt-0.5 text-xs font-semibold text-zinc-300">
                      {creators.map((c) => c.name).join(", ")}
                    </dd>
                  </div>
                )}

                {/* Roteiristas */}
                {writers.length > 0 && (
                  <div>
                    <dt className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-600">Roteiro</dt>
                    <dd className="mt-0.5 text-xs font-semibold text-zinc-300">
                      {writers.map((w) => w.name).join(", ")}
                    </dd>
                  </div>
                )}

                {/* País de origem */}
                {originCountry && (
                  <div>
                    <dt className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-600">País</dt>
                    <dd className="mt-0.5 text-xs font-semibold text-zinc-300">{originCountry}</dd>
                  </div>
                )}

                {/* Idioma original */}
                {langName && (
                  <div>
                    <dt className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-600">Idioma</dt>
                    <dd className="mt-0.5 text-xs font-semibold text-zinc-300">{langName}</dd>
                  </div>
                )}

                {/* Duração (filmes) */}
                {type === "movie" && data.runtime && (
                  <div>
                    <dt className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-600">Duração</dt>
                    <dd className="mt-0.5 text-xs font-semibold text-zinc-300">{data.runtime} min</dd>
                  </div>
                )}

                {/* Temporadas / Episódios (séries) */}
                {type === "tv" && (
                  <>
                    {data.number_of_seasons != null && (
                      <div>
                        <dt className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-600">Temporadas</dt>
                        <dd className="mt-0.5 text-xs font-semibold text-zinc-300">{data.number_of_seasons}</dd>
                      </div>
                    )}
                    {data.number_of_episodes != null && (
                      <div>
                        <dt className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-600">Episódios</dt>
                        <dd className="mt-0.5 text-xs font-semibold text-zinc-300">{data.number_of_episodes}</dd>
                      </div>
                    )}
                  </>
                )}

                {/* Status */}
                {statusLabel && (
                  <div>
                    <dt className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-600">Status</dt>
                    <dd className="mt-0.5 text-xs font-semibold text-zinc-300">{statusLabel}</dd>
                  </div>
                )}

              </dl>
            </SidebarCard>

          </div>

          {/* Área principal com abas */}
          <div className="min-w-0 flex-1">
            <TitleTabs
              type={type}
              overviewContent={overviewContent}
              seasons={seasons}
              tmdbId={data.id}
              mediaType={type as "movie" | "tv"}
            />
          </div>
        </div>
      </div>

      <div className="h-16 sm:h-24" />
    </main>
  );
}
