/**
 * Formatos de conteúdo EXCLUÍDOS das superfícies editoriais (HERO rotativo,
 * "Em alta agora"/trending e descoberta).
 *
 * O POPLOG é uma plataforma de filmes e séries roteirizados. Talk shows, programas
 * de variedades, realities, telejornais e game shows poluem o trending/HERO e não
 * são o foco do produto — devem ser censurados/removidos globalmente.
 *
 * O classificador aceita os 3 formatos de `genres` que circulam no app:
 *   - slugs Trakt:   string[]  ex.: ["talk-show", "comedy"]
 *   - nomes:         string[] | {name}[]  ex.: ["Talk", "Comédia"]
 *   - IDs TMDB:      number[] | {id}[]    ex.: [10767, 35]
 */

/** Slugs de gênero da Trakt que indicam formato não-roteirizado a excluir. */
const EXCLUDED_TRAKT_SLUGS = new Set<string>([
  "talk-show",
  "news",
  "reality",
  "game-show",
  "home-and-garden",
  "podcast",
]);

/** IDs de gênero TMDB (TV) a excluir: 10767 Talk, 10764 Reality, 10763 News. */
const EXCLUDED_TMDB_GENRE_IDS = new Set<number>([10767, 10764, 10763]);

/**
 * Palavras-chave (normalizadas: minúsculas, sem acento) que, presentes no NOME do
 * gênero, indicam formato a excluir. Cobre rótulos PT-BR e EN.
 */
const EXCLUDED_NAME_KEYWORDS = [
  "talk show",
  "talk-show",
  "talk", // nome de gênero TMDB 10767 ("Talk"); vocabulário controlado, sem falso-positivo
  "reality",
  "news",
  "noticias",
  "noticiario",
  "telejornal",
  "jornalismo",
  "game show",
  "game-show",
  "variety",
  "variedades",
  "auditorio",
];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function isExcludedGenre(genre: unknown): boolean {
  if (genre === null || genre === undefined) return false;

  if (typeof genre === "number") {
    return EXCLUDED_TMDB_GENRE_IDS.has(genre);
  }

  if (typeof genre === "string") {
    const slug = genre.trim().toLowerCase();
    if (EXCLUDED_TRAKT_SLUGS.has(slug)) return true;
    const norm = normalize(genre);
    return EXCLUDED_NAME_KEYWORDS.some((kw) => norm === kw || norm.includes(kw));
  }

  // Objeto { id, name }
  if (typeof genre === "object") {
    const g = genre as { id?: unknown; name?: unknown };
    if (typeof g.id === "number" && EXCLUDED_TMDB_GENRE_IDS.has(g.id)) return true;
    if (typeof g.name === "string") return isExcludedGenre(g.name);
  }
  return false;
}

/**
 * Retorna `true` se a lista de gêneros indica um formato excluído (talk show,
 * variedades, reality, telejornal, game show). Tolerante a qualquer formato de entrada
 * (slugs Trakt, nomes PT-BR/EN, IDs TMDB ou objetos {id,name}).
 */
export function isExcludedFormat(genres: unknown): boolean {
  if (!Array.isArray(genres) || genres.length === 0) return false;
  return genres.some(isExcludedGenre);
}
