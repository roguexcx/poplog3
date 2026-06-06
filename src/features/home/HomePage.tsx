import HomeMemberSections from "@/features/home/HomeMemberSections";
import HeroSection from "@/features/home/components/HeroSection";
import TrendingNowSection from "@/features/home/components/TrendingNowSection";

import { getFeaturedDetails, getTrending } from "@/features/home/home-api";
import {
  formatRuntime,
  parseYear,
  translateGenres,
} from "@/features/home/home-utils";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { buildTmdbUrlLoose } from "@/lib/images";
import { getMediaType, getTitle } from "@/lib/tmdb-utils";
import { translateToPtBr } from "@/server/translate/translate-to-pt-br";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const initialUser = await getCurrentUser();

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

  const [featuredDetails] = await Promise.all([
    featuredItem ? getFeaturedDetails(featuredType, featuredItem) : null,
  ]);

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
    featuredDetails?.release_date,
    featuredDetails?.first_air_date,
  );

  const genres = featuredDetails?.genres?.length
    ? translateGenres(featuredDetails.genres)
    : (featuredItem?.genres?.length
        ? translateGenres(featuredItem.genres)
        : null);

  const runtime = formatRuntime(
    featuredType,
    featuredDetails?.runtime,
    featuredDetails?.episode_run_time,
  );

  const seasons =
    featuredType === "tv" ? featuredDetails?.number_of_seasons ?? null : null;

  const rawOverview = featuredDetails?.overview ?? featuredItem?.overview ?? null;
  const overview = rawOverview
    ? (await translateToPtBr(rawOverview).catch(() => ({ translatedText: rawOverview }))).translatedText
    : null;

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
          <HomeMemberSections initialUser={initialUser} />

          <div id="trending">
            <TrendingNowSection />
          </div>
        </div>
      </div>
    </>
  );
}
