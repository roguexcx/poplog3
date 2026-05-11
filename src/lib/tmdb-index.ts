import { tmdbFetch } from "@/lib/tmdb";
import type { TMDBItem, TMDBMediaType, TMDBResponse } from "@/types/tmdb";

export type IndexedMediaType = TMDBMediaType;
export type StudioKind = "company" | "network";

export type TmdbGenre = {
  id: number;
  name: string;
};

export type TmdbCollection = {
  id: number;
  name: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  parts?: TMDBItem[];
};

export type TmdbPerson = {
  id: number;
  name: string;
  biography?: string;
  profile_path?: string | null;
  known_for_department?: string;
  birthday?: string | null;
  deathday?: string | null;
  place_of_birth?: string | null;
  movie_credits?: { cast?: TMDBItem[]; crew?: TMDBItem[] };
  tv_credits?: { cast?: TMDBItem[]; crew?: TMDBItem[] };
};

export type TmdbStudio = {
  id: number;
  name: string;
  description?: string;
  headquarters?: string;
  homepage?: string;
  logo_path?: string | null;
  origin_country?: string;
};

export function genreHref(media: IndexedMediaType, id: number) {
  return `/generos/${media}/${id}`;
}

export function personHref(id: number) {
  return `/pessoa/${id}`;
}

export function studioHref(kind: StudioKind, id: number) {
  return `/estudio/${kind}/${id}`;
}

export function mediaLabel(media: IndexedMediaType) {
  return media === "tv" ? "Séries" : "Filmes";
}

export function dateValue(item: TMDBItem): string {
  return item.release_date ?? item.first_air_date ?? "";
}

export function sortByRelease(items: TMDBItem[], direction: "asc" | "desc" = "desc") {
  return [...items].sort((a, b) => {
    const left = dateValue(a);
    const right = dateValue(b);
    if (!left && !right) return (b.popularity ?? 0) - (a.popularity ?? 0);
    if (!left) return 1;
    if (!right) return -1;
    return direction === "asc" ? left.localeCompare(right) : right.localeCompare(left);
  });
}

export function uniqueTitles(items: TMDBItem[], fallbackMedia?: IndexedMediaType) {
  const seen = new Set<string>();
  return items
    .filter((item) => item.id && (item.poster_path || item.backdrop_path))
    .map((item) => ({
      ...item,
      media_type: item.media_type === "tv" || item.media_type === "movie"
        ? item.media_type
        : fallbackMedia,
    }))
    .filter((item): item is TMDBItem & { media_type: IndexedMediaType } => Boolean(item.media_type))
    .filter((item) => {
      const key = `${item.media_type}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export async function fetchGenreName(media: IndexedMediaType, id: number): Promise<string> {
  const data = await tmdbFetch<{ genres: TmdbGenre[] }>(`/genre/${media}/list`, {}, 60 * 60 * 24);
  return data.genres.find((genre) => genre.id === id)?.name ?? "Gênero";
}

export async function fetchGenreList(media: IndexedMediaType): Promise<TmdbGenre[]> {
  const data = await tmdbFetch<{ genres: TmdbGenre[] }>(`/genre/${media}/list`, {}, 60 * 60 * 24);
  return data.genres ?? [];
}

export async function fetchGenreTitles(media: IndexedMediaType, id: number, page = 1) {
  const endpoint = media === "tv" ? "/discover/tv" : "/discover/movie";
  const data = await tmdbFetch<TMDBResponse<TMDBItem>>(endpoint, {
    page,
    with_genres: id,
    sort_by: "popularity.desc",
    include_adult: false,
    watch_region: "BR",
  }, 60 * 30);
  return {
    ...data,
    results: uniqueTitles(data.results ?? [], media),
  };
}

export async function fetchCollectionUniverse(collectionId: number, currentId?: number) {
  const data = await tmdbFetch<TmdbCollection>(`/collection/${collectionId}`, {}, 60 * 60 * 12);
  const parts = sortByRelease(uniqueTitles(data.parts ?? [], "movie"), "asc")
    .filter((item) => item.id !== currentId);
  return { ...data, parts };
}

export async function fetchPersonIndex(id: number) {
  const person = await tmdbFetch<TmdbPerson>(`/person/${id}`, {
    append_to_response: "movie_credits,tv_credits",
  }, 60 * 60 * 12);
  const cast = uniqueTitles([
    ...(person.movie_credits?.cast ?? []).map((item) => ({ ...item, media_type: "movie" as const })),
    ...(person.tv_credits?.cast ?? []).map((item) => ({ ...item, media_type: "tv" as const })),
  ]);
  const crew = uniqueTitles([
    ...(person.movie_credits?.crew ?? []).map((item) => ({ ...item, media_type: "movie" as const })),
    ...(person.tv_credits?.crew ?? []).map((item) => ({ ...item, media_type: "tv" as const })),
  ]);
  const all = uniqueTitles([...cast, ...crew]);
  return {
    person,
    knownFor: [...all].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)).slice(0, 18),
    recent: sortByRelease(all).slice(0, 24),
    cast,
    crew,
  };
}

export async function fetchStudioIndex(kind: StudioKind, id: number, media: IndexedMediaType | "all" = "all", page = 1) {
  const studio = kind === "company"
    ? await tmdbFetch<TmdbStudio>(`/company/${id}`, {}, 60 * 60 * 24)
    : { id, name: "Estúdio", logo_path: null } as TmdbStudio;

  async function discover(target: IndexedMediaType) {
    const endpoint = target === "tv" ? "/discover/tv" : "/discover/movie";
    const key = kind === "network" && target === "tv" ? "with_networks" : "with_companies";
    const data = await tmdbFetch<TMDBResponse<TMDBItem>>(endpoint, {
      page,
      [key]: id,
      sort_by: "popularity.desc",
      include_adult: false,
      watch_region: "BR",
    }, 60 * 60);
    return uniqueTitles(data.results ?? [], target);
  }

  const [movies, series] = await Promise.all([
    media === "tv" || kind === "network" ? Promise.resolve([]) : discover("movie"),
    media === "movie" ? Promise.resolve([]) : discover("tv"),
  ]);

  const results = media === "movie" ? movies : media === "tv" ? series : uniqueTitles([...movies, ...series]);
  return { studio, results, movies, series };
}
