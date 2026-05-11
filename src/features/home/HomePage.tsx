// src/features/home/HomePage.tsx

import HomeMemberSections from "@/features/home/HomeMemberSections";
import HeroSection from "@/features/home/components/HeroSection";
import TrendingNowSection from "@/features/home/components/TrendingNowSection";

import { getFeaturedDetails, getTrending } from "@/features/home/home-api";
import {
  formatRuntime,
  parseYear,
  translateGenres,
} from "@/features/home/home-utils";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildTmdbUrl } from "@/lib/images";
import { getRandomTitleImagePath } from "@/lib/images/random";
import { RANDOMIZATION_ENABLED } from "@/lib/images/config";
import { getMediaType, getTitle } from "@/lib/tmdb-utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: initialUser },
  } = await supabase.auth.getUser();

  const trendingItems = await getTrending();

  const featuredCandidates = trendingItems.filter(
    (item) =>
      item.backdrop_path &&
      item.poster_path &&
      item.overview &&
      (item.vote_average ?? 0) >= 6.5,
  );

  const featuredItem =
    featuredCandidates[Math.floor(Math.random() * featuredCandidates.length)] ??
    trendingItems[0] ??
    null;

  const featuredType = featuredItem ? getMediaType(featuredItem) : "movie";

  const featuredItemsByType = trendingItems.filter(
    (item) => getMediaType(item) === featuredType,
  );

  const featuredRank = featuredItem
    ? featuredItemsByType.findIndex((item) => item.id === featuredItem.id) + 1
    : null;

  const featuredTypeLabel = featuredType === "tv" ? "as séries" : "os filmes";

  // Carrega detalhes do título destacado + backdrop randomizado em paralelo.
  // O backdrop usa o sistema central de randomização: somente imagens
  // sem idioma (textless), com cache de 24h compartilhado.
  const [featuredDetails, randomHeroBackdropPath] = await Promise.all([
    featuredItem ? getFeaturedDetails(featuredType, featuredItem.id) : null,
    featuredItem && RANDOMIZATION_ENABLED
      ? getRandomTitleImagePath(featuredType, featuredItem.id, "backdrop")
      : Promise.resolve<string | null>(null),
  ]);

  const featuredTitle = featuredItem
    ? getTitle(featuredItem)
    : "Destaque do momento";

  // Backdrop do hero: usa tamanho "hero" (w1280) em vez de "original" —
  // suficiente para tela cheia em qualquer device, sem estourar o limite
  // do otimizador da Vercel em produção.
  const backdropUrl = featuredItem
    ? buildTmdbUrl(
        "backdrop",
        "hero",
        RANDOMIZATION_ENABLED ? randomHeroBackdropPath : featuredItem.backdrop_path,
      )
    : null;

  const posterUrl = featuredItem
    ? buildTmdbUrl("poster", "detail", featuredItem.poster_path)
    : null;

  const year = parseYear(
    featuredDetails?.release_date,
    featuredDetails?.first_air_date,
  );

  const genres = featuredDetails?.genres
    ? translateGenres(featuredDetails.genres)
    : null;

  const runtime = formatRuntime(
    featuredDetails?.runtime,
    featuredDetails?.episode_run_time,
  );

  const seasons =
    featuredType === "tv" ? featuredDetails?.number_of_seasons ?? null : null;

  const overview = featuredDetails?.overview ?? featuredItem?.overview ?? null;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#020617] text-white">
      <HeroSection
        backdropUrl={backdropUrl}
        featuredItem={featuredItem}
        featuredType={featuredType}
        featuredTitle={featuredTitle}
        featuredRank={featuredRank}
        featuredTypeLabel={featuredTypeLabel}
        posterUrl={posterUrl}
        year={year}
        runtime={runtime}
        seasons={seasons}
        genres={genres}
        overview={overview}
      />

      <div className="relative z-10 mx-auto max-w-[1560px] px-6 pb-16 md:px-10">
        <div className="flex flex-col gap-14">
          <HomeMemberSections initialUser={initialUser} />

          <div id="trending">
            <TrendingNowSection />
          </div>
        </div>
      </div>
    </main>
  );
}
