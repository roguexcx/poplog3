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

type CreditItem = TMDBItem & {
  character?: string;
  job?: string;
  department?: string;
  order?: number;
  episode_count?: number;
  vote_count?: number;
};

async function fetchTmdb<T>(
  endpoint: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
  revalidate?: number,
  language?: string | null,
): Promise<T> {
  const { tmdbFetch } = await import("@/lib/tmdb");
  return tmdbFetch<T>(endpoint, params, revalidate, language);
}

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

const TV_CONTEXT_GENRES = new Set([10763, 10764, 10767]);
const CREATIVE_JOBS = new Set([
  "Creator",
  "Director",
  "Screenplay",
  "Story",
  "Teleplay",
  "Writer",
]);

function normalizedCreditText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isSelfAppearance(item: CreditItem): boolean {
  const character = normalizedCreditText(item.character);
  if (!character) return false;
  return /\b(self|himself|herself|guest|host|presenter|entrevistado|entrevistada)\b/.test(character);
}

function isContextProgram(item: CreditItem): boolean {
  return item.media_type === "tv" && (item.genre_ids ?? []).some((genreId) => TV_CONTEXT_GENRES.has(genreId));
}

function getPrimaryCareerPool(person: TmdbPerson, cast: CreditItem[], crew: CreditItem[]): CreditItem[] {
  const department = person.known_for_department;
  if (department === "Acting") {
    const acted = cast.filter((item) => !isSelfAppearance(item) && !isContextProgram(item));
    return acted.length >= 6 ? acted : cast;
  }

  if (department === "Directing") {
    const directed = crew.filter((item) => item.job === "Director" || item.job === "Creator");
    return directed.length >= 4 ? directed : crew.filter((item) => item.department === "Directing");
  }

  if (department === "Writing") {
    const written = crew.filter((item) => item.department === "Writing" || CREATIVE_JOBS.has(item.job ?? ""));
    return written.length >= 4 ? written : crew;
  }

  if (department === "Production") {
    const produced = crew.filter((item) => item.department === "Production");
    return produced.length >= 4 ? produced : crew;
  }

  const sameDepartment = crew.filter((item) => item.department === department);
  return sameDepartment.length >= 4 ? sameDepartment : uniqueTitles([...cast, ...crew]) as CreditItem[];
}

function careerScore(item: CreditItem, person: TmdbPerson): number {
  const popularity = item.popularity ?? 0;
  const rating = item.vote_average ?? 0;
  const votes = item.vote_count ?? 0;
  const order = typeof item.order === "number" ? item.order : 99;
  const episodeCount = item.episode_count ?? 0;
  const department = person.known_for_department;

  let score = popularity + rating * 8 + Math.min(votes / 500, 12);

  if (item.media_type === "movie") score += 10;
  if (department === "Acting") {
    if (order <= 2) score += 36;
    else if (order <= 5) score += 24;
    else if (order <= 10) score += 10;
    if (episodeCount > 1) score += Math.min(episodeCount, 80) * 0.45;
    if (isSelfAppearance(item)) score -= 95;
    if (isContextProgram(item)) score -= 80;
    if (!item.character) score -= 18;
  } else {
    if (item.department === department) score += 35;
    if (CREATIVE_JOBS.has(item.job ?? "")) score += 28;
    if (item.job === "Director" || item.job === "Creator") score += 18;
    if (isContextProgram(item)) score -= 28;
  }

  return score;
}

function sortByCareerRelevance(items: CreditItem[], person: TmdbPerson) {
  return [...items].sort((a, b) => careerScore(b, person) - careerScore(a, person));
}

export async function fetchGenreName(media: IndexedMediaType, id: number): Promise<string> {
  const data = await fetchTmdb<{ genres: TmdbGenre[] }>(`/genre/${media}/list`, {}, 60 * 60 * 24);
  return data.genres.find((genre) => genre.id === id)?.name ?? "Gênero";
}

export async function fetchGenreList(media: IndexedMediaType): Promise<TmdbGenre[]> {
  const data = await fetchTmdb<{ genres: TmdbGenre[] }>(`/genre/${media}/list`, {}, 60 * 60 * 24);
  return data.genres ?? [];
}

export async function fetchGenreTitles(media: IndexedMediaType, id: number, page = 1) {
  const endpoint = media === "tv" ? "/discover/tv" : "/discover/movie";
  const data = await fetchTmdb<TMDBResponse<TMDBItem>>(endpoint, {
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
  const data = await fetchTmdb<TmdbCollection>(`/collection/${collectionId}`, {}, 60 * 60 * 12);
  const parts = sortByRelease(uniqueTitles(data.parts ?? [], "movie"), "asc")
    .filter((item) => item.id !== currentId);
  return { ...data, parts };
}

export async function fetchPersonIndex(id: number) {
  const person = await fetchTmdb<TmdbPerson>(`/person/${id}`, {
    append_to_response: "movie_credits,tv_credits",
  }, 60 * 60 * 12);
  const cast = uniqueTitles([
    ...(person.movie_credits?.cast ?? []).map((item) => ({ ...item, media_type: "movie" as const })),
    ...(person.tv_credits?.cast ?? []).map((item) => ({ ...item, media_type: "tv" as const })),
  ]) as CreditItem[];
  const crew = uniqueTitles([
    ...(person.movie_credits?.crew ?? []).map((item) => ({ ...item, media_type: "movie" as const })),
    ...(person.tv_credits?.crew ?? []).map((item) => ({ ...item, media_type: "tv" as const })),
  ]) as CreditItem[];
  const all = uniqueTitles([...cast, ...crew]) as CreditItem[];
  const careerPool = getPrimaryCareerPool(person, cast, crew);

  return {
    person,
    knownFor: sortByCareerRelevance(careerPool.length ? careerPool : all, person).slice(0, 18),
    recent: sortByRelease(all).slice(0, 24),
    cast: sortByCareerRelevance(cast, { ...person, known_for_department: "Acting" }),
    crew: sortByCareerRelevance(crew, person),
  };
}

export async function fetchStudioIndex(kind: StudioKind, id: number, media: IndexedMediaType | "all" = "all", page = 1) {
  const studio = kind === "company"
    ? await fetchTmdb<TmdbStudio>(`/company/${id}`, {}, 60 * 60 * 24)
    : { id, name: "Estúdio", logo_path: null } as TmdbStudio;

  async function discover(target: IndexedMediaType) {
    const endpoint = target === "tv" ? "/discover/tv" : "/discover/movie";
    const key = kind === "network" && target === "tv" ? "with_networks" : "with_companies";
    const data = await fetchTmdb<TMDBResponse<TMDBItem>>(endpoint, {
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
