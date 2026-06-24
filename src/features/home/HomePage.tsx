import HomeMemberSections from "@/features/home/HomeMemberSections";
import HeroSection from "@/features/home/components/HeroSection";
import TrendingNowSection from "@/features/home/components/TrendingNowSection";

import { getTrending } from "@/features/home/home-api";
import {
  parseYear,
  translateGenres,
} from "@/features/home/home-utils";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { buildTmdbUrlLoose } from "@/lib/images";
import { getMediaType, getTitle } from "@/lib/tmdb-utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const initialUser = await getCurrentUser();

  const trendingItems = await getTrending(initialUser?.id, {
    fast: true,
    includeProviders: false,
  });

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

  const featuredTitle = featuredItem
    ? getTitle(featuredItem)
    : "Destaque do momento";

  const backdropUrl = featuredItem
    ? buildTmdbUrlLoose("backdrop", "hero", featuredItem.backdrop_path)
    : null;

  const posterUrl = featuredItem
    ? buildTmdbUrlLoose("poster", "detail", featuredItem.poster_path)
    : null;

  const year = parseYear(
    featuredItem?.release_date,
    featuredItem?.first_air_date,
  );

  const genres = featuredItem?.genres?.length
    ? translateGenres(featuredItem.genres)
    : null;

  const runtime = null;

  const seasons = featuredType === "tv" ? featuredItem?.number_of_seasons ?? null : null;

  const overview = featuredItem?.overview ?? null;

  return (
    <>
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

      <div className="relative z-10 mx-auto max-w-[1560px] pb-16">
        <div className="flex flex-col gap-14">
          <div id="trending">
            <TrendingNowSection />
          </div>

          <HomeMemberSections initialUser={initialUser} />
        </div>
      </div>
    </>
  );
}
