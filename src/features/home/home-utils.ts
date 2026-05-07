// src/features/home/home-utils.ts

export const GENRE_TRANSLATIONS: Record<string, string> = {
  "Sci-Fi & Fantasy": "Ficção científica e fantasia",
  "Action & Adventure": "Ação e aventura",
  Drama: "Drama",
  Comedy: "Comédia",
  Crime: "Crime",
  Mystery: "Mistério",
  Thriller: "Suspense",
  Horror: "Terror",
  Animation: "Animação",
  Family: "Família",
  Documentary: "Documentário",
  Romance: "Romance",
  Fantasy: "Fantasia",
  Action: "Ação",
  Adventure: "Aventura",
};

export function getHeroHeadline(): [string, string, string] {
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 12) return ["Bom dia.", "O que vamos", "assistir hoje?"];
  if (hour >= 12 && hour < 18) return ["Descubra algo", "incrível para", "mais tarde."];
  if (hour >= 18 && hour < 24) return ["Descubra o", "próximo título", "da sua noite."];
  return ["Ainda acordado?", "Temos algo", "pra você."];
}

export function translateGenres(
  genres: { name: string }[],
  limit = 2,
): string {
  return genres
    .slice(0, limit)
    .map((g) => GENRE_TRANSLATIONS[g.name] ?? g.name)
    .join(" • ");
}

export function formatRuntime(
  runtime?: number | null,
  episodeRuntime?: number[],
): string | null {
  if (runtime) return `${runtime} min`;
  if (episodeRuntime?.[0]) return `${episodeRuntime[0]} min`;
  return null;
}

/** Retorna o ano de lançamento de um item TMDB. */
export function parseYear(
  releaseDate?: string | null,
  firstAirDate?: string | null,
): string | null {
  return releaseDate?.split("-")[0] ?? firstAirDate?.split("-")[0] ?? null;
}