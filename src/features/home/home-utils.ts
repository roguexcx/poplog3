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

const HEADLINES: Record<string, [string, string, string][]> = {
  madrugada: [
    ["Ainda acordado?", "Temos algo", "pra você."],
    ["Insônia é melhor", "com um bom", "filme."],
    ["Noite funda.", "Escolha algo", "marcante."],
  ],
  manha: [
    ["Bom dia.", "O que vamos", "assistir hoje?"],
    ["Café pronto?", "Falta escolher", "a série."],
    ["Começa bem", "o dia com", "boa ficção."],
  ],
  tarde: [
    ["Tarde livre?", "Aproveite com", "um bom filme."],
    ["Descubra algo", "incrível para", "mais tarde."],
    ["Relaxa.", "A curadoria", "chegou."],
  ],
  noite: [
    ["Descubra o", "próximo título", "da sua noite."],
    ["Pipoca pronta?", "Escolha o", "filme de hoje."],
    ["Noite de", "cinema", "começa aqui."],
  ],
};

export function getHeroHeadline(): [string, string, string] {
  const hour = new Date().getHours();

  let pool: [string, string, string][];
  if (hour >= 6 && hour < 12)       pool = HEADLINES.manha;
  else if (hour >= 12 && hour < 18)  pool = HEADLINES.tarde;
  else if (hour >= 18 && hour < 24)  pool = HEADLINES.noite;
  else                               pool = HEADLINES.madrugada;

  return pool[Math.floor(Math.random() * pool.length)];
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