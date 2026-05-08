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

import { tmdbFetch } from "@/lib/tmdb";

import {
  getBackdropUrl,
  getMediaType,
  getPosterUrl,
  getTitle,
} from "@/lib/tmdb-utils";

type TMDBImage = {
  file_path: string;
  iso_639_1?: string | null;
  width?: number;
  vote_average?: number;
  vote_count?: number;
};

type TMDBImagesResponse = {
  backdrops?: TMDBImage[];
  posters?: TMDBImage[];
  logos?: TMDBImage[];
};

export const dynamic = "force-dynamic";

async function getRandomHeroBackdropPath(
  mediaType: "movie" | "tv",
  id: number,
): Promise<string | null> {
  try {
    const data = (await tmdbFetch(`/${mediaType}/${id}/images`, {
      include_image_language: "null",
    })) as TMDBImagesResponse;

    const backdrops: TMDBImage[] = data.backdrops ?? [];

    const bestPool = backdrops
      .filter((image) => image.file_path && image.iso_639_1 === null)
      .sort((a, b) => {
        const scoreA =
          (a.vote_average ?? 0) * 10 +
          (a.vote_count ?? 0) +
          (a.width ?? 0) / 100;

        const scoreB =
          (b.vote_average ?? 0) * 10 +
          (b.vote_count ?? 0) +
          (b.width ?? 0) / 100;

        return scoreB - scoreA;
      })
      .slice(0, 10);

    if (bestPool.length === 0) {
      return null;
    }

    const chosen = bestPool[Math.floor(Math.random() * bestPool.length)];

    return chosen?.file_path ?? null;
  } catch {
    return null;
  }
}

export default async function HomePage() {
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

  const [featuredDetails, randomHeroBackdropPath] = await Promise.all([
    featuredItem ? getFeaturedDetails(featuredType, featuredItem.id) : null,
    featuredItem
      ? getRandomHeroBackdropPath(featuredType, featuredItem.id)
      : null,
  ]);

  const featuredTitle = featuredItem
    ? getTitle(featuredItem)
    : "Destaque do momento";

  const backdropUrl = featuredItem
    ? getBackdropUrl(
        randomHeroBackdropPath ?? featuredItem.backdrop_path,
        "original",
      )
    : null;

  const posterUrl = featuredItem
    ? getPosterUrl(featuredItem.poster_path, "w500")
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
          <HomeMemberSections />

          <div id="trending">
            <TrendingNowSection />
          </div>
        </div>
      </div>
    </main>
  );
}