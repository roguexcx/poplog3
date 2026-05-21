/**
 * get-title-page-data.ts
 *
 * Lógica central para montar o TitlePageData de um título.
 * Usada tanto pela page.tsx (diretamente, sem fetch HTTP)
 * quanto pela route handler /api/poplog3/titles/[mediaType]/[id].
 */

import type { AvailabilityProvider } from "@/server/streaming/availability-service";
import {
  availabilityStateFromTitle,
  isValidSeason,
  type TitleAvailabilityState,
} from "@/lib/series";
import { resolveRuntimeByMediaType } from "@/lib/runtime";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getExternalIds } from "@/server/cache/external-ids-cache";
import { computeUserSeriesProgress } from "@/server/episodes/episode-progress-service";
import {
  readTitleState,
  refreshTitleStateAvailability,
} from "@/server/state/user-title-state";
import { getUserTitleStatus } from "@/server/library/library-service";
import { getUserProviderPreferences } from "@/server/streaming/user-provider-preferences";
import { getTitleAvailability } from "@/server/streaming/title-availability";
import { withOrigin } from "@/server/engine-logger";
import type { TmdbPayloadWithWatch } from "@/server/sync/sync-availability";
import { syncOmdbRatings } from "@/server/sync/sync-omdb-ratings";
import { syncTmdbTitle } from "@/server/sync/sync-tmdb-title";
import { fetchTmdbCollection } from "@/server/api-clients/tmdb/client";
import { findOfficialTrailerOnYouTube } from "@/server/trailers/youtube-trailer";
import { getSeriesEpisodeRuntimes } from "@/server/runtime/series-episode-runtimes";
import type { PoplogTitleDetails } from "@/server/types/title-details";
import type { TitlePageData } from "@/features/title/types";

type MediaType = "movie" | "tv";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

function tmdbImage(path: string | null | undefined, size: string) {
  if (!path) return null;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${TMDB_IMAGE_BASE}/${size}${normalized}`;
}

function hasDetailFields(
  title: PoplogTitleDetails | Record<string, unknown>,
): title is PoplogTitleDetails {
  return (
    typeof title === "object" &&
    title !== null &&
    ("cast" in title || "recommendations" in title || "runtime" in title)
  );
}

function uniqueNames(names: Array<string | null | undefined>, limit = 4) {
  return Array.from(
    new Set(
      names
        .map((name) => name?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ).slice(0, limit);
}

function filterValidSeasons(
  seasons: PoplogTitleDetails["seasons"] | undefined,
) {
  if (!seasons || seasons.length === 0) return [];
  return seasons
    .filter(isValidSeason)
    .sort((a, b) => a.season_number - b.season_number);
}

export type GetTitlePageDataOptions = {
  mediaType: MediaType;
  id: number;
  force?: boolean;
  country?: string;
};

/**
 * Monta o TitlePageData completo para um título.
 * Retorna null se o id/mediaType for inválido ou o sync falhar.
 */
export async function getTitlePageData(
  options: GetTitlePageDataOptions,
): Promise<TitlePageData | null> {
  const { mediaType, id, force = false, country = "BR" } = options;

  if (mediaType !== "movie" && mediaType !== "tv") return null;
  if (!id || Number.isNaN(id)) return null;

  return withOrigin("title", async () => {
    try {
      const synced = await syncTmdbTitle(mediaType, id, { force });
      const title = synced.title;

      const details = hasDetailFields(title) ? title : null;
      const currentUser = await getCurrentUser();

      let userState: {
        isAuthenticated: boolean;
        inWatchlist?: boolean;
        watching?: boolean;
        watched?: boolean;
        favorite?: boolean;
        liked?: boolean;
        disliked?: boolean;
        computedState?: string | null;
      } = { isAuthenticated: Boolean(currentUser) };

      let userSeriesProgress: {
        watchedCount: number;
        totalEpisodes: number | null;
        airedEpisodes: number;
        lastWatchedAt: string | null;
        watchedKeys: string[];
        nextEpisode: { seasonNumber: number; episodeNumber: number } | null;
      } | null = null;

      if (currentUser) {
        try {
          const state = await readTitleState(currentUser.id, id, mediaType);

          if (state) {
            userState = {
              isAuthenticated: true,
              inWatchlist: state.status === "watchlist",
              watching: state.status === "watching",
              watched: state.status === "watched",
              favorite: Boolean(state.favorite),
              liked: state.liked === true,
              disliked: state.liked === false,
              computedState: state.computed_state,
            };

            if (mediaType === "tv") {
              userSeriesProgress = {
                watchedCount: state.watched_episodes,
                totalEpisodes: state.total_episodes,
                airedEpisodes: state.aired_episodes,
                lastWatchedAt: state.last_watched_at,
                watchedKeys: state.watched_keys,
                nextEpisode:
                  state.next_season !== null && state.next_episode !== null
                    ? {
                        seasonNumber: state.next_season,
                        episodeNumber: state.next_episode,
                      }
                    : null,
              };
            }
          } else {
            const [status, progress] = await Promise.all([
              getUserTitleStatus(currentUser.id, id, mediaType),
              mediaType === "tv"
                ? computeUserSeriesProgress(currentUser.id, id)
                : Promise.resolve(null),
            ]);

            userState = {
              isAuthenticated: true,
              inWatchlist: status?.status === "watchlist",
              watching: status?.status === "watching",
              watched: status?.status === "watched",
              favorite: Boolean(status?.favorite),
              liked: status?.liked === true,
              disliked: status?.liked === false,
            };

            if (progress) {
              userSeriesProgress = {
                watchedCount: progress.watchedCount,
                totalEpisodes: progress.totalEpisodes,
                airedEpisodes: progress.airedEpisodes,
                lastWatchedAt: progress.lastWatchedAt,
                watchedKeys: progress.watchedKeys,
                nextEpisode: progress.nextEpisode,
              };
            }
          }
        } catch (error) {
          console.warn("[getTitlePageData] state lookup falhou:", error);
          userState = { isAuthenticated: true };
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
          force,
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
        console.warn("[getTitlePageData] ratings sync falhou:", error);
      }

      let availabilityCache: {
        source: string;
        tmdb: string;
        watchmode: string;
        motn: string;
      } | null = null;

      let providers: AvailabilityProvider[] = [];
      let availability:
        | Awaited<ReturnType<typeof getTitleAvailability>>["availability"]
        | undefined = undefined;

      let userStreamingPreferences:
        | Awaited<ReturnType<typeof getUserProviderPreferences>>
        | undefined;
      if (currentUser) {
        try {
          userStreamingPreferences = await getUserProviderPreferences();
        } catch {
          // ignora — usa ranking genérico
        }
      }

      try {
        const result = await getTitleAvailability({
          tmdbId: id,
          mediaType,
          tmdbPayload: (synced.rawPayload ??
            null) as TmdbPayloadWithWatch | null,
          imdbId,
          force,
          preferences: userStreamingPreferences,
          releaseDate: title.release_date ?? null,
          firstAirDate: details?.first_air_date ?? null,
          popularity: title.popularity ?? null,
          contexts: ["title_page"],
        });

        availabilityCache = result.cacheInfo;
        availability = result.availability;
        providers = result.providers;

        if (currentUser) {
          const best = availability.primaryProvider;
          const providerType: string | null =
            best && "normalizedType" in best
              ? best.normalizedType ?? null
              : best?.type === "streaming"
                ? "subscription"
                : best?.type ?? null;

          refreshTitleStateAvailability(
            currentUser.id,
            id,
            mediaType,
            best
              ? {
                  providerName: best.name,
                  providerType,
                  providerLogo: best.logoUrl ?? null,
                }
              : null,
          ).catch(console.error);
        }
      } catch (error) {
        console.warn("[getTitlePageData] availability sync falhou:", error);
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
        console.warn("[getTitlePageData] availabilityState falhou:", error);
      }

      const trailer = await (async () => {
        try {
          const videos = details?.videos ?? [];
          const youTube = videos.filter((v) => v.site === "YouTube");

          const normalize = (value: string | null | undefined) =>
            (value ?? "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[̀-ͯ]/g, "")
              .replace(/&amp;/g, "&")
              .replace(/[^\p{L}\p{N}]+/gu, " ")
              .trim();

          const includesAny = (text: string, terms: string[]) =>
            terms.some((term) => text.includes(normalize(term)));

          const getVideoScore = (v: (typeof youTube)[number]) => {
            const name = normalize(v.name);
            let score = 0;

            const badTerms = [
              "globo",
              "telecine",
              "megapix",
              "tnt",
              "warner channel",
              "sessao da tarde",
              "temperatura maxima",
              "cinemaco",
              "supercine",
              "chamada",
              "exibicao",
              "na tv",
              "hoje",
              "amanha",
              "review",
              "reaction",
              "explained",
              "breakdown",
              "interview",
              "entrevista",
              "scene",
              "cena",
              "clip",
              "recap",
              "making of",
              "behind the scenes",
              "featurette",
              "bloopers",
              "fanmade",
              "fandub",
              "trailer fan",
              "dublagem caseira",
              "redublado",
            ];

            if (includesAny(name, badTerms)) return -999;

            if (v.type === "Trailer") score += 140;
            if (v.type === "Teaser") score += 25;
            if (v.official === true) score += 120;

            if (name.includes("trailer oficial")) score += 130;
            if (name.includes("official trailer")) score += 120;
            if (name.includes("trailer")) score += 80;

            if (
              name.includes("dublado") ||
              name.includes("dubbed") ||
              name.includes("pt br") ||
              name.includes("portugues brasileiro")
            ) {
              score += 140;
            } else if (
              name.includes("legendado") ||
              name.includes("subtitulado") ||
              name.includes("subtitled") ||
              name.includes("legendas")
            ) {
              score += 95;
            } else if (v.iso_639_1 === "pt") {
              score += 65;
            } else if (v.iso_639_1 === "en") {
              score += 40;
            }

            if (name.includes("teaser")) score -= 35;

            return score;
          };

          const tmdbPick = youTube
            .map((video) => ({ video, score: getVideoScore(video) }))
            .filter((item) => item.score >= 160)
            .sort((a, b) => b.score - a.score)[0];

          if (tmdbPick?.video) {
            return {
              key: tmdbPick.video.key,
              name: tmdbPick.video.name,
              url: `https://www.youtube.com/watch?v=${tmdbPick.video.key}`,
              embedUrl: `https://www.youtube.com/embed/${tmdbPick.video.key}`,
              source: "tmdb",
              confidence:
                tmdbPick.score >= 420
                  ? "high"
                  : tmdbPick.score >= 280
                    ? "medium"
                    : "low",
              score: tmdbPick.score,
            };
          }

          const youtubeKey = await findOfficialTrailerOnYouTube({
            title: title.title ?? title.original_title ?? "Título",
            year: title.year ? String(title.year) : null,
            mediaType,
          });

          if (!youtubeKey) return null;

          return {
            key: youtubeKey,
            name: `Trailer de ${title.title ?? title.original_title ?? "Título"}`,
            url: `https://www.youtube.com/watch?v=${youtubeKey}`,
            embedUrl: `https://www.youtube.com/embed/${youtubeKey}`,
            source: "youtube",
            confidence: "medium",
            score: null,
          };
        } catch (error) {
          console.warn("[getTitlePageData] trailer lookup falhou:", error);
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
        validSeasons.map((s) => s.season_number),
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

      const collectionDetails =
        details?.belongs_to_collection && mediaType === "movie"
          ? await fetchTmdbCollection(details.belongs_to_collection.id)
          : null;

      const seriesEpisodeRuntimes =
        mediaType === "tv" ? await getSeriesEpisodeRuntimes(id) : null;

      const runtimeResolution = resolveRuntimeByMediaType({
        mediaType,
        runtimeMinutes: details?.runtime ?? null,
        episodeRunTime: details?.episode_run_time ?? null,
        episodes: seriesEpisodeRuntimes,
      });

      const numberOfEpisodes = validSeasons.reduce(
        (total, season) => total + (season.episode_count ?? 0),
        0,
      );

      const totalRuntimeMinutes =
        mediaType === "tv" &&
        runtimeResolution.minutes !== null &&
        numberOfEpisodes > 0
          ? runtimeResolution.minutes * numberOfEpisodes
          : null;

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
                  posterPath:
                    details.belongs_to_collection.poster_path ?? null,
                  backdropPath:
                    details.belongs_to_collection.backdrop_path ?? null,
                  parts: collectionDetails
                    ? collectionDetails.parts
                        .filter((p) => Boolean(p.release_date))
                        .sort((a, b) =>
                          (a.release_date ?? "") < (b.release_date ?? "")
                            ? -1
                            : 1,
                        )
                        .map((p) => ({
                          id: p.id,
                          title: p.title ?? p.original_title ?? "Sem título",
                          releaseDate: p.release_date ?? null,
                          year: p.release_date
                            ? new Date(p.release_date).getFullYear()
                            : null,
                          posterPath: p.poster_path ?? null,
                        }))
                    : [],
                }
              : null,

            networks:
              details.networks?.map((n) => ({
                id: n.id,
                name: n.name,
                logoPath: n.logo_path ?? null,
                originCountry: n.origin_country ?? null,
              })) ?? [],

            episodeRunTimeMinutes:
              mediaType === "tv" ? runtimeResolution.minutes : null,
            episodeRunTimeEstimated:
              mediaType === "tv" ? runtimeResolution.estimated : false,
            totalRuntimeMinutes,
            totalRuntimeEstimated:
              mediaType === "tv" ? runtimeResolution.estimated : false,
            productionStatus: details.status ?? null,
            inProduction: details.in_production ?? null,
            seriesType: details.type ?? null,

            creators: uniqueNames(
              details.created_by?.map((p) => p.name) ?? [],
              4,
            ),

            directors: uniqueNames(
              crew.filter((p) => p.job === "Director").map((p) => p.name),
              4,
            ),

            writers: uniqueNames(
              crew
                .filter(
                  (p) =>
                    p.job === "Writer" ||
                    p.job === "Screenplay" ||
                    p.job === "Story",
                )
                .map((p) => p.name),
              4,
            ),

            showrunners: uniqueNames(
              crew
                .filter(
                  (p) =>
                    p.job === "Showrunner" ||
                    p.job === "Executive Producer",
                )
                .map((p) => p.name),
              3,
            ),

            composers: uniqueNames(
              crew
                .filter(
                  (p) =>
                    p.job === "Original Music Composer" || p.job === "Music",
                )
                .map((p) => p.name),
              3,
            ),
          }
        : null;

      const payload: TitlePageData = {
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
        numberOfEpisodes,
        overview: title.overview ?? null,
        posterUrl: tmdbImage(title.poster_path, "w780"),
        backdropUrl: tmdbImage(title.backdrop_path, "original"),
        runtime: mediaType === "movie" ? runtimeResolution.minutes : null,
        episodeRunTimeMinutes:
          mediaType === "tv" ? runtimeResolution.minutes : null,
        runtimeEstimated: runtimeResolution.estimated,
        totalRuntimeMinutes,
        totalRuntimeEstimated:
          mediaType === "tv" ? runtimeResolution.estimated : false,
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
        availability,
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

        recommendations: (details?.recommendations ?? [])
          .slice(0, 12)
          .map((item) => {
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

      return payload;
    } catch (error) {
      console.error("[getTitlePageData] erro:", error);
      return null;
    }
  });
}
