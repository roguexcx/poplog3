import type { MediaType, Prisma } from "@prisma/client";

import { db } from "@/server/db/client";

const MINIMUM_ELIGIBLE_SORTEIO_COUNT = 12;

type SorteioSeedTitle = {
  tmdbId: number;
  mediaType: MediaType;
  imdbId: string;
  slug: string;
  title: string;
  originalTitle: string;
  overview: string;
  posterPath: string;
  backdropPath: string;
  releaseDate?: string;
  firstAirDate?: string;
  year: number;
  genres: number[];
  popularity: number;
  voteAverage: string;
  voteCount: number;
  originalLanguage: string;
  numberOfSeasons?: number;
};

export type MinimumSorteioSeedResult = {
  ok: true;
  before: number;
  after: number;
  minimum: number;
  seeded: number;
  skipped: boolean;
  reason: string;
};

const MINIMUM_SORTEIO_SEED_TITLES: SorteioSeedTitle[] = [
  {
    tmdbId: 106646,
    mediaType: "movie",
    imdbId: "tt0993846",
    slug: "the-wolf-of-wall-street-2013",
    title: "O Lobo de Wall Street",
    originalTitle: "The Wolf of Wall Street",
    overview: "Um corretor ambicioso transforma Wall Street em palco de excessos, fraudes e quedas cada vez maiores.",
    posterPath: "/seed/posters/tt0993846.jpg",
    backdropPath: "/seed/backdrops/tt0993846.jpg",
    releaseDate: "2013-12-25",
    year: 2013,
    genres: [18, 80, 35],
    popularity: 88,
    voteAverage: "8.0",
    voteCount: 24000,
    originalLanguage: "en",
  },
  {
    tmdbId: 157336,
    mediaType: "movie",
    imdbId: "tt0816692",
    slug: "interstellar-2014",
    title: "Interestelar",
    originalTitle: "Interstellar",
    overview: "Uma missão atravessa o espaço em busca de um novo lar para a humanidade.",
    posterPath: "/seed/posters/tt0816692.jpg",
    backdropPath: "/seed/backdrops/tt0816692.jpg",
    releaseDate: "2014-11-05",
    year: 2014,
    genres: [18, 878, 12],
    popularity: 96,
    voteAverage: "8.4",
    voteCount: 37000,
    originalLanguage: "en",
  },
  {
    tmdbId: 496243,
    mediaType: "movie",
    imdbId: "tt6751668",
    slug: "parasite-2019",
    title: "Parasita",
    originalTitle: "Parasite",
    overview: "Duas famílias de classes opostas entram em uma relação imprevisível e perigosa.",
    posterPath: "/seed/posters/tt6751668.jpg",
    backdropPath: "/seed/backdrops/tt6751668.jpg",
    releaseDate: "2019-05-30",
    year: 2019,
    genres: [35, 53, 18],
    popularity: 72,
    voteAverage: "8.5",
    voteCount: 19000,
    originalLanguage: "ko",
  },
  {
    tmdbId: 508442,
    mediaType: "movie",
    imdbId: "tt2948372",
    slug: "soul-2020",
    title: "Soul",
    originalTitle: "Soul",
    overview: "Um músico redescobre o prazer de viver ao atravessar uma jornada inesperada.",
    posterPath: "/seed/posters/tt2948372.jpg",
    backdropPath: "/seed/backdrops/tt2948372.jpg",
    releaseDate: "2020-12-25",
    year: 2020,
    genres: [16, 10751, 35],
    popularity: 64,
    voteAverage: "8.1",
    voteCount: 11000,
    originalLanguage: "en",
  },
  {
    tmdbId: 634649,
    mediaType: "movie",
    imdbId: "tt10872600",
    slug: "spider-man-no-way-home-2021",
    title: "Homem-Aranha: Sem Volta Para Casa",
    originalTitle: "Spider-Man: No Way Home",
    overview: "A identidade revelada de Peter Parker abre caminho para visitantes de outros universos.",
    posterPath: "/seed/posters/tt10872600.jpg",
    backdropPath: "/seed/backdrops/tt10872600.jpg",
    releaseDate: "2021-12-15",
    year: 2021,
    genres: [28, 12, 878],
    popularity: 91,
    voteAverage: "7.9",
    voteCount: 21000,
    originalLanguage: "en",
  },
  {
    tmdbId: 872585,
    mediaType: "movie",
    imdbId: "tt15398776",
    slug: "oppenheimer-2023",
    title: "Oppenheimer",
    originalTitle: "Oppenheimer",
    overview: "A história do físico que liderou o projeto da bomba atômica e carregou suas consequências.",
    posterPath: "/seed/posters/tt15398776.jpg",
    backdropPath: "/seed/backdrops/tt15398776.jpg",
    releaseDate: "2023-07-19",
    year: 2023,
    genres: [18, 36],
    popularity: 89,
    voteAverage: "8.1",
    voteCount: 14000,
    originalLanguage: "en",
  },
  {
    tmdbId: 1399,
    mediaType: "tv",
    imdbId: "tt0944947",
    slug: "game-of-thrones-2011",
    title: "Game of Thrones",
    originalTitle: "Game of Thrones",
    overview: "Famílias poderosas disputam o controle de Westeros enquanto uma ameaça antiga retorna.",
    posterPath: "/seed/posters/tt0944947.jpg",
    backdropPath: "/seed/backdrops/tt0944947.jpg",
    firstAirDate: "2011-04-17",
    year: 2011,
    genres: [18, 10765, 10759],
    popularity: 95,
    voteAverage: "8.4",
    voteCount: 24000,
    originalLanguage: "en",
    numberOfSeasons: 8,
  },
  {
    tmdbId: 66732,
    mediaType: "tv",
    imdbId: "tt4574334",
    slug: "stranger-things-2016",
    title: "Stranger Things",
    originalTitle: "Stranger Things",
    overview: "Crianças enfrentam experimentos secretos e forças sobrenaturais em uma pequena cidade.",
    posterPath: "/seed/posters/tt4574334.jpg",
    backdropPath: "/seed/backdrops/tt4574334.jpg",
    firstAirDate: "2016-07-15",
    year: 2016,
    genres: [18, 9648, 10765],
    popularity: 93,
    voteAverage: "8.6",
    voteCount: 18000,
    originalLanguage: "en",
    numberOfSeasons: 5,
  },
  {
    tmdbId: 60574,
    mediaType: "tv",
    imdbId: "tt2442560",
    slug: "peaky-blinders-2013",
    title: "Peaky Blinders",
    originalTitle: "Peaky Blinders",
    overview: "Uma família criminosa constrói poder nas ruas de Birmingham após a Primeira Guerra.",
    posterPath: "/seed/posters/tt2442560.jpg",
    backdropPath: "/seed/backdrops/tt2442560.jpg",
    firstAirDate: "2013-09-12",
    year: 2013,
    genres: [18, 80],
    popularity: 81,
    voteAverage: "8.5",
    voteCount: 9800,
    originalLanguage: "en",
    numberOfSeasons: 6,
  },
  {
    tmdbId: 94997,
    mediaType: "tv",
    imdbId: "tt11198330",
    slug: "house-of-the-dragon-2022",
    title: "A Casa do Dragao",
    originalTitle: "House of the Dragon",
    overview: "A dinastia Targaryen mergulha em disputas internas décadas antes de Game of Thrones.",
    posterPath: "/seed/posters/tt11198330.jpg",
    backdropPath: "/seed/backdrops/tt11198330.jpg",
    firstAirDate: "2022-08-21",
    year: 2022,
    genres: [18, 10765, 10759],
    popularity: 86,
    voteAverage: "8.3",
    voteCount: 5200,
    originalLanguage: "en",
    numberOfSeasons: 3,
  },
  {
    tmdbId: 82856,
    mediaType: "tv",
    imdbId: "tt8111088",
    slug: "the-mandalorian-2019",
    title: "The Mandalorian",
    originalTitle: "The Mandalorian",
    overview: "Um caçador de recompensas solitário protege uma criança poderosa nos limites da galáxia.",
    posterPath: "/seed/posters/tt8111088.jpg",
    backdropPath: "/seed/backdrops/tt8111088.jpg",
    firstAirDate: "2019-11-12",
    year: 2019,
    genres: [10765, 10759, 18],
    popularity: 80,
    voteAverage: "8.4",
    voteCount: 10500,
    originalLanguage: "en",
    numberOfSeasons: 3,
  },
  {
    tmdbId: 94605,
    mediaType: "tv",
    imdbId: "tt11126994",
    slug: "arcane-2021",
    title: "Arcane",
    originalTitle: "Arcane",
    overview: "Duas irmãs ficam em lados opostos de uma guerra entre tecnologia, poder e sobrevivência.",
    posterPath: "/seed/posters/tt11126994.jpg",
    backdropPath: "/seed/backdrops/tt11126994.jpg",
    firstAirDate: "2021-11-06",
    year: 2021,
    genres: [16, 18, 10765],
    popularity: 78,
    voteAverage: "8.7",
    voteCount: 5200,
    originalLanguage: "en",
    numberOfSeasons: 2,
  },
];

function parseDate(value: string | undefined): Date | undefined {
  return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
}

function seedToCreateInput(seed: SorteioSeedTitle): Prisma.Poplog3TitleCreateInput {
  const shared = {
    tmdbId: seed.tmdbId,
    mediaType: seed.mediaType,
    imdbId: seed.imdbId,
    slug: seed.slug,
    title: seed.title,
    originalTitle: seed.originalTitle,
    overview: seed.overview,
    posterPath: seed.posterPath,
    backdropPath: seed.backdropPath,
    year: seed.year,
    genres: seed.genres,
    popularity: seed.popularity,
    voteAverage: seed.voteAverage,
    voteCount: seed.voteCount,
    originalLanguage: seed.originalLanguage,
    numberOfSeasons: seed.numberOfSeasons ?? null,
    source: "poplog_seed",
    sourceVersion: "minimum-sorteio-pool-v1",
    cacheStatus: "hit",
    lastSyncedAt: new Date(),
  } satisfies Prisma.Poplog3TitleCreateInput;

  return {
    ...shared,
    releaseDate: parseDate(seed.releaseDate),
    firstAirDate: parseDate(seed.firstAirDate),
  };
}

function seedToUpdateInput(seed: SorteioSeedTitle): Prisma.Poplog3TitleUpdateInput {
  return {
    imdbId: seed.imdbId,
    slug: seed.slug,
    title: seed.title,
    originalTitle: seed.originalTitle,
    overview: seed.overview,
    posterPath: seed.posterPath,
    backdropPath: seed.backdropPath,
    releaseDate: parseDate(seed.releaseDate),
    firstAirDate: parseDate(seed.firstAirDate),
    year: seed.year,
    genres: seed.genres,
    popularity: seed.popularity,
    voteAverage: seed.voteAverage,
    voteCount: seed.voteCount,
    originalLanguage: seed.originalLanguage,
    numberOfSeasons: seed.numberOfSeasons ?? null,
    source: "poplog_seed",
    sourceVersion: "minimum-sorteio-pool-v1",
    cacheStatus: "hit",
    lastSyncedAt: new Date(),
  };
}

async function countEligibleSorteioTitles() {
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T23:59:59.999Z`);
  return db.poplog3Title.count({
    where: {
      posterPath: { not: null },
      OR: [
        { mediaType: "movie", releaseDate: { lte: today } },
        { mediaType: "tv", firstAirDate: { lte: today } },
      ],
    },
  });
}

export async function ensureMinimumSorteioSeed(options: {
  minCount?: number;
  reason?: string;
  force?: boolean;
} = {}): Promise<MinimumSorteioSeedResult> {
  const minimum = Math.max(1, Math.floor(options.minCount ?? MINIMUM_ELIGIBLE_SORTEIO_COUNT));
  const before = await countEligibleSorteioTitles();

  if (!options.force && before >= minimum) {
    return {
      ok: true,
      before,
      after: before,
      minimum,
      seeded: 0,
      skipped: true,
      reason: options.reason ?? "minimum_pool_already_available",
    };
  }

  let seeded = 0;
  for (const seed of MINIMUM_SORTEIO_SEED_TITLES) {
    await db.poplog3Title.upsert({
      where: {
        tmdbId_mediaType: {
          tmdbId: seed.tmdbId,
          mediaType: seed.mediaType,
        },
      },
      update: seedToUpdateInput(seed),
      create: seedToCreateInput(seed),
    });
    seeded += 1;
  }

  const after = await countEligibleSorteioTitles();
  return {
    ok: true,
    before,
    after,
    minimum,
    seeded,
    skipped: false,
    reason: options.reason ?? "minimum_pool_seeded",
  };
}

export function minimumSorteioSeedTitles() {
  return [...MINIMUM_SORTEIO_SEED_TITLES];
}
