
export type SocialMediaType = "movie" | "tv";

export type SocialContextInput = {
  tmdbId: number;
  mediaType: SocialMediaType;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  force?: boolean;
};

export type SocialContext = {
  tmdbId: number;
  mediaType: SocialMediaType;

  canonicalTitle: string;
  originalTitle: string | null;
  translatedTitle: string | null;
  releaseYear: number | null;

  requiredTitleAliases: string[];
  titleAliases: string[];
  contextTerms: string[];

  episode: {
    seasonNumber: number;
    episodeNumber: number;
    code: string;
    title: string | null;
    overview: string | null;
    airDate: string | null;
  } | null;

  people: {
    creators: string[];
    directors: string[];
    writers: string[];
    cast: string[];
  };

  metadata: {
    genres: string[];
    networks: string[];
    productionCompanies: string[];
    collectionName: string | null;
    originalLanguage: string | null;
  };

  debug: {
    titleSource: "cache" | "tmdb";
    seasonSource?: "cache" | "tmdb";
  };
};

function compact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function unique(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const next = clean(value);

    if (!next) continue;

    const key = compact(next);

    if (!key || seen.has(key)) continue;

    seen.add(key);
    output.push(next);
  }

  return output;
}

function getYearFromDate(value: unknown) {
  const text = clean(value);

  if (!text || text.length < 4) return null;

  const year = Number(text.slice(0, 4));

  return Number.isFinite(year) ? year : null;
}

function getTitleYear(title: any) {
  if (typeof title?.year === "number") return title.year;

  return (
    getYearFromDate(title?.release_date) ??
    getYearFromDate(title?.first_air_date) ??
    null
  );
}

function getEpisodeCode(seasonNumber: number, episodeNumber: number) {
  return `S${String(seasonNumber).padStart(2, "0")}E${String(
    episodeNumber,
  ).padStart(2, "0")}`;
}

function getEpisodeFromSeason(
  season: any,
  episodeNumber: number,
): SocialContext["episode"] {
  const episodes = Array.isArray(season?.episodes) ? season.episodes : [];

  const found = episodes.find((episode: any) => {
    const n =
      episode?.episodeNumber ??
      episode?.episode_number ??
      episode?.number ??
      null;

    return Number(n) === episodeNumber;
  });

  if (!found) return null;

  const seasonNumber =
    Number(found?.seasonNumber ?? found?.season_number ?? season?.seasonNumber) ||
    Number(season?.season_number) ||
    0;

  return {
    seasonNumber,
    episodeNumber,
    code: getEpisodeCode(seasonNumber, episodeNumber),
    title: found?.name ?? found?.title ?? null,
    overview: found?.overview ?? null,
    airDate: found?.airDate ?? found?.air_date ?? null,
  };
}

function namesFrom(items: unknown, limit = 12) {
  if (!Array.isArray(items)) return [];

  return unique(
    items
      .slice(0, limit)
      .map((item: any) => item?.name)
      .filter(Boolean),
  );
}

function crewByJob(crew: unknown, jobs: string[], limit = 8) {
  if (!Array.isArray(crew)) return [];

  const wanted = new Set(jobs.map((job) => job.toLowerCase()));

  return unique(
    crew
      .filter((person: any) => wanted.has(clean(person?.job).toLowerCase()))
      .slice(0, limit)
      .map((person: any) => person?.name),
  );
}

function buildTitleAliases(params: {
  title: string;
  originalTitle: string | null;
  translatedTitle: string | null;
}) {
  const baseTitles = unique([
    params.originalTitle,
    params.title,
    params.translatedTitle,
  ]);

  const aliases = baseTitles.flatMap((title) => {
    const noSpaces = title.replace(/\s+/g, "");
    const dashed = title.replace(/\s+/g, "-");

    return [
      title,
      noSpaces,
      dashed,
      `#${noSpaces}`,
      `#${noSpaces}Discussion`,
      `#${noSpaces}Review`,
    ];
  });

  return unique(aliases);
}

export async function buildSocialContextFromTmdb(
  input: SocialContextInput,
): Promise<SocialContext> {
  const episode: SocialContext["episode"] =
    input.mediaType === "tv" &&
    typeof input.seasonNumber === "number" &&
    typeof input.episodeNumber === "number"
      ? {
          seasonNumber: input.seasonNumber,
          episodeNumber: input.episodeNumber,
          code: getEpisodeCode(input.seasonNumber, input.episodeNumber),
          title: null,
          overview: null,
          airDate: null,
        }
      : null;

  return {
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    canonicalTitle: String(input.tmdbId),
    originalTitle: null,
    translatedTitle: null,
    releaseYear: null,
    requiredTitleAliases: [],
    titleAliases: [],
    contextTerms: [],
    episode,
    people: { creators: [], directors: [], writers: [], cast: [] },
    metadata: {
      genres: [],
      networks: [],
      productionCompanies: [],
      collectionName: null,
      originalLanguage: null,
    },
    debug: { titleSource: "cache" },
  };
}