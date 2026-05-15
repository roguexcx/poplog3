import { NextRequest, NextResponse } from "next/server";

import {
  availabilityStateFromTitle,
  type TitleAvailabilityState,
} from "@/lib/series";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getAvailability } from "@/server/cache/availability-cache";
import { getExternalIds } from "@/server/cache/external-ids-cache";
import { computeUserSeriesProgress } from "@/server/episodes/episode-progress-service";
import { getUserTitleStatus } from "@/server/library/library-service";
import { syncAvailability, type TmdbPayloadWithWatch } from "@/server/sync/sync-availability";
import { syncOmdbRatings } from "@/server/sync/sync-omdb-ratings";
import { syncTmdbTitle } from "@/server/sync/sync-tmdb-title";

import type { PoplogTitleDetails } from "@/server/types/title-details";

type MediaType = "movie" | "tv";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const FUTURE_AIR_WINDOW_DAYS = 120;

function tmdbImage(path: string | null | undefined, size: string) {
  if (!path) return null;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${TMDB_IMAGE_BASE}/${size}${normalized}`;
}

function hasDetailFields(
  title: PoplogTitleDetails | Record<string, unknown>
): title is PoplogTitleDetails {
  return (
    typeof title === "object" &&
    title !== null &&
    ("cast" in title || "recommendations" in title || "runtime" in title)
  );
}

function avgRuntime(items: number[] | null | undefined): number | null {
  if (!items || items.length === 0) return null;
  const valid = items.filter((n) => Number.isFinite(n) && n > 0);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

function uniqueNames(names: Array<string | null | undefined>, limit = 4) {
  return Array.from(
    new Set(
      names
        .map((name) => name?.trim())
        .filter((name): name is string => Boolean(name))
    )
  ).slice(0, limit);
}

function isValidSeason(season: NonNullable<PoplogTitleDetails["seasons"]>[number]) {
  if (typeof season.season_number !== "number" || season.season_number <= 0) {
    return false;
  }

  const now = Date.now();
  const futureLimit = now + FUTURE_AIR_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const airTime = season.air_date ? new Date(season.air_date).getTime() : null;

  const hasValidAirDate =
    airTime !== null &&
    Number.isFinite(airTime) &&
    (airTime <= now || airTime <= futureLimit);

  const hasName = Boolean(season.name?.trim());

  const hasStrongSeasonSignal =
    Boolean(season.poster_path) || Boolean(season.overview?.trim());

  /*
    Evita temporadas fantasmas da TMDB.
    Antes, qualquer season com episode_count > 0 passava.
    Agora, episode_count sozinho NÃO basta, porque a TMDB pode criar
    temporada/episódio placeholder sem data, nome útil, thumb ou resumo.
  */
  return hasValidAirDate || (hasName && hasStrongSeasonSignal);
}

function filterValidSeasons(
  seasons: PoplogTitleDetails["seasons"] | undefined
) {
  if (!seasons || seasons.length === 0) return [];

  return seasons
    .filter(isValidSeason)
    .sort((a, b) => a.season_number - b.season_number);
}

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ mediaType: string; id: string }>;
  }
) {
  const resolved = await params;
  const mediaType = resolved.mediaType as MediaType;
  const id = Number(resolved.id);

  const refresh =
    request.nextUrl.searchParams.get("refresh") === "1" ||
    request.nextUrl.searchParams.get("force") === "1";

  const country =
    request.nextUrl.searchParams.get("country")?.toUpperCase() ?? "BR";

  if (mediaType !== "movie" && mediaType !== "tv") {
    return NextResponse.json(
      { ok: false, error: "Invalid media type" },
      { status: 400 }
    );
  }

  if (!id || Number.isNaN(id)) {
    return NextResponse.json(
      { ok: false, error: "Invalid TMDB id" },
      { status: 400 }
    );
  }

  try {
    const synced = await syncTmdbTitle(mediaType, id, { force: refresh });
    const title = synced.title;

    const details = hasDetailFields(title)
      ? (title as PoplogTitleDetails)
      : null;

    const currentUser = await getCurrentUser();

    let userState:
      | {
          isAuthenticated: boolean;
          inWatchlist?: boolean;
          watching?: boolean;
          watched?: boolean;
          favorite?: boolean;
          liked?: boolean;
          disliked?: boolean;
        }
      | undefined = {
      isAuthenticated: Boolean(currentUser),
    };

    if (currentUser) {
      try {
        const status = await getUserTitleStatus(currentUser.id, id, mediaType);

        userState = {
          isAuthenticated: true,
          inWatchlist: status?.status === "watchlist",
          watching: status?.status === "watching",
          watched: status?.status === "watched",
          favorite: Boolean(status?.favorite),
          liked: status?.liked === true,
          disliked: status?.liked === false,
        };
      } catch (error) {
        console.warn("[poplog3/titles] userState lookup falhou:", error);

        userState = {
          isAuthenticated: true,
        };
      }
    }

    let userSeriesProgress: {
      watchedCount: number;
      totalEpisodes: number | null;
      lastWatchedAt: string | null;
      watchedKeys: string[];
      nextEpisode: { seasonNumber: number; episodeNumber: number } | null;
    } | null = null;

    if (currentUser && mediaType === "tv") {
      try {
        const progress = await computeUserSeriesProgress(currentUser.id, id);

        userSeriesProgress = {
          watchedCount: progress.watchedCount,
          totalEpisodes: progress.totalEpisodes,
          lastWatchedAt: progress.lastWatchedAt,
          watchedKeys: progress.watchedKeys,
          nextEpisode: progress.nextEpisode,
        };
      } catch (error) {
        console.warn("[poplog3/titles] series progress falhou:", error);
      }
    }

    const externalIds = await getExternalIds(mediaType, id);

    const imdbIdFromPayload =
      (title as PoplogTitleDetails & { imdb_id?: string | null }).imdb_id ??
      (synced.rawPayload as { imdb_id?: string | null } | null | undefined)
        ?.imdb_id ??
      null;

    const imdbId = externalIds?.imdb_id ?? imdbIdFromPayload ?? null;

    let ratings: {
      imdbRating: number | null;
      imdbVotes: number | null;
      rottenTomatoesScore: number | null;
      metacriticScore: number | null;
      tmdbRating: number | null;
      poplogScore: number | null;
      poplogComponents: number | undefined;
    } | null = null;

    let ratingsCache: { source: string; status: string } | null = null;

    try {
      const ratingsResult = await syncOmdbRatings({
        tmdbId: id,
        mediaType,
        imdbId,
        tmdbRating: title.vote_average ?? null,
        force: refresh,
      });

      ratingsCache = {
        source: ratingsResult.source,
        status: ratingsResult.cache_status,
      };

      const r = ratingsResult.ratings;

      if (r) {
        let components = 0;

        if (typeof r.imdb_rating === "number") components += 1;
        if (typeof r.rotten_tomatoes_score === "number") components += 1;
        if (typeof r.metacritic_score === "number") components += 1;
        if (typeof r.tmdb_rating === "number") components += 1;

        ratings = {
          imdbRating: r.imdb_rating ?? null,
          imdbVotes: r.imdb_votes ?? null,
          rottenTomatoesScore: r.rotten_tomatoes_score ?? null,
          metacriticScore: r.metacritic_score ?? null,
          tmdbRating: r.tmdb_rating ?? null,
          poplogScore: r.poplog_score ?? null,
          poplogComponents: components > 0 ? components : undefined,
        };
      }
    } catch (error) {
      console.warn("[poplog3/titles] ratings sync falhou:", error);
    }

    let availabilityCache: {
      source: string;
      tmdb: string;
      watchmode: string;
      motn: string;
    } | null = null;

    let providers: Array<{
      name: string;
      logoUrl: string | null;
      type: "streaming" | "rent" | "buy" | "free" | "ads";
      deepLink: string | null;
      quality: string | null;
      country: string;
      source: string;
    }> = [];

    try {
      const result = await syncAvailability({
        tmdbId: id,
        mediaType,
        country,
        tmdbPayload: (synced.rawPayload ?? null) as TmdbPayloadWithWatch | null,
        imdbId,
        force: refresh,
      });

      availabilityCache = {
        source: result.source,
        tmdb: result.diagnostics.tmdb,
        watchmode: result.diagnostics.watchmode,
        motn: result.diagnostics.motn,
      };

      const rows =
        result.rows.length > 0
          ? result.rows
          : await getAvailability(mediaType, id, country);

      providers = rows.map((r) => ({
        name: r.provider_name,
        logoUrl: tmdbImage(r.provider_logo_path, "w92"),
        type: r.availability_type,
        deepLink: r.deep_link,
        quality: r.quality,
        country: r.country,
        source: r.source,
      }));
    } catch (error) {
      console.warn("[poplog3/titles] availability sync falhou:", error);
    }

    let availabilityState: TitleAvailabilityState = "unknown";

    try {
      availabilityState = availabilityStateFromTitle({
        media_type: title.media_type,
        release_date: title.release_date ?? null,
        first_air_date: details?.first_air_date ?? null,
        last_air_date: details?.last_air_date ?? null,
        status: details?.status ?? null,
        next_episode_to_air: details?.next_episode_to_air ?? null,
        last_episode_to_air: details?.last_episode_to_air ?? null,
      });
    } catch (error) {
      console.warn("[poplog3/titles] availabilityState falhou:", error);
    }

    const trailer = (() => {
      try {
        const videos = details?.videos ?? [];
        const youTube = videos.filter((v) => v.site === "YouTube");
        const preferred = youTube.find((v) => v.type === "Trailer");
        const pick = preferred ?? youTube[0] ?? null;

        if (!pick) return null;

        return {
          key: pick.key,
          name: pick.name,
          url: `https://www.youtube.com/watch?v=${pick.key}`,
          embedUrl: `https://www.youtube.com/embed/${pick.key}`,
        };
      } catch {
        return null;
      }
    })();

    const validSeasons = filterValidSeasons(details?.seasons);

    const seasonsForUi = validSeasons.map((s) => ({
      seasonNumber: s.season_number,
      name: s.name,
      airDate: s.air_date,
      episodeCount: s.episode_count,
    }));

    const validSeasonNumbers = new Set(
      validSeasons.map((s) => s.season_number)
    );

    const rawNext = details?.next_episode_to_air ?? null;

    const nextEpisode =
      rawNext &&
      (rawNext.season_number === undefined ||
        rawNext.season_number === null ||
        validSeasonNumbers.has(rawNext.season_number ?? -1))
        ? rawNext
        : null;

    const crew = details?.crew ?? [];

    const metadata = details
      ? {
          productionCompanies:
            details.production_companies?.map((c) => ({
              id: c.id,
              name: c.name,
              logoPath: c.logo_path ?? null,
              originCountry: c.origin_country ?? null,
            })) ?? [],

          productionCountries:
            details.production_countries?.map((c) => ({
              code: c.iso_3166_1,
              name: c.name,
            })) ?? [],

          spokenLanguages:
            details.spoken_languages?.map((l) => ({
              code: l.iso_639_1,
              name: l.name,
            })) ?? [],

          homepage: details.homepage ?? null,

          budget: details.budget ?? null,

          revenue: details.revenue ?? null,

          collection: details.belongs_to_collection
            ? {
                id: details.belongs_to_collection.id,
                name: details.belongs_to_collection.name,
                posterPath: details.belongs_to_collection.poster_path ?? null,
                backdropPath:
                  details.belongs_to_collection.backdrop_path ?? null,
              }
            : null,

          networks:
            details.networks?.map((n) => ({
              id: n.id,
              name: n.name,
              logoPath: n.logo_path ?? null,
              originCountry: n.origin_country ?? null,
            })) ?? [],

          episodeRunTimeMinutes: avgRuntime(details.episode_run_time ?? null),

          productionStatus: details.status ?? null,

          inProduction: details.in_production ?? null,

          seriesType: details.type ?? null,

          creators: uniqueNames(
            details.created_by?.map((p) => p.name) ?? [],
            4
          ),

          directors: uniqueNames(
            crew.filter((p) => p.job === "Director").map((p) => p.name),
            4
          ),

          writers: uniqueNames(
            crew
              .filter(
                (p) =>
                  p.job === "Writer" ||
                  p.job === "Screenplay" ||
                  p.job === "Story"
              )
              .map((p) => p.name),
            4
          ),

          showrunners: uniqueNames(
            crew
              .filter(
                (p) =>
                  p.job === "Showrunner" ||
                  p.job === "Executive Producer"
              )
              .map((p) => p.name),
            3
          ),

          composers: uniqueNames(
            crew
              .filter(
                (p) => p.job === "Original Music Composer" || p.job === "Music"
              )
              .map((p) => p.name),
            3
          ),
        }
      : null;

    const payload = {
      id: title.tmdb_id,
      mediaType: title.media_type,
      title: title.title ?? "Sem titulo",
      originalTitle: title.original_title ?? null,
      tagline: details?.tagline ?? null,
      year: title.year ?? null,
      releaseDate: title.release_date ?? null,
      firstAirDate: details?.first_air_date ?? null,
      lastAirDate: details?.last_air_date ?? null,
      numberOfSeasons:
        validSeasons.length > 0
          ? validSeasons.length
          : details?.number_of_seasons ?? null,
      numberOfEpisodes: validSeasons.reduce(
        (total, season) => total + (season.episode_count ?? 0),
        0
      ),
      overview: title.overview ?? null,
      posterUrl: tmdbImage(title.poster_path, "w780"),
      backdropUrl: tmdbImage(title.backdrop_path, "original"),
      runtime: details?.runtime ?? null,
      voteAverage: title.vote_average ?? null,
      genres: details?.genres?.map((g) => g.name) ?? [],
      status: details?.status ?? null,
      availabilityState,
      certification: null,
      trailer,
      nextEpisode,
      seasons: seasonsForUi,
      ratings,
      userState,
      userSeriesProgress,
      providers,
      country,

      cast:
        details?.cast?.map((person) => ({
          id: person.id,
          name: person.name,
          character: person.character ?? null,
          photoUrl: tmdbImage(person.profile_path, "w185"),
        })) ?? [],

      crew:
        details?.crew?.map((person) => ({
          id: person.id,
          name: person.name,
          job: person.job,
          department: person.department ?? null,
          photoUrl: tmdbImage(person.profile_path, "w185"),
        })) ?? [],

      recommendations:
        (details?.recommendations ?? []).slice(0, 12).map((item) => {
          const year =
            item.release_date?.slice(0, 4) ??
            item.first_air_date?.slice(0, 4) ??
            null;

          return {
            id: item.id,
            mediaType: item.media_type,
            title: item.title,
            year,
            posterPath: item.poster_path ?? null,
            posterUrl: tmdbImage(item.poster_path, "w342"),
          };
        }),

      metadata,

      lastSyncedAt: title.last_synced_at ?? null,

      cacheInfo: {
        title: {
          source: synced.source,
          status: synced.cache_status,
        },
        ratings: ratingsCache,
        availability: availabilityCache,
      },
    };

    return NextResponse.json(payload, {
      headers: {
        "x-poplog-source": synced.source,
        "x-poplog-cache": synced.cache_status,
        "x-poplog-availability": availabilityCache?.source ?? "unknown",
      },
    });
  } catch (error) {
    console.error("[poplog3/titles] erro:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to fetch title",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}