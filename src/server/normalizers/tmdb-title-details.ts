import { normalizeTmdbTitle } from "./tmdb-title";

import {
  PoplogTitleCastMember,
  PoplogTitleCollection,
  PoplogTitleCompany,
  PoplogTitleCountry,
  PoplogTitleCreator,
  PoplogTitleCrewMember,
  PoplogTitleDetails,
  PoplogTitleEpisodeStub,
  PoplogTitleLanguage,
  PoplogTitleNetwork,
  PoplogTitleSeasonStub,
  PoplogTitleVideo,
} from "@/server/types/title-details";

import type { TmdbTitleSummary } from "@/server/api-clients/tmdb/types";

type TmdbGenre = { id: number; name: string };

type TmdbCastPerson = {
  id: number;
  name: string;
  character: string | null;
  profile_path: string | null;
};

type TmdbCrewPerson = {
  id: number;
  name: string;
  job: string;
  department?: string | null;
  profile_path?: string | null;
};

type TmdbVideo = {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official?: boolean | null;
  iso_639_1?: string | null;
  iso_3166_1?: string | null;
  published_at?: string | null;
};

type TmdbEpisodeStub = {
  air_date?: string | null;
  episode_number?: number | null;
  season_number?: number | null;
  name?: string | null;
};

type TmdbSeasonStub = {
  season_number?: number;
  name?: string | null;
  overview?: string | null;
  poster_path?: string | null;
  air_date?: string | null;
  episode_count?: number | null;
  vote_average?: number | null;
};

type TmdbRecommendationTitle = TmdbTitleSummary & {
  media_type?: "movie" | "tv";
};

export type TmdbTitleDetailsPayload = TmdbTitleSummary & {
  runtime?: number | null;
  tagline?: string | null;
  status?: string | null;

  genres?: TmdbGenre[];

  credits?: {
    cast?: TmdbCastPerson[];
    crew?: TmdbCrewPerson[];
  };

  videos?: { results?: TmdbVideo[] };
  recommendations?: { results?: TmdbRecommendationTitle[] };
  similar?: { results?: TmdbRecommendationTitle[] };

  first_air_date?: string | null;
  last_air_date?: string | null;
  number_of_seasons?: number | null;
  number_of_episodes?: number | null;
  next_episode_to_air?: TmdbEpisodeStub | null;
  last_episode_to_air?: TmdbEpisodeStub | null;
  seasons?: TmdbSeasonStub[];
};

const RELEVANT_CREW_JOBS = new Set([
  "Director",
  "Screenplay",
  "Writer",
  "Story",
  "Teleplay",
  "Author",
  "Original Music Composer",
  "Music",
  "Director of Photography",
  "Editor",
  "Producer",
  "Executive Producer",
]);

function normalizeCrew(
  crew: TmdbCrewPerson[] | undefined
): PoplogTitleCrewMember[] {
  if (!crew || crew.length === 0) return [];

  const seen = new Set<string>();
  const out: PoplogTitleCrewMember[] = [];

  for (const person of crew) {
    if (!RELEVANT_CREW_JOBS.has(person.job)) continue;
    const key = `${person.id}-${person.job}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: person.id,
      name: person.name,
      job: person.job,
      department: person.department ?? null,
      profile_path: person.profile_path ?? null,
    });
  }

  return out;
}

function normalizeSeasons(
  seasons: TmdbSeasonStub[] | undefined
): PoplogTitleSeasonStub[] {
  if (!seasons || seasons.length === 0) return [];
  return seasons
    .filter((s) => typeof s.season_number === "number")
    .map((s) => ({
      season_number: s.season_number as number,
      name: s.name ?? null,
      overview: s.overview ?? null,
      poster_path: s.poster_path ?? null,
      air_date: s.air_date ?? null,
      episode_count: s.episode_count ?? null,
      vote_average:
        typeof s.vote_average === "number" ? s.vote_average : null,
    }));
}

export function normalizeTmdbTitleDetails(
  data: TmdbTitleDetailsPayload
): PoplogTitleDetails | null {
  const baseTitle = normalizeTmdbTitle(data);

  if (!baseTitle) {
    return null;
  }

  const cast: PoplogTitleCastMember[] =
    data.credits?.cast
      ?.slice(0, 30)
      ?.map((person) => ({
        id: person.id,
        name: person.name,
        character: person.character,
        profile_path: person.profile_path,
      })) ?? [];

  const crew = normalizeCrew(data.credits?.crew);

  const videos: PoplogTitleVideo[] =
    data.videos?.results
      ?.filter((video) => video.site === "YouTube")
      ?.slice(0, 20)
      ?.map((video) => ({
        id: video.id,
        key: video.key,
        name: video.name,
        site: video.site,
        type: video.type,
        official: video.official ?? null,
        iso_639_1: video.iso_639_1 ?? null,
        iso_3166_1: video.iso_3166_1 ?? null,
        published_at: video.published_at ?? null,
      })) ?? [];

  const recommendations =
    data.recommendations?.results
      ?.slice(0, 18)
      ?.map((item) => normalizeRecommendationTitle(item, data.media_type))
      ?.filter(Boolean) ?? [];

  const similar =
    data.similar?.results
      ?.slice(0, 18)
      ?.map((item) => normalizeRecommendationTitle(item, data.media_type))
      ?.filter(Boolean) ?? [];

  const { genres: _baseGenres, ...baseTitleWithoutGenres } = baseTitle;
  void _baseGenres;

  const normalizeEpisode = (
    ep: TmdbEpisodeStub | null | undefined
  ): PoplogTitleEpisodeStub | null => {
    if (!ep) return null;
    return {
      air_date: ep.air_date ?? null,
      episode_number: ep.episode_number ?? null,
      season_number: ep.season_number ?? null,
      name: ep.name ?? null,
    };
  };

  const productionCompanies: PoplogTitleCompany[] =
    data.production_companies?.map((c) => ({
      id: c.id,
      name: c.name,
      logo_path: c.logo_path ?? null,
      origin_country: c.origin_country ?? null,
    })) ?? [];

  const productionCountries: PoplogTitleCountry[] =
    data.production_countries?.map((c) => ({
      iso_3166_1: c.iso_3166_1,
      name: c.name,
    })) ?? [];

  const spokenLanguages: PoplogTitleLanguage[] =
    data.spoken_languages?.map((l) => ({
      iso_639_1: l.iso_639_1,
      name: l.name ?? l.english_name ?? l.iso_639_1,
      english_name: l.english_name ?? null,
    })) ?? [];

  const collection: PoplogTitleCollection | null = data.belongs_to_collection
    ? {
        id: data.belongs_to_collection.id,
        name: data.belongs_to_collection.name,
        poster_path: data.belongs_to_collection.poster_path ?? null,
        backdrop_path: data.belongs_to_collection.backdrop_path ?? null,
      }
    : null;

  const networks: PoplogTitleNetwork[] =
    data.networks?.map((n) => ({
      id: n.id,
      name: n.name,
      logo_path: n.logo_path ?? null,
      origin_country: n.origin_country ?? null,
    })) ?? [];

  const createdBy: PoplogTitleCreator[] =
    data.created_by?.map((c) => ({
      id: c.id,
      name: c.name,
      profile_path: c.profile_path ?? null,
    })) ?? [];

  return {
    ...baseTitleWithoutGenres,

    runtime: data.runtime ?? null,
    tagline: data.tagline ?? null,
    status: data.status ?? null,

    genres:
      data.genres?.map((genre) => ({
        id: genre.id,
        name: genre.name,
      })) ?? [],

    cast,
    crew,
    videos,
    recommendations,
    similar,

    first_air_date: data.first_air_date ?? null,
    last_air_date: data.last_air_date ?? null,
    number_of_seasons: data.number_of_seasons ?? null,
    number_of_episodes: data.number_of_episodes ?? null,
    next_episode_to_air: normalizeEpisode(data.next_episode_to_air),
    last_episode_to_air: normalizeEpisode(data.last_episode_to_air),
    seasons: normalizeSeasons(data.seasons),

    production_companies: productionCompanies,
    production_countries: productionCountries,
    spoken_languages: spokenLanguages,
    homepage: data.homepage ?? null,

    budget: data.budget ?? null,
    revenue: data.revenue ?? null,
    belongs_to_collection: collection,

    networks,
    created_by: createdBy,
    type: data.type ?? null,
    in_production: data.in_production ?? null,
  } as PoplogTitleDetails;
}

function normalizeRecommendationTitle(
  item: TmdbRecommendationTitle,
  fallbackMediaType?: "movie" | "tv"
) {
  if (!item.id) return null;

  const mediaType =
    item.media_type ??
    fallbackMediaType ??
    (item.name || item.first_air_date ? "tv" : "movie");

  const rawOriginalTitle = mediaType === "movie" ? item.original_title : item.original_name;

  return {
    id: item.id,
    media_type: mediaType,
    title: item.title ?? item.name ?? "Untitled",
    name: item.name ?? item.title ?? "Untitled",
    original_title: rawOriginalTitle?.trim() || null,
    poster_path: item.poster_path ?? null,
    backdrop_path: item.backdrop_path ?? null,
    vote_average: item.vote_average ?? null,
    release_date: item.release_date ?? null,
    first_air_date: item.first_air_date ?? null,
  };
}
