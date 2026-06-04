import type {
  PoplogTitleCompany,
  PoplogTitleDetails,
  PoplogTitleNetwork,
  PoplogTitleRecommendation,
} from "@/server/types/title-details";

type EditorialEntity = {
  id?: number | null;
  name?: string | null;
};

type RecommendationWithIndex = PoplogTitleRecommendation & {
  originalIndex: number;
};

type TmdbEditorialDetails = {
  id: number;
  production_companies?: PoplogTitleCompany[];
  networks?: PoplogTitleNetwork[];
};

type EditorialFamily = {
  key: string;
  names: string[];
  ids?: number[];
};

const EDITORIAL_FAMILIES: EditorialFamily[] = [
  {
    key: "warner",
    names: ["hbo", "max", "warner", "warner bros", "dc entertainment", "new line"],
    ids: [49],
  },
  { key: "netflix", names: ["netflix"], ids: [213] },
  { key: "a24", names: ["a24"] },
  {
    key: "sony",
    names: ["sony pictures", "columbia", "triStar", "screen gems", "crunchyroll"],
  },
  {
    key: "universal",
    names: ["universal", "focus features", "dreamworks", "illumination", "blumhouse"],
  },
  {
    key: "paramount",
    names: ["paramount", "showtime", "mtv entertainment", "nickelodeon"],
  },
  {
    key: "disney",
    names: [
      "disney",
      "pixar",
      "marvel",
      "lucasfilm",
      "20th century studios",
      "searchlight",
      "hulu",
      "fx",
    ],
    ids: [2, 3, 420, 7505, 1, 88, 453, 83],
  },
  { key: "neon", names: ["neon"] },
  { key: "lionsgate", names: ["lionsgate", "starz"], ids: [318, 758] },
  { key: "legendary", names: ["legendary"] },
  { key: "amazon", names: ["amazon", "mgm", "amazon mgm", "prime video"] },
  { key: "apple", names: ["apple tv", "apple studios"], ids: [2552] },
  { key: "amc", names: ["amc"], ids: [174] },
  { key: "bbc", names: ["bbc"], ids: [4] },
  { key: "ghibli", names: ["studio ghibli", "ghibli"] },
  { key: "toho", names: ["toho"] },
  { key: "globo", names: ["globo filmes", "globo"] },
  { key: "paris", names: ["paris filmes"] },
  { key: "o2", names: ["o2 filmes"] },
  { key: "gullane", names: ["gullane"] },
  { key: "downtown", names: ["downtown filmes"] },
];

function normalizeName(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function entityKey(entity: EditorialEntity) {
  if (typeof entity.id === "number") return `id:${entity.id}`;
  const name = normalizeName(entity.name);
  return name ? `name:${name}` : null;
}

function extractEntities(input: {
  production_companies?: PoplogTitleCompany[] | null;
  networks?: PoplogTitleNetwork[] | null;
}) {
  return [
    ...(input.production_companies ?? []),
    ...(input.networks ?? []),
  ].filter((entity) => entity?.id || entity?.name);
}

function resolveFamilies(entities: EditorialEntity[]) {
  const normalized = entities.map((entity) => ({
    id: entity.id,
    name: normalizeName(entity.name),
  }));

  return new Set(
    EDITORIAL_FAMILIES.filter((family) =>
      normalized.some((entity) => {
        if (typeof entity.id === "number" && family.ids?.includes(entity.id)) {
          return true;
        }

        return family.names.some((name) => {
          const familyName = normalizeName(name);
          return (
            entity.name === familyName ||
            (entity.name.length > 0 &&
              (entity.name.includes(familyName) ||
                familyName.includes(entity.name)))
          );
        });
      }),
    ).map((family) => family.key),
  );
}

function editorialOriginScore(
  sourceEntities: EditorialEntity[],
  candidateEntities: EditorialEntity[],
) {
  if (sourceEntities.length === 0 || candidateEntities.length === 0) return 0;

  const sourceKeys = new Set(
    sourceEntities.map(entityKey).filter((key): key is string => Boolean(key)),
  );

  const exactMatches = candidateEntities.filter((entity) => {
    const key = entityKey(entity);
    return key ? sourceKeys.has(key) : false;
  }).length;

  const sourceFamilies = resolveFamilies(sourceEntities);
  const candidateFamilies = resolveFamilies(candidateEntities);
  const familyMatches = Array.from(candidateFamilies).filter((family) =>
    sourceFamilies.has(family),
  ).length;

  return Math.min(28, exactMatches * 16 + familyMatches * 10);
}

async function fetchRecommendationEditorialDetails(
  _item: PoplogTitleRecommendation,
): Promise<TmdbEditorialDetails | null> {
  return null;
}

export async function rankRecommendationsByEditorialOrigin(params: {
  source: Pick<PoplogTitleDetails, "production_companies" | "networks"> | null;
  recommendations: PoplogTitleRecommendation[];
}): Promise<PoplogTitleRecommendation[]> {
  const { source, recommendations } = params;

  if (!source || recommendations.length <= 1) return recommendations;

  const sourceEntities = extractEntities(source);
  if (sourceEntities.length === 0) return recommendations;

  const indexed: RecommendationWithIndex[] = recommendations.map((item, index) => ({
    ...item,
    originalIndex: index,
  }));

  const details = await Promise.all(
    indexed.map((item) => fetchRecommendationEditorialDetails(item)),
  );

  return indexed
    .map((item, index) => {
      const candidateEntities = extractEntities(details[index] ?? {});
      const editorialBoost = editorialOriginScore(sourceEntities, candidateEntities);
      const baseSimilarity = (recommendations.length - item.originalIndex) * 10;
      const quality =
        typeof item.vote_average === "number" ? Math.min(6, item.vote_average / 2) : 0;

      return {
        item,
        score: baseSimilarity + editorialBoost + quality,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.item.originalIndex - b.item.originalIndex;
    })
    .map(({ item }) => {
      return {
        id: item.id,
        media_type: item.media_type,
        title: item.title,
        name: item.name,
        original_title: item.original_title ?? null,
        poster_path: item.poster_path,
        backdrop_path: item.backdrop_path,
        vote_average: item.vote_average,
        release_date: item.release_date,
        first_air_date: item.first_air_date,
      };
    });
}
