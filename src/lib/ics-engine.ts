// ── ICS Engine ─────────────────────────────────────────────────────────────────
// Transforma eventos brutos ICS em grupos de série enriquecíveis.
//
// Sistema de score composto (0-100):
//   - popularity TMDB    (35 pts max) — sinal mais forte, proxy de trending orgânico
//   - vote_average       (25 pts max) — qualidade percebida com peso mínimo de votos
//   - network/studio tier (0-30 pts) — emissora ou produtora de prestígio
//   - trending boost      (0-20 pts) — está no trending day/week do TMDB?
//   - origin boost        (0-10 pts) — EN/PT = +10, ES = +5
//   - vote confidence     (-15 pts)  — penalidade se < 10 votos
//
// Threshold padrão: score >= 38 para aparecer no featured
// Séries sem TMDB passam (comportamento conservador)
// ──────────────────────────────────────────────────────────────────────────────

import type { IcsEvent } from "./ics-parser";

// ── Categorias de conteúdo ────────────────────────────────────────────────────

export type ContentCategory =
  | "MOVIE"
  | "CINEMATIC"
  | "SERIES"
  | "ANIMATION"
  | "DOCUMENTARY"
  | "REALITY_PREMIUM"
  | "REALITY"
  | "DAILY_SOAP"
  | "SPORTS"
  | "NEWS"
  | "PODCAST"
  | "LIVE_EVENT"
  | "KIDS"
  | "VARIETY"
  | "UNKNOWN";

export const CATEGORY_PRIORITY: Record<ContentCategory, number> = {
  MOVIE:           0,
  CINEMATIC:       1,
  SERIES:          2,
  ANIMATION:       3,
  DOCUMENTARY:     4,
  REALITY_PREMIUM: 5,
  REALITY:         6,
  VARIETY:         7,
  KIDS:            8,
  DAILY_SOAP:      9,
  LIVE_EVENT:      10,
  PODCAST:         11,
  NEWS:            12,
  SPORTS:          13,
  UNKNOWN:         14,
};

export const FEATURED_CATEGORIES = new Set<ContentCategory>([
  "CINEMATIC", "SERIES", "ANIMATION", "DOCUMENTARY", "REALITY_PREMIUM",
]);

export const HIDDEN_CATEGORIES = new Set<ContentCategory>([
  "SPORTS", "NEWS", "PODCAST", "LIVE_EVENT",
]);

// ── Padrões de classificação local por título ─────────────────────────────────

const SOAP_PATTERNS = [
  /novela/i, /\bsoap\b/i, /in aller freundschaft/i, /lindenstrasse/i,
  /\bEastEnders\b/i, /\bHollyoaks\b/i, /\bCoronation\b/i, /\bEmmerdale\b/i,
  /\bNeighbours\b/i, /Sturm der Liebe/i, /Rote Rosen/i, /Verbotene Liebe/i,
  /\bThe Bold\b/i, /\bDays of Our\b/i, /\bGeneral Hospital\b/i,
  /\bThe Young\b/i, /Guiding Light/i, /\bHome and Away\b/i,
];

const SPORTS_PATTERNS = [
  /\bfootball\b/i, /\bsoccer\b/i, /\bnfl\b/i, /\bnba\b/i, /\bnhl\b/i,
  /\bmlb\b/i, /\bespn\b/i, /\bliga\b/i, /\bcopa\b/i, /\btorneio\b/i,
  /\bchampions\b.*league/i, /\bpremier league\b/i, /\bformula.*1\b/i,
  /\bf1\b/i, /\bwrestling\b/i, /\bwwe\b/i, /\bufc\b/i, /\bmma\b/i,
];

const TALK_SHOW_PATTERNS = [
  /\blate (night|show|late)\b/i, /\btonight show\b/i, /\blate show with\b/i,
  /\bjimmy (fallon|kimmel|carr)\b/i, /\bconan\b/i, /\bconan o'?brien\b/i,
  /\bseth meyers?\b/i, /\bjohn oliver\b/i, /\btrevor noah\b/i,
  /\bbill maher\b/i, /\bstephen colbert\b/i, /\bdavid letterman\b/i,
  /\bjay leno\b/i, /\bjonathan ross\b/i,
  /\bgood morning\b/i, /\bmorning (show|live|america|britain|today)\b/i,
  /\bbreakfast (show|tv|club)\b/i, /\bthe today show\b/i,
  /\bthe view\b/i, /\bthe talk\b/i, /\bthe real\b/i,
  /\bwendy williams\b/i, /\belly degeneres?\b/i, /\bellen\b/i,
  /\bkelly clarkson\b/i, /\bwatch what happens\b/i,
  /\bstrahan\b/i, /\bdaytime\b/i,
  /\btalk show\b/i, /\bwith.*host\b/i,
  /\bchit ?chat\b/i, /\blive! with\b/i, /\blive with\b/i,
  /\bcelebrity juice\b/i, /\bgraham norton\b/i,
  /\balan carr\b/i, /\bpanel show\b/i,
];

const NEWS_PATTERNS = [
  /\bnews\b/i, /\bnoticias\b/i, /\bjornal\b/i, /\breport[ae]\b/i,
  /\bdaily show\b/i, /\bfox news\b/i, /\bcnn\b/i, /\bnightline\b/i,
];

const PODCAST_PATTERNS = [/\bpodcast\b/i, /\bq&a\b/i];

const KIDS_PATTERNS = [
  /\bcartoon\b/i, /\bpaw patrol\b/i, /\bsesame street\b/i,
  /\bdora\b.*explor/i, /\bpeppa pig\b/i, /\bbluey\b/i,
  /\bkids\b/i, /\bjunior\b/i, /\bnickjr\b/i,
];

const ANIME_PATTERNS = [
  /\banime\b/i,
  /\bone piece\b/i, /\bnaruto\b/i, /\bdragon ball\b/i, /\battack on titan\b/i,
  /\bshingeki\b/i, /\bmy hero academia\b/i, /\bboku no hero\b/i,
  /\bdem[oa]n slayer\b/i, /\bkimetsu\b/i, /\bjujutsu kaisen\b/i,
  /\bvinland saga\b/i, /\bsword art online\b/i, /\bblack clover\b/i,
  /\bfairy tail\b/i, /\bhunter x hunter\b/i, /\bfullmetal alchemist\b/i,
  /\bone-?punch man\b/i, /\btokyo (ghoul|revengers)\b/i,
  /\bbleach\b/i, /\bchainsaw man\b/i, /\bspy.?x.?family\b/i,
  /\btrigun\b/i, /\bcowboy bebop\b/i, /\bneon genesis\b/i,
  /\bcode geass\b/i, /\bsteins.?gate\b/i, /\boverlord\b/i,
  /\bkaguya.?sama\b/i,
];

const REALITY_PREMIUM_PATTERNS = [
  /\bsurvivor\b/i, /\bthe amazing race\b/i, /\bbig brother\b/i,
  /\bbachelorette?\b/i, /\blove island\b/i, /\bproject runway\b/i,
  /\btop chef\b/i, /\bthe voice\b/i, /\bamerican idol\b/i,
  /\bthe apprentice\b/i, /\bdragon'?s den\b/i, /\bshark tank\b/i,
];

const REALITY_PATTERNS = [
  /\breality\b/i, /\bchopped\b/i, /\bkitchen\b.*nightmare/i,
  /\bfixer upper\b/i, /\bhgtv\b/i, /\bdating\b/i, /\bmarried.*first\b/i,
  /\b90 day\b/i, /\bhousewives\b/i, /\bkardashian\b/i,
];

const DAILY_PATTERNS = [/\bdaily\b/i, /\btoday\b/i, /\bevening\b/i];

export function classifyTitle(title: string): ContentCategory {
  if (SPORTS_PATTERNS.some((p) => p.test(title)))           return "SPORTS";
  if (TALK_SHOW_PATTERNS.some((p) => p.test(title)))        return "PODCAST";
  if (NEWS_PATTERNS.some((p) => p.test(title)))             return "NEWS";
  if (PODCAST_PATTERNS.some((p) => p.test(title)))          return "PODCAST";
  if (KIDS_PATTERNS.some((p) => p.test(title)))             return "KIDS";
  if (SOAP_PATTERNS.some((p) => p.test(title)))             return "DAILY_SOAP";
  if (DAILY_PATTERNS.some((p) => p.test(title)))            return "VARIETY";
  if (ANIME_PATTERNS.some((p) => p.test(title)))            return "ANIMATION";
  if (REALITY_PREMIUM_PATTERNS.some((p) => p.test(title)))  return "REALITY_PREMIUM";
  if (REALITY_PATTERNS.some((p) => p.test(title)))          return "REALITY";
  return "SERIES";
}

function detectSoapByVolume(episodeCount: number, spanDays: number): boolean {
  if (spanDays <= 0) return false;
  return (episodeCount / spanDays) > 1 && spanDays >= 5;
}

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[''`]/g, "'")
    .replace(/[^\w\s']/g, "")
    .trim();
}

// ── Tipos exportados ──────────────────────────────────────────────────────────

export interface SeriesEpisodeWindow {
  season: number;
  episode: number;
  episodeName: string;
  startAt: string;
  endAt: string;
  uid: string;
}

export interface TmdbNetwork {
  id: number;
  name: string;
  logo_path: string | null;
  origin_country: string;
}

export interface TmdbProductionCompany {
  id: number;
  name: string;
  logo_path: string | null;
  origin_country: string;
}

export interface IcsSeriesGroup {
  key: string;
  rawTitle: string;
  category: ContentCategory;
  episodeCount: number;
  nextAirDate: string;
  lastAirDate: string;
  spanDays: number;
  episodes: SeriesEpisodeWindow[];
  seasons: number[];
  /** Score de relevância composto 0-100 (preenchido após enriquecimento TMDB) */
  relevanceScore: number;
  /** true = passou no threshold de relevância */
  isRelevant: boolean;
  tmdb?: TmdbEnrichment | null;
  /** Provedor de streaming identificado (ex: Netflix, HBO Max) — opcional, populado pelo pipeline de airing */
  streamingProvider?: { name: string } | null;
}

/**
 * Representa um filme no pipeline da agenda.
 * Análogo a IcsSeriesGroup, mas para filmes (sem episódios recorrentes).
 */
export interface MovieGroup {
  key: string;
  movie: {
    tmdb_id: number;
    release_date?: string | null;
    backdrop_path?: string | null;
    poster_path?: string | null;
    clean_backdrop_path?: string | null;
    popularity?: number;
    vote_average?: number;
    vote_count?: number;
    original_language?: string;
    overview?: string | null;
    name?: string;
    original_name?: string;
    genre_ids?: number[];
    genres?: string[];
    origin_country?: string[];
  };
  relevanceScore?: number;
  isRelevant?: boolean;
}

export interface TmdbEnrichment {
  tmdb_id: number;
  name: string;
  original_name: string;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  /** Backdrop sem texto/logo, obtido via /images?include_image_language=null,xx */
  clean_backdrop_path?: string | null;
  genre_ids: number[];
  genres: string[];
  popularity: number;
  vote_average: number;
  vote_count: number;
  number_of_seasons: number | null;
  origin_country: string[];
  original_language: string;
  first_air_date: string | null;
  status: string | null;
  networks: TmdbNetwork[];
  production_companies: TmdbProductionCompany[];
  tmdb_type?: string | null;
  refined_category?: ContentCategory;
}

// ── Tabelas de tier para score de relevância ──────────────────────────────────

/**
 * Tier de REDES/EMISSORAS (campo `networks` do TMDB).
 * Proxy de qualidade de produção + audiência garantida.
 */
const NETWORK_TIER: Record<number, number> = {
  // Tier Premium (+30) — streaming global ou canal prestige
  49:   30, // HBO
  2552: 30, // Apple TV+
  213:  30, // Netflix
  1024: 30, // Amazon Prime Video
  453:  30, // Hulu
  2739: 30, // Disney+
  3353: 30, // Max (HBO Max rebranding)
  6:    28, // FX
  67:   25, // Showtime
  174:  25, // AMC
  // Tier Qualidade (+20)
  4:    20, // BBC One
  393:  20, // BBC Two
  57:   20, // Peacock
  318:  20, // Starz
  4330: 20, // Paramount+
  64:   18, // Sky One
  1709: 18, // Canal+
  // Tier Mainstream (+10)
  2:    10, // ABC
  5:    10, // NBC
  19:   10, // FOX
  16:   10, // CBS
  11:   10, // Adult Swim
  56:   10, // Bravo
  65:   8,  // History
  66:   8,  // National Geographic
  29:   8,  // PBS
  // Anime premium JP (+20)
  1:    20, // Fuji TV
  3:    18, // Tokyo MX
  6267: 18, // TV Tokyo
};

/**
 * Tier de PRODUTORAS (campo `production_companies` do TMDB).
 * A24, Warner, Sony etc. produzem para múltiplas plataformas —
 * sua presença é sinal forte de qualidade independente da rede.
 *
 * Nota: usamos o MAIOR boost entre network e studio (não somamos),
 * para não inflar duplamente séries HBO originais.
 */
const STUDIO_TIER: Record<number, number> = {
  // Prestige independente (+28)
  41077: 28, // A24
  // Major studios com track record de qualidade (+22)
  12:    22, // New Line Cinema / Warner Bros Television
  174:   22, // Warner Bros. Television (mesmo id que AMC — TMDB usa o mesmo)
  3268:  22, // HBO Entertainment (produtora separada da rede)
  2:     18, // Walt Disney Pictures / Disney TV
  7505:  22, // Sony Pictures Television
  11073: 20, // Sony Pictures Television (alt)
  21:    18, // Metro-Goldwyn-Mayer (MGM)
  33:    18, // Universal Television
  1632:  18, // Lionsgate Television
  9993:  20, // DC Studios
  420:   18, // Marvel Studios
  3287:  18, // Bad Robot (J.J. Abrams)
  1:     18, // Lucasfilm
  306:   16, // Blumhouse Productions
  7:     16, // DreamWorks
  523:   16, // Legendary Entertainment
  // Produtoras de prestígio independente (+16)
  2527:  16, // Anonymous Content
  11:    14, // Paramount Pictures Television
  4:     14, // Regency Enterprises
  17:    14, // John Wells Productions
  1885:  14, // Temple Hill Entertainment
  73:    12, // Village Roadshow
};

// ── Score de relevância composto ──────────────────────────────────────────────

/**
 * Calcula o score de relevância (0-100) de um grupo após enriquecimento TMDB.
 */
export function computeRelevanceScore(
  group: IcsSeriesGroup,
  trendingDay: Set<number> = new Set(),
  trendingWeek: Set<number> = new Set(),
): number {
  const { tmdb } = group;
  if (!tmdb) return 0;

  let score = 0;

  // ── 1. Popularidade (0-35 pts) ──────────────────────────────────────────────
  // Curva log: pop=1→0, pop=10→15, pop=50→25, pop=200→31, pop=1000→35
  const pop = tmdb.popularity ?? 0;
  const popScore = Math.min(35, Math.round(Math.log2(Math.max(1, pop)) * 4.5));
  score += popScore;

  // ── 2. Qualidade (0-25 pts) ─────────────────────────────────────────────────
  const avg = tmdb.vote_average ?? 0;
  const cnt = tmdb.vote_count ?? 0;
  if (cnt >= 50) {
    score += Math.round((avg / 10) * 25);
  } else if (cnt >= 10) {
    score += Math.round((avg / 10) * 12); // peso reduzido
  } else {
    score -= 15; // penalidade: dados insuficientes
  }

  // ── 3. Tier de rede OU produtora (0-30 pts, pega o maior) ──────────────────
  let networkBoost = 0;
  for (const net of tmdb.networks ?? []) {
    const tier = NETWORK_TIER[net.id] ?? 0;
    if (tier > networkBoost) networkBoost = tier;
  }

  let studioBoost = 0;
  for (const co of tmdb.production_companies ?? []) {
    const tier = STUDIO_TIER[co.id] ?? 0;
    if (tier > studioBoost) studioBoost = tier;
  }

  // Usa o maior dos dois — não soma para não inflar duplamente
  score += Math.max(networkBoost, studioBoost);

  // ── 4. Trending boost (0-20 pts) ────────────────────────────────────────────
  if (trendingDay.has(tmdb.tmdb_id))        score += 20;
  else if (trendingWeek.has(tmdb.tmdb_id))  score += 10;

  // ── 5. Origem (0-10 pts) ────────────────────────────────────────────────────
  const lang = tmdb.original_language ?? "";
  if (lang === "en" || lang === "pt")  score += 10;
  else if (lang === "es" || lang === "ja") score += 5; // ES e JP (anime) passam com desconto

  return Math.max(0, Math.min(100, score));
}

/** Threshold mínimo para aparecer no featured */
export const RELEVANCE_THRESHOLD = 38;

/**
 * Hard filters + score composto.
 * Retorna true se o grupo deve aparecer na Agenda.
 * Atualiza group.relevanceScore e group.isRelevant in-place.
 */
export function filterEnrichedGroup(
  group: IcsSeriesGroup,
  trendingDay: Set<number> = new Set(),
  trendingWeek: Set<number> = new Set(),
): boolean {
  const { tmdb } = group;

  // Hard filter: categoria local HIDDEN (VARIETY, PODCAST, SPORTS, NEWS) — nunca passa
  if (HIDDEN_CATEGORIES.has(group.category)) {
    group.isRelevant = false;
    return false;
  }

  // Sem TMDB → passa se categoria local não for hidden (enriquecimento ainda não chegou)
  if (!tmdb) return true;

  // Hard filter: idioma — EN, PT e ES passam (ES com score reduzido); JP para anime
  const lang = tmdb.original_language ?? "";
  if (lang && !["en", "pt", "es", "ja"].includes(lang)) return false;

  // Hard filter: tipo TMDB explícito — Talk Show, Game Show e News sempre bloqueados.
  const typ = tmdb.tmdb_type ?? "";
  if (typ === "Talk Show" || typ === "Game Show" || typ === "News" || typ === "Soap") {
    group.isRelevant = false;
    return false;
  }

  // Hard filter: refined_category pelo TMDB/enricher — pode diferir da categoria local.
  // SAFETY: grupos SECONDARY não passam pelo enriquecimento TMDB completo, portanto
  // tmdb.refined_category pode ser undefined — tratado com fallback para group.category
  // para garantir que a ausência do campo não cause vazamento nem undefined.
  const refinedCat = tmdb.refined_category ?? group.category;
  if (HIDDEN_CATEGORIES.has(refinedCat)) {
    group.category   = refinedCat;
    group.isRelevant = false;
    return false;
  }

  // Score composto
  const score = computeRelevanceScore(group, trendingDay, trendingWeek);
  group.relevanceScore = score;
  group.isRelevant = score >= RELEVANCE_THRESHOLD;

  return group.isRelevant;
}

// ── Mapa de genres TMDB → categoria ──────────────────────────────────────────
//
// Mapeia genre_ids TMDB para categorias locais do pipeline.
//
// REGRAS EDITORIAIS:
//   - CINEMATIC (badge "Prestige") cobre os principais gêneros de drama de qualidade:
//     Crime (80), Mistério (9648), Drama (18), Sci-Fi (10765), Ação (10759),
//     Guerra (10768) e Faroeste (37). Géneros amplos que podem resultar em badge
//     "Prestige" são aceitáveis pois o score de relevância (redes, popularidade)
//     filtra os títulos de baixa qualidade antes de chegarem ao frontend.
//   - Talk (10767) → PODCAST, que está em HIDDEN_CATEGORIES → sempre bloqueado.
//   - Reality (10764) → REALITY (não REALITY_PREMIUM). REALITY está em
//     HIDDEN_CATEGORIES; apenas REALITY_PREMIUM detectado via título passa.
//   - Quando múltiplos genres estão presentes, prevalece o de menor CATEGORY_PRIORITY
//     (i.e., o "mais nobre" na hierarquia editorial).
//
// INTERAÇÃO COM O FILTRO FINAL (filterEnrichedGroup):
//   - O resultado desta função é salvo em tmdb.refined_category pelo enricher.
//   - filterEnrichedGroup lê refined_category com fallback para group.category
//     (grupos SECONDARY não passam pelo enriquecimento completo — refined_category
//     pode ser undefined; o fallback evita undefined e vazamento de conteúdo).
//   - HIDDEN_CATEGORIES = { SPORTS, NEWS, PODCAST, LIVE_EVENT, VARIETY }
//
// BLOQUEIOS AUTOMÁTICOS por tmdb_type (aplicados antes do mapa de gêneros):
//   - "Talk Show"  → PODCAST  → HIDDEN
//   - "Game Show"  → PODCAST  → HIDDEN  (via tmdb_type no filterEnrichedGroup)
//   - "News"       → NEWS     → HIDDEN
//   - "Reality"    → REALITY  → HIDDEN (salvo REALITY_PREMIUM detectado antes)
//   - "Soap"       → DAILY_SOAP
// ─────────────────────────────────────────────────────────────────────────────
const TMDB_GENRE_CATEGORY: Record<number, ContentCategory> = {
  10759: "CINEMATIC",  // Ação & Aventura
  16:    "ANIMATION",  // Animação
  35:    "SERIES",     // Comédia → Série (não prestige automaticamente)
  80:    "CINEMATIC",  // Crime → prestige (Sopranos, Better Call Saul)
  99:    "DOCUMENTARY",
  18:    "CINEMATIC",  // Drama
  10751: "KIDS",       // Família
  10762: "KIDS",       // Kids
  9648:  "CINEMATIC",  // Mistério → prestige (True Detective, Sharp Objects)
  10763: "NEWS",       // News → HIDDEN
  10764: "REALITY",    // Reality → HIDDEN (exceto REALITY_PREMIUM detectado antes)
  10765: "CINEMATIC",  // Sci-Fi & Fantasy
  10766: "DAILY_SOAP", // Soap
  10767: "PODCAST",    // Talk → PODCAST → HIDDEN (late night, game shows, etc.)
  10768: "CINEMATIC",  // Guerra & Política
  37:    "CINEMATIC",  // Faroeste
};

/**
 * Refina a categoria de conteúdo usando dados reais do TMDB.
 *
 * BLOQUEIOS AUTOMÁTICOS (resultado em HIDDEN_CATEGORIES):
 *   - tmdb_type = "Talk Show"  → PODCAST (late night, daytime talk)
 *   - tmdb_type = "News"       → NEWS
 *   - genre_id  = 10767 (Talk) → PODCAST → HIDDEN
 *   - genre_id  = 10763 (News) → NEWS    → HIDDEN
 *
 * BLOQUEIOS CONDICIONAIS:
 *   - tmdb_type = "Reality"    → REALITY (bloqueado; REALITY_PREMIUM detectado antes)
 *   - genre_id  = 10764        → REALITY (idem)
 *
 * PROMOÇÕES (resultado mais nobre que a categoria local):
 *   - genre_ids 80, 9648, 18, 10759, 10765, 10768, 37 → CINEMATIC
 *   - genre_id 99 → DOCUMENTARY
 *   - genre_id 16 → ANIMATION
 *
 * @param current  Categoria local determinada pelo classifyTitle() + motor ICS
 * @param genreIds genre_ids retornados pelo TMDB /search/tv ou /tv/{id}
 * @param tmdbType campo `type` de GET /tv/{id} (ex: "Scripted", "Reality", "Talk Show")
 * @returns        Categoria refinada para uso em group.category e tmdb.refined_category
 */
export function refineCategoryFromTmdb(
  current: ContentCategory,
  genreIds: number[],
  tmdbType?: string | null,
): ContentCategory {
  // ── Bloqueios por tmdb_type (fonte mais confiável — campo explícito da API) ──
  if (tmdbType === "Soap" || (tmdbType === "Miniseries" && genreIds.includes(10766))) return "DAILY_SOAP";
  if (tmdbType === "Talk Show")   return "PODCAST";      // → HIDDEN
  if (tmdbType === "News")        return "NEWS";         // → HIDDEN
  if (tmdbType === "Reality")     return "REALITY";      // → HIDDEN (salvo REALITY_PREMIUM)
  if (tmdbType === "Documentary") return "DOCUMENTARY";  // → visível

  // ── Seleção pela prioridade de gêneros ───────────────────────────────────────
  // Itera todos os genre_ids e mantém a categoria com menor CATEGORY_PRIORITY
  // (ou seja, a "mais nobre" na hierarquia editorial).
  let best: ContentCategory = current;
  let bestPriority = CATEGORY_PRIORITY[current];

  for (const gid of genreIds) {
    const cat = TMDB_GENRE_CATEGORY[gid];
    if (cat && CATEGORY_PRIORITY[cat] < bestPriority) {
      bestPriority = CATEGORY_PRIORITY[cat];
    }
  }

  return best;
}

// ── Engine principal ──────────────────────────────────────────────────────────

export interface IcsEngineOptions {
  includeHidden?: boolean;
  windowDays?: number;
  sort?: "priority" | "nextAir";
}

export function runIcsEngine(
  events: IcsEvent[],
  options: IcsEngineOptions = {},
): IcsSeriesGroup[] {
  const { includeHidden = false, windowDays = 30, sort = "nextAir" } = options;

  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + windowDays);
  windowEnd.setHours(23, 59, 59, 999);

  const windowEvents = events.filter(
    (ev) => ev.startAt >= now && ev.startAt <= windowEnd,
  );

  const groupMap = new Map<string, IcsSeriesGroup>();

  for (const ev of windowEvents) {
    const key = normalizeTitleKey(ev.seriesTitle);

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        rawTitle:      ev.seriesTitle,
        category:      "UNKNOWN",
        episodeCount:  0,
        nextAirDate:   ev.startAt.toISOString(),
        lastAirDate:   ev.startAt.toISOString(),
        spanDays:      0,
        episodes:      [],
        seasons:       [],
        relevanceScore: 0,
        isRelevant:    true,
        tmdb:          null,
      });
    }

    const group = groupMap.get(key)!;
    group.episodeCount++;

    if (ev.startAt.toISOString() < group.nextAirDate) group.nextAirDate = ev.startAt.toISOString();
    if (ev.startAt.toISOString() > group.lastAirDate)  group.lastAirDate = ev.startAt.toISOString();

    group.episodes.push({
      season:      ev.season,
      episode:     ev.episode,
      episodeName: ev.episodeName,
      startAt:     ev.startAt.toISOString(),
      endAt:       ev.endAt.toISOString(),
      uid:         ev.uid,
    });

    if (!group.seasons.includes(ev.season)) group.seasons.push(ev.season);
  }

  for (const group of groupMap.values()) {
    const first = new Date(group.nextAirDate);
    const last  = new Date(group.lastAirDate);
    group.spanDays = Math.ceil((last.getTime() - first.getTime()) / 86_400_000);

    let cat = classifyTitle(group.rawTitle);
    if (cat !== "SPORTS" && cat !== "NEWS" && detectSoapByVolume(group.episodeCount, group.spanDays)) {
      cat = "DAILY_SOAP";
    }
    group.category = cat;

    group.episodes.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    group.seasons.sort((a, b) => a - b);
  }

  let groups = Array.from(groupMap.values());

  if (!includeHidden) {
    groups = groups.filter((g) => !HIDDEN_CATEGORIES.has(g.category));
  }

  if (sort === "priority") {
    groups.sort((a, b) => {
      const pa = CATEGORY_PRIORITY[a.category];
      const pb = CATEGORY_PRIORITY[b.category];
      if (pa !== pb) return pa - pb;
      return new Date(a.nextAirDate).getTime() - new Date(b.nextAirDate).getTime();
    });
  } else {
    groups.sort((a, b) =>
      new Date(a.nextAirDate).getTime() - new Date(b.nextAirDate).getTime()
    );
  }

  return groups;
}

// ── Utilitário: agrupa por dia ────────────────────────────────────────────────

export function groupSeriesByDay(groups: IcsSeriesGroup[]): Map<string, IcsSeriesGroup[]> {
  const map = new Map<string, IcsSeriesGroup[]>();
  for (const group of groups) {
    for (const ep of group.episodes) {
      const day = ep.startAt.slice(0, 10);
      const arr = map.get(day) ?? [];
      if (!arr.find((g) => g.key === group.key)) arr.push(group);
      map.set(day, arr);
    }
  }
  return map;
}

export function episodesOnDay(group: IcsSeriesGroup, dateStr: string): SeriesEpisodeWindow[] {
  return group.episodes.filter((ep) => ep.startAt.slice(0, 10) === dateStr);
}

// ── Estatísticas ──────────────────────────────────────────────────────────────

export interface IcsEngineStats {
  totalEvents: number;
  totalGroups: number;
  byCategory: Record<ContentCategory, number>;
  featuredGroups: number;
  hiddenGroups: number;
}

export function computeStats(allGroups: IcsSeriesGroup[], totalEvents: number): IcsEngineStats {
  const byCategory = {} as Record<ContentCategory, number>;
  let featuredGroups = 0;
  let hiddenGroups = 0;

  for (const g of allGroups) {
    byCategory[g.category] = (byCategory[g.category] ?? 0) + 1;
    if (FEATURED_CATEGORIES.has(g.category)) featuredGroups++;
    if (HIDDEN_CATEGORIES.has(g.category))   hiddenGroups++;
  }

  return { totalEvents, totalGroups: allGroups.length, byCategory, featuredGroups, hiddenGroups };
}
