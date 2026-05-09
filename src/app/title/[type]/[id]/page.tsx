// src/app/title/[type]/[id]/page.tsx

import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { tmdbFetch } from "@/lib/tmdb";
import { getContentTypeLabel, normalizeKeywordName } from "@/lib/title-utils";
import TitleActions from "@/features/title/TitleActions";
import TitleTabs from "@/features/title/TitleTabs";
import MoreLikeThis from "@/features/title/MoreLikeThis";
import type {
  TMDBTitleDetail,
  TMDBSeason,
  TMDBVideo,
  RawCandidate,
} from "@/features/title/title-types";

// ─── Types ────────────────────────────────────────────────────────────────────

type TMDBProvider = {
  provider_id: number;
  provider_name: string;
  logo_path?: string | null;
};

type WatchProviders = {
  flatrate?: TMDBProvider[];
  free?: TMDBProvider[];
  ads?: TMDBProvider[];
  rent?: TMDBProvider[];
  buy?: TMDBProvider[];
};

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
      ? "credits,videos,watch/providers,keywords,recommendations,similar,release_dates"
      : "credits,videos,watch/providers,keywords,recommendations,similar,content_ratings";
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBestTrailer(videos: TMDBVideo[] = []): TMDBVideo | undefined {
  function scoreVideo(video: TMDBVideo): number {
    const name = video.name.toLowerCase();
    let score = 0;
    if (video.type === "Trailer") score += 40;
    if (video.iso_639_1 === "pt") score += 30;
    if (/brasil|pt-br|portugu[eê]s brasileiro|dublado|dublagem/i.test(name)) score += 80;
    if (/oficial|official/i.test(name)) score += 20;
    if (/portugal|pt-pt|portugu[eê]s de portugal|legendas pt|dobrado/i.test(name)) score -= 120;
    if (/legendado|legendas/i.test(name)) score -= 15;
    return score;
  }
  return videos
    .filter((v) => v.site === "YouTube")
    .map((video) => ({ video, score: scoreVideo(video) }))
    .sort((a, b) => b.score - a.score)[0]?.video;
}

function mergeProviders(...groups: (TMDBProvider[] | undefined)[]): TMDBProvider[] {
  const map = new Map<number, TMDBProvider>();
  groups.flat().forEach((provider) => {
    if (provider?.provider_id) map.set(provider.provider_id, provider);
  });
  return Array.from(map.values());
}

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

function ProviderChips({
  title,
  providers,
  excludeProviderId,
}: {
  title: string;
  providers?: TMDBProvider[];
  excludeProviderId?: number;
}) {
  const filtered = providers?.filter((p) => p.provider_id !== excludeProviderId);
  if (!filtered?.length) return null;
  return (
    <div>
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">
        {title}
      </p>
      <div className="flex flex-wrap gap-2">
        {filtered.slice(0, 6).map((provider) => (
          <div
            key={provider.provider_id}
            title={provider.provider_name}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] transition hover:scale-105 hover:border-sky-300/40"
          >
            {provider.logo_path && (
              <Image
                src={`https://image.tmdb.org/t/p/w92${provider.logo_path}`}
                alt={provider.provider_name}
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

  const directors = (data.credits?.crew ?? []).filter((p) => p.job === "Director");
  const cast      = (data.credits?.cast ?? []).slice(0, 8);
  const trailer   = getBestTrailer(data.videos?.results ?? []);

  const candidates      = getCandidates(data);
  const sourceGenreIds  = genreIds;
  const sourceKeywords  = getSourceKeywords(data);
  const sourceYear      = Number(year) || null;

  const watchProviders: WatchProviders | undefined = data["watch/providers"]?.results?.BR;
  const freeAndAdsProviders = mergeProviders(watchProviders?.free, watchProviders?.ads);
  const featuredProvider =
    watchProviders?.flatrate?.[0] ??
    freeAndAdsProviders?.[0] ??
    watchProviders?.rent?.[0] ??
    watchProviders?.buy?.[0];
  const featuredProviderLabel = watchProviders?.flatrate?.[0]
    ? "Streaming"
    : freeAndAdsProviders?.[0]
      ? "Grátis ou com anúncios"
      : watchProviders?.rent?.[0]
        ? "Alugar"
        : "Comprar";
  const hasWatchProviders = Boolean(
    watchProviders?.flatrate?.length ||
      freeAndAdsProviders.length ||
      watchProviders?.rent?.length ||
      watchProviders?.buy?.length,
  );

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

      {trailer && (
        <section>
          <h2 className="mb-3 text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">
            Trailer
          </h2>
          <div className="overflow-hidden rounded-2xl border border-white/10 shadow-[0_18px_60px_rgba(0,0,0,0.5)]">
            <iframe
              src={`https://www.youtube.com/embed/${trailer.key}`}
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

  const castContent =
    cast.length > 0 ? (
      <section>
        <h2 className="mb-4 text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">
          Elenco principal
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {cast.map((person) => (
            <div
              key={person.id}
              className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 transition duration-200 hover:border-white/[0.18] hover:bg-white/[0.07]"
            >
              {person.profile_path ? (
                <Image
                  src={`https://image.tmdb.org/t/p/w185${person.profile_path}`}
                  alt={person.name}
                  width={50}
                  height={50}
                  className="h-12 w-12 shrink-0 rounded-xl object-cover"
                />
              ) : (
                <div className="h-12 w-12 shrink-0 rounded-xl bg-white/5" />
              )}
              <div className="min-w-0">
                <p className="truncate font-bold text-zinc-100">{person.name}</p>
                <p className="truncate text-sm text-zinc-500">{person.character}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    ) : (
      <p className="text-sm text-zinc-500">Elenco não disponível.</p>
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
            className="object-cover object-top opacity-45"
          />
        ) : (
          <div className="absolute inset-0 bg-[#020617]" />
        )}
        {/* Gradiente horizontal — apaga as bordas laterais */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(2,6,23,0.96)_0%,rgba(2,6,23,0.55)_40%,rgba(2,6,23,0.20)_70%,rgba(2,6,23,0.60)_100%)]" />
        {/* Gradiente vertical — funde no bg da página */}
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.70)_0%,transparent_28%,rgba(2,6,23,0.30)_58%,#020617_100%)]" />
        {/* Glow sky-blue sutil no topo */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_68%_8%,rgba(56,189,248,0.18),transparent_38%)]" />
        {/* Textura de pontos — igual à home */}
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
          </div>
        </div>
      </div>

      {/* Conteúdo principal */}
      <div className="mx-auto mt-10 max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">

          {/* Sidebar */}
          <div className="w-full space-y-4 lg:w-[280px] lg:shrink-0">
            <TitleActions
              tmdbId={data.id}
              mediaType={type as "movie" | "tv"}
              title={title}
              releaseYear={year ? parseInt(year) : null}
              seasons={seasons}
            />

            {/* Onde assistir */}
            <div className="rounded-[1.65rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">
                  Onde assistir
                </h2>
                <div className="rounded-full bg-sky-400/15 px-3 py-1 text-[10px] font-black text-sky-300">
                  BR
                </div>
              </div>
              {hasWatchProviders && featuredProvider ? (
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-xl border border-sky-400/20 bg-sky-400/[0.08] p-4 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.12)]">
                    <div className="flex items-center gap-3">
                      {featuredProvider.logo_path && (
                        <Image
                          src={`https://image.tmdb.org/t/p/w185${featuredProvider.logo_path}`}
                          alt={featuredProvider.provider_name}
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
                          {featuredProvider.provider_name}
                        </p>
                      </div>
                    </div>
                  </div>
                  <ProviderChips title="Outros streamings" providers={watchProviders?.flatrate} excludeProviderId={featuredProvider.provider_id} />
                  <ProviderChips title="Grátis / anúncios" providers={freeAndAdsProviders} excludeProviderId={featuredProvider.provider_id} />
                  <ProviderChips title="Alugar" providers={watchProviders?.rent} excludeProviderId={featuredProvider.provider_id} />
                  <ProviderChips title="Comprar" providers={watchProviders?.buy} excludeProviderId={featuredProvider.provider_id} />
                </div>
              ) : (
                <p className="text-sm text-zinc-500">Nenhuma opção disponível no Brasil no momento.</p>
              )}
            </div>

            {/* Gêneros */}
            {genres.length > 0 && (
              <div className="rounded-[1.65rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.38)]">
                <h2 className="mb-3 text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">
                  Gêneros
                </h2>
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
              </div>
            )}
          </div>

          {/* Área principal com abas */}
          <div className="min-w-0 flex-1">
            <TitleTabs
              type={type}
              overviewContent={overviewContent}
              castContent={castContent}
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
