// src/lib/radar/content-type-filter.ts
// Classificacao de mediaType + editorialType para o menu de filtros do Radar.
//
// DESIGN:
//   mediaType     -> "movie" | "tv"
//   editorialType -> "scripted" | "documentary" | "reality" | "anime" | "animation"
//                    | "dorama" | "soap" | "unknown"
//
// REGRAS CRITICAS:
//   CINEMATIC e category interna para TV series prestige (Euphoria, Breaking Bad).
//   Nunca e filme. Filmes chegam com isMovie=true ou category="MOVIE".
//
//   Filtro "Series" mostra apenas tv:scripted e tv:unknown.
//   Subtipos com filtro proprio (anime, animation, dorama, nonfiction) sao
//   EXCLUIDOS de "Series" para evitar duplicatas visuais.
//
//   Filtro "Dorama" agrupa:
//     - K-Drama (KR), J-Drama nao-anime (JP sem genre 16)
//     - C-Drama (CN/TW/HK), Thai Drama (TH), e outras series asiaticas
//     - Novela/soap turca (TR), indiana (IN), arabe, mediterranea
//     - Novela/soap (qualquer origem) — ficcao serializada de drama
//   Exclui: anime (JP/KR/CN + genre 16 ja tem filtro proprio)
//   Exclui: series anglofones (US/GB/AU/CA/IE/NZ) -- ficam em Series
//
//   Filtro "Animacao" mostra cartoons nao-asiaticos (Bob Esponja, Simpsons etc.)
//   Filtro "Anime"    mostra animacoes asiaticas (JP/KR/CN + genre 16, ou titulo)

import type { ContentCategory } from "./categories";
import { ANIME_TITLE_PATTERNS } from "./categories";

// Tipos publicos

export type MediaType = "movie" | "tv";

export type EditorialType =
  | "scripted"
  | "documentary"
  | "reality"
  | "anime"
  | "animation"
  | "dorama"
  | "soap"
  | "special"
  | "unknown";

export interface ContentTypeResult {
  mediaType: MediaType;
  editorialType: EditorialType;
}

export type ContentFilterKey =
  | "all"
  | "today"
  | "week"
  | "series"
  | "movies"
  | "streaming"
  | "premieres"
  | "finales"
  | "recent"
  | "animation"
  | "anime"
  | "reality"
  | "talk_news"
  | "sports"
  | "kids"
  | "cinema"
  | "physical"
  | "season_drop"
  | "live";

export const CONTENT_FILTER_LABELS: Record<ContentFilterKey, string> = {
  all:         "Tudo",
  today:       "Hoje",
  week:        "Semana",
  series:      "Séries",
  movies:      "Filmes",
  streaming:   "Streaming",
  premieres:   "Estreias",
  finales:     "Finais",
  recent:      "Ainda em tempo",
  animation:   "Animação",
  anime:       "Anime",
  reality:     "Reality",
  talk_news:   "Talk/News",
  sports:      "Esportes",
  kids:        "Infantil",
  cinema:      "Cinema",
  physical:    "Mídia física",
  season_drop: "Temp. completas",
  live:        "Ao vivo",
};

// Subtitulo exibido abaixo do label no filtro (opcional na UI)
export const CONTENT_FILTER_SUBLABELS: Partial<Record<ContentFilterKey, string>> = {
  anime: "Anime",
  animation: "Cartoons",
};

export interface ContentTypeInput {
  category: ContentCategory;
  isMovie: boolean;
  originalLanguage?: string | null;
  originCountry?: string[] | null;
  genreIds?: number[] | null;
  tmdbType?: string | null;
  title: string;
}

// Genre IDs relevantes
const GENRE_ANIMATION   = 16;
const GENRE_DOCUMENTARY = 99;
const GENRE_REALITY     = 10764;
const GENRE_SOAP        = 10766;
const GENRE_TALK        = 10767;
const GENRE_NEWS        = 10763;

// Paises de drama serializado nao-anglofono que formam o "Dorama"
// Inclui Asia Oriental/Sudeste + Subcontinente + Oriente Medio + Turquia/Balcas
// JP: incluido mas so quando NAO e anime (excluido na logica pela ausencia de genre 16)
const ASIAN_DRAMA_COUNTRIES = new Set([
  // Asia Oriental
  "KR", // Coreia do Sul
  "JP", // Japao (anime excluido antes por isAsianAnimation)
  "CN", // China
  "TW", // Taiwan
  "HK", // Hong Kong
  // Sudeste Asiatico
  "TH", // Tailandia
  "VN", // Vietna
  "PH", // Filipinas
  "ID", // Indonesia
  "MY", // Malasia
  "SG", // Singapura
  // Subcontinente Indiano
  "IN", // India
  "PK", // Paquistao
  "LK", // Sri Lanka
  "BD", // Bangladesh
  // Oriente Medio / Mediterraneo
  "TR", // Turquia (novelas turcas / dizi)
  "IL", // Israel
  "IR", // Ira
  "EG", // Egito
  "SA", // Arabia Saudita
  "AE", // Emirados Arabes
  // Europa nao-anglofona com novela relevante no BR
  "GR", // Grecia
  "PT", // Portugal
]);

// Linguas de drama serializado nao-anglofono (fallback quando origin_country ausente)
const ASIAN_DRAMA_LANGUAGES = new Set([
  "ko", // Coreano
  // "ja" excluido -- anime detectado antes por isAsianAnimation
  "zh", // Chines
  "th", // Tailandes
  "tl", // Filipino
  "id", // Indonesio
  "ms", // Malaio
  "hi", // Hindi
  "ur", // Urdu
  "tr", // Turco
  "ar", // Arabico
  "he", // Hebraico
  "fa", // Persa/Farsi
]);

// Padroes de titulo para reality (fallback quando genre/tmdbType nao chegaram)
const REALITY_TITLE_PATTERNS: RegExp[] = [
  /\bdrag race\b/i,
  /\brupaul\b/i,
  /\bbig brother\b/i,
  /\bsurvivor\b/i,
  /\bthe bachelor\b/i,
  /\bthe bachelorette\b/i,
  /\blove island\b/i,
  /\btemptation island\b/i,
  /\bmarried at first sight\b/i,
  /\b90 day\b/i,
  /\bhousewives\b/i,
  /\bkardashian\b/i,
  /\bamazing race\b/i,
  /\bamerican idol\b/i,
  /\bthe voice\b/i,
  /\bgot talent\b/i,
  /\bx factor\b/i,
  /\bdancing with\b/i,
  /\bdance moms?\b/i,
  /\bmaster.?chef\b/i,
  /\btop chef\b/i,
  /\bproject runway\b/i,
  /\breal housewives\b/i,
  /\bkeeping up with\b/i,
  /\bface off\b/i,
  /\bink master\b/i,
  /\bbar rescue\b/i,
  /\bfixer upper\b/i,
  /\bpawn stars\b/i,
  /\bdeadliest catch\b/i,
  /\bduck dynasty\b/i,
  /\bjersey shore\b/i,
  /\bhell.?s kitchen\b/i,
];

// Detecta se o item e animacao asiatica (anime/donghua/manhwa animado)
// Exclui animacao nao-asiatica (Bob Esponja, Simpsons, etc.)
function isAsianAnimation(
  originalLanguage: string | null | undefined,
  originCountry: string[] | null | undefined,
  genreIds: number[],
): boolean {
  if (!genreIds.includes(GENRE_ANIMATION)) return false;
  const countries = originCountry ?? [];
  const lang = originalLanguage ?? "";
  return (
    lang === "ja" ||
    lang === "ja-JP" ||
    countries.some((c) => ASIAN_DRAMA_COUNTRIES.has(c)) ||
    ASIAN_DRAMA_LANGUAGES.has(lang)
  );
}

// Detecta se o item e serie asiatica nao-anime
function isAsianDrama(
  originalLanguage: string | null | undefined,
  originCountry: string[] | null | undefined,
  genreIds: number[],
  category?: string | null,
): boolean {
  const countries = originCountry ?? [];
  const lang = originalLanguage ?? "";

  // Qualquer animacao (genre 16 ou category ANIMATION) -- nunca e dorama
  if (genreIds.includes(GENRE_ANIMATION) || category === "ANIMATION") return false;

  // Se origin_country tem um pais de drama -- positivo forte
  if (countries.some((c) => ASIAN_DRAMA_COUNTRIES.has(c))) return true;

  // Fallback por lingua (quando origin_country nao esta preenchido)
  if (ASIAN_DRAMA_LANGUAGES.has(lang)) return true;

  return false;
}

/**
 * Classifica um item em { mediaType, editorialType } usando dados ja presentes
 * no pipeline. Sem chamadas adicionais a APIs.
 *
 * Hierarquia de decisao:
 * 1. Filmes reais (isMovie=true ou category="MOVIE")
 * 2. Anime (asiatico + genre 16, ou padrao de titulo)
 * 3. Reality (category, tmdbType, genre 10764, ou padrao de titulo)
 * 4. Documentary TV
 * 5. Dorama (series asiaticas + novela/soap de qualquer origem)
 * 6. Talk/News -> unknown
 * 7. Animacao nao-asiatica (Bob Esponja, Simpsons etc.) -> animation
 * 8. CINEMATIC / SERIES -> scripted
 * 9. UNKNOWN -> unknown
 */
export function classifyContentType(input: ContentTypeInput): ContentTypeResult {
  const { category, isMovie, originalLanguage, originCountry, genreIds, tmdbType, title } = input;
  const ids = genreIds ?? [];
  const countries = originCountry ?? [];
  const lang = originalLanguage ?? "";

  // 1. Filmes reais -- CINEMATIC NAO entra aqui
  if (isMovie || category === "MOVIE") {
    if (ids.includes(GENRE_DOCUMENTARY) || tmdbType === "Documentary") {
      return { mediaType: "movie", editorialType: "documentary" };
    }
    return { mediaType: "movie", editorialType: "scripted" };
  }

  // 2. Anime -- animacao asiatica (JP/KR/CN + genre16) ou padrao de titulo
  //    Deve vir antes de dorama para que animacoes asiaticas nao caiam em dorama.
  const isTitleAnime = ANIME_TITLE_PATTERNS.some((p) => p.test(title));
  if (isAsianAnimation(lang, countries, ids) || isTitleAnime) {
    return { mediaType: "tv", editorialType: "anime" };
  }

  // 3. Reality -- category, tmdbType, genre 10764 ou padrao de titulo
  if (
    category === "REALITY_PREMIUM" ||
    category === "REALITY" ||
    tmdbType === "Reality" ||
    ids.includes(GENRE_REALITY) ||
    REALITY_TITLE_PATTERNS.some((p) => p.test(title))
  ) {
    return { mediaType: "tv", editorialType: "reality" };
  }

  // 4. Documentary TV
  if (
    category === "DOCUMENTARY" ||
    tmdbType === "Documentary" ||
    ids.includes(GENRE_DOCUMENTARY)
  ) {
    return { mediaType: "tv", editorialType: "documentary" };
  }

  // 5. Dorama -- series asiaticas/mediterraneas/turcas (nao-anime) + novela/soap
  //
  // 5a. Novela/soap de qualquer origem -- agrupa ficcao serializada dramatica
  const isSoap =
    category === "DAILY_SOAP" ||
    tmdbType === "Soap" ||
    ids.includes(GENRE_SOAP);

  // 5b. Serie de pais de drama nao-anglofono nao-anime
  const isAsian = isAsianDrama(lang, countries, ids, category);

  if (isSoap || isAsian) {
    return { mediaType: "tv", editorialType: "dorama" };
  }

  // 6. Talk/News -- nao devem aparecer no Radar, mas fallback seguro
  if (
    tmdbType === "Talk Show" ||
    tmdbType === "News" ||
    ids.includes(GENRE_TALK) ||
    ids.includes(GENRE_NEWS)
  ) {
    return { mediaType: "tv", editorialType: "unknown" };
  }

  // 7. Animacao nao-asiatica (Bob Esponja, Simpsons, cartoons ocidentais)
  if (category === "ANIMATION" || ids.includes(GENRE_ANIMATION)) {
    return { mediaType: "tv", editorialType: "animation" };
  }

  // 8. CINEMATIC (TV prestige anglofona) e SERIES -> scripted
  if (category === "SERIES" || category === "CINEMATIC") {
    return { mediaType: "tv", editorialType: "scripted" };
  }

  // 9. UNKNOWN
  return { mediaType: "tv", editorialType: "unknown" };
}

/**
 * Retorna true se o item deve aparecer no filtro dado.
 *
 * REGRA DE NAO-DUPLICACAO:
 *   "Animacao"  -> anime | animation  (tem aba propria)
 *   "Filmes"    -> mediaType === "movie"
 *   "Series"    -> qualquer tv que NAO tenha aba propria
 *                  (scripted, unknown, dorama, documentary, reality, soap, special)
 *   "Todos"     -> tudo sem restricao
 */
export function itemMatchesFilter(
  result: ContentTypeResult,
  filter: ContentFilterKey,
): boolean {
  if (filter === "all")    return true;
  if (filter === "movies") return result.mediaType === "movie";
  if (filter === "anime")  return result.editorialType === "anime";
  if (filter === "animation") return result.editorialType === "animation";
  if (filter === "reality") return result.editorialType === "reality";
  if (filter === "kids") return result.editorialType === "special";

  if (filter === "series") {
    // Cobre tudo que e TV mas nao tem aba propria (anime/animation ja tem "Animacao")
    return (
      result.mediaType === "tv" &&
      result.editorialType !== "anime" &&
      result.editorialType !== "animation"
    );
  }

  return true;
}
