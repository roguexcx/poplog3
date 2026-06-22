// ── src/lib/radar/categories.ts ──────────────────────────────────────────────
// Camada global de categorias de conteúdo.
// Usada por ambas as fontes de dados: BancoSéries (ICS) e TMDB direto.
//
// NOVA ARQUITETURA (modelo de score/curadoria):
//   HIDDEN_CATEGORIES    → exclusão estrutural definitiva (esportes, notícias,
//                          podcast, live event, variety) — fora do escopo do Radar
//   HARD_BLOCKED         → bloqueio rígido incondicional, sem override por score:
//                          DAILY_SOAP — episódios diários, sem curadoria possível
//   FEATURED_CATEGORIES  → categorias exibidas nas seções principais do Radar
//   SECONDARY_CATEGORIES → categorias exibidas em "Também Relevantes" com score médio
//
// MUDANÇA PRINCIPAL:
//   REALITY, KIDS e outras categorias de nicho NÃO são mais descartadas
//   automaticamente. Em vez disso, recebem penalidades de score em eligibility.ts
//   e podem aparecer em seções secundárias se tiverem sinais positivos suficientes.
//
//   DAILY_SOAP continua bloqueado rigidamente — sem override por score, plataforma,
//   popularidade, provider, votos ou qualquer outro sinal editorial.
//
// HIERARQUIA DE EXIBIÇÃO:
//   Destaques         → score muito alto (≥ 85)
//   Novidades/Vem Aí  → score alto (≥ 55)
//   Também Relevantes → score médio (≥ 30)
//   Ocultos           → score baixo (< 30) — não exibidos
// ──────────────────────────────────────────────────────────────────────────────

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

// ── Prioridade editorial (menor número = mais nobre) ─────────────────────────

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

// ── Classificações de exibição ────────────────────────────────────────────────

/**
 * Categorias exibidas nas seções principais do Radar (score alto/muito alto).
 * Inclui REALITY — realities populares, em tendência ou com rede forte sobem
 * naturalmente pelo score; realities de nicho ficam em SECONDARY ou ocultos.
 */
export const FEATURED_CATEGORIES = new Set<ContentCategory>([
  "MOVIE", "CINEMATIC", "SERIES", "ANIMATION", "DOCUMENTARY",
  "REALITY_PREMIUM", "REALITY", "KIDS", "UNKNOWN",
]);

/**
 * Categorias que aparecem na seção "Também Relevantes" (score médio).
 * Qualquer categoria de FEATURED_CATEGORIES com score médio também pode
 * aparecer aqui — a distinção é feita pelo score, não pela categoria.
 */
export const SECONDARY_CATEGORIES = new Set<ContentCategory>([
  "REALITY", "KIDS", "DOCUMENTARY", "ANIMATION", "UNKNOWN",
]);

/**
 * Categorias estruturalmente ocultas — exclusão definitiva, sem override.
 * Nunca aparecem em nenhuma seção, independente de score ou popularidade.
 * Fora do escopo editorial do Radar por definição de formato/conteúdo.
 */
export const HIDDEN_CATEGORIES = new Set<ContentCategory>([
  "SPORTS", "NEWS", "PODCAST", "LIVE_EVENT", "VARIETY",
]);

/**
 * Bloqueios rígidos incondicionais — sem override por score, plataforma,
 * popularidade, provider, votos ou qualquer outro sinal editorial.
 *
 * DAILY_SOAP: episódios diários distorcem o pipeline. Bloqueio total,
 * permanente e incondicional. Não há exceção.
 */
export const HARD_BLOCKED_CATEGORIES = new Set<ContentCategory>([
  "DAILY_SOAP",
]);

/**
 * @deprecated Use HARD_BLOCKED_CATEGORIES + HIDDEN_CATEGORIES separadamente.
 * Mantido para compatibilidade com código legado que usa ALL_BLOCKED_CATEGORIES.
 * Todas as categorias que nunca passam para exibição.
 */
export const DISCARD_CATEGORIES = new Set<ContentCategory>([
  "DAILY_SOAP",
]);

/** Todas as categorias que nunca passam para exibição */
export const ALL_BLOCKED_CATEGORIES = new Set<ContentCategory>([
  ...HIDDEN_CATEGORIES,
  ...HARD_BLOCKED_CATEGORIES,
]);

// ── Padrões de classificação local por título ─────────────────────────────────

const SOAP_PATTERNS = [
  // Novela / soap genérico
  /novela/i, /soap/i, /telenovela/i,
  // Soaps anglófonos / europeus conhecidos
  /in aller freundschaft/i, /lindenstrasse/i,
  /EastEnders/i, /Hollyoaks/i, /Coronation/i, /Emmerdale/i,
  /Neighbours/i, /Sturm der Liebe/i, /Rote Rosen/i, /Verbotene Liebe/i,
  /The Bold/i, /Days of Our/i, /General Hospital/i,
  /The Young/i, /Guiding Light/i, /Home and Away/i,
  /gute zeiten schlechte zeiten/i,
  // Dorama / drama asiático serializado no título
  /dorama/i, /k-?drama/i, /j-?drama/i, /c-?drama/i,
  /lakorn/i, /dizi/i, /daily drama/i, /daily soap/i,
  /serial[\s-]drama/i, /drama[\s-]serial/i,
]

const SPORTS_PATTERNS = [
  /\bfootball\b/i, /\bsoccer\b/i, /\bnfl\b/i, /\bnba\b/i, /\bnhl\b/i,
  /\bmlb\b/i, /\bespn\b/i, /\bliga\b/i, /\bcopa\b/i, /\btorneio\b/i,
  /\bchampions\b.*league/i, /\bpremier league\b/i, /\bformula.*1\b/i,
  /\bf1\b/i, /\bwrestling\b/i, /\bwwe\b/i, /\bufc\b/i, /\bmma\b/i,
];

const TALK_SHOW_PATTERNS = [
  /\blate (night|show|late)\b/i, /\btonight show\b/i, /\blate show with\b/i,
  /\bshow com\b.*\b(jimmy|fallon|kimmel|colbert|meyers)\b/i,
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
  // Marcas infantis conhecidas
  /\bpaw patrol\b/i, /\bsesame street\b/i, /\bpeppa pig\b/i,
  /\bbluey\b/i, /\bdora\b.*explor/i, /\bnick.*jr\b/i,
  /\bpokemon\b/i, /\bdigimon\b/i,
  /\bmy little pony\b/i, /\blittle pony\b/i,
  /\bben 10\b/i,
  /\btransformers.*rescue\b/i,
  /\bwinx\b/i, /\bbratz\b/i,
  /\bbarbie\b/i,
  /\bmasha.*bear\b/i, /\bmasha e o urso\b/i,
  /\bbackyardigans\b/i, /\bdora.*aventureira\b/i,
  /\bspongebob\b/i, /\bbob esponja\b/i,
  // Palavras-chave genericas de conteudo infantil
  /\bkids\b/i, /\bjunior\b/i, /\bnickjr\b/i,
  /\bcartoon\b/i,
  // Princesas / contos de fada infantis (apenas padrões genéricos, não títulos específicos)
  /\bprincesinha\b/i,
  /\bprince.*frog\b/i, /\blittle mermaid.*series\b/i,
  // Disney/Nick franchises infantis
  /\bdisney.*junior\b/i, /\bdisney junior\b/i,
  /\bhandy manny\b/i, /\bspecial agent oso\b/i,
  /\bmickey.*clubhouse\b/i, /\bminnie\b.*bow\b/i,
  /\bdoc mcstuffins\b/i, /\bfireman sam\b/i,
  /\bpostman pat\b/i, /\bthomas.*tank engine\b/i, /\bthomas.*friends\b/i,
  /\bblippi\b/i, /\bchuggington\b/i, /\bteletubbies\b/i,
  /\bin the night garden\b/i, /\bmr rogers\b/i,
  /\bteen titans go\b/i,
];

/**
 * Padrões de ANIME — detectados por título.
 * Anime japonês é tratado separadamente de conteúdo asiático genérico:
 * recebe score e boost próprios, aparece em ANIMATION.
 */
export const ANIME_TITLE_PATTERNS = [
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

const REALITY_PATTERNS = [
  /\breality\b/i, /\bchopped\b/i, /\bkitchen\b.*nightmare/i,
  /\bfixer upper\b/i, /\bhgtv\b/i, /\bdating\b/i, /\bmarried.*first\b/i,
  /\b90 day\b/i, /\bhousewives\b/i, /\bkardashian\b/i,
];

const DAILY_PATTERNS = [/\bdaily\b/i, /\btoday\b/i, /\bevening\b/i];

/**
 * Classifica um título em ContentCategory usando apenas o texto do título.
 * Fonte de dados agnóstica — usada tanto para ICS quanto para TMDB direto.
 */
export function classifyTitle(title: string): ContentCategory {
  if (SPORTS_PATTERNS.some((p) => p.test(title)))           return "SPORTS";
  if (TALK_SHOW_PATTERNS.some((p) => p.test(title)))        return "VARIETY";
  if (NEWS_PATTERNS.some((p) => p.test(title)))             return "NEWS";
  if (PODCAST_PATTERNS.some((p) => p.test(title)))          return "PODCAST";
  if (KIDS_PATTERNS.some((p) => p.test(title)))             return "KIDS";
  if (SOAP_PATTERNS.some((p) => p.test(title)))             return "DAILY_SOAP";
  if (DAILY_PATTERNS.some((p) => p.test(title)))            return "VARIETY";
  if (ANIME_TITLE_PATTERNS.some((p) => p.test(title)))      return "ANIMATION";
  if (REALITY_PATTERNS.some((p) => p.test(title)))          return "REALITY";
  return "SERIES";
}

// ── Mapa de géneros TMDB → categoria ─────────────────────────────────────────

export const TMDB_GENRE_CATEGORY: Record<number, ContentCategory> = {
  10759: "CINEMATIC",  // Ação & Aventura
  16:    "ANIMATION",  // Animação
  35:    "SERIES",     // Comédia
  80:    "CINEMATIC",  // Crime → prestige
  99:    "DOCUMENTARY",
  18:    "CINEMATIC",  // Drama
  10751: "KIDS",       // Família
  10762: "KIDS",       // Kids
  9648:  "CINEMATIC",  // Mistério → prestige
  10763: "NEWS",       // News → HIDDEN
  10764: "REALITY",    // Reality → DISCARD
  10765: "CINEMATIC",  // Sci-Fi & Fantasy
  10766: "DAILY_SOAP", // Soap → DISCARD
  10767: "PODCAST",    // Talk → HIDDEN
  10768: "CINEMATIC",  // Guerra & Política
  37:    "CINEMATIC",  // Faroeste
};

/**
 * Refina a categoria de conteúdo usando dados reais do TMDB.
 * Fonte de dados agnóstica — usada tanto para ICS quanto para TMDB direto.
 *
 * @param current  Categoria local (de classifyTitle ou da fonte de dados)
 * @param genreIds genre_ids retornados pelo TMDB
 * @param tmdbType campo `type` de GET /tv/{id} (ex: "Scripted", "Reality", "Talk Show")
 */
export function refineCategoryFromTmdb(
  current: ContentCategory,
  genreIds: number[],
  tmdbType?: string | null,
): ContentCategory {
  // ── Bloqueios estruturais por tmdb_type/genero ───────────────────────────────
  if (tmdbType === "Soap" || (tmdbType === "Miniseries" && genreIds.includes(10766))) return "DAILY_SOAP";
  if (tmdbType === "Talk Show")   return "VARIETY";
  if (tmdbType === "News")        return "NEWS";
  if (tmdbType === "Reality")     return "REALITY";
  if (tmdbType === "Documentary") return "DOCUMENTARY";

  if (genreIds.includes(10767)) return "VARIETY";
  if (genreIds.includes(10763)) return "NEWS";
  if (genreIds.includes(10766)) return "DAILY_SOAP";
  if (genreIds.includes(10764)) return "REALITY";

  // ── Seleção pela prioridade de gêneros ───────────────────────────────────────
  let best: ContentCategory = current;
  let bestPriority = CATEGORY_PRIORITY[current];

  for (const gid of genreIds) {
    const cat = TMDB_GENRE_CATEGORY[gid];
    if (cat && CATEGORY_PRIORITY[cat] < bestPriority) {
      bestPriority = CATEGORY_PRIORITY[cat];
      best = cat;
    }
  }

  return best;
}

/**
 * Detecta se um conteúdo com original_language="ja" é anime.
 * Anime é tratado separadamente de conteúdo asiático genérico no score.
 *
 * @param title título ou nome original do conteúdo
 * @param genreIds genre_ids do TMDB (16 = Animação)
 */
export function isAnime(title: string, genreIds?: number[]): boolean {
  if (genreIds?.includes(16)) return true; // genre Animação
  return ANIME_TITLE_PATTERNS.some((p) => p.test(title));
}

/**
 * Retorna true se a categoria é exibível em alguma seção (featured ou secondary).
 * Usado para descarte antecipado no pipeline antes de enriquecimento TMDB.
 */
export function isCategoryVisible(cat: ContentCategory): boolean {
  return !ALL_BLOCKED_CATEGORIES.has(cat);
}

/**
 * Retorna true se a categoria está rigidamente bloqueada (sem override possível).
 * Use esta função — não ALL_BLOCKED_CATEGORIES diretamente — para garantir que
 * DAILY_SOAP nunca seja exibido, independente de qualquer sinal positivo.
 */
export function isCategoryHardBlocked(cat: ContentCategory): boolean {
  return HARD_BLOCKED_CATEGORIES.has(cat);
}

// ── Faixas de score para distribuição visual ──────────────────────────────────

// ── Faixas de score para distribuição visual ──────────────────────────────────

/**
 * Thresholds de score para distribuição nas faixas visuais do Radar.
 * O score usado é o radarScore final (após penalidades de eligibility).
 */
export const SCORE_THRESHOLDS = {
  /** Score mínimo para entrar em Destaques */
  SPOTLIGHT:  85,
  /** Score mínimo para entrar nas seções principais (Novidades / Vem Aí) */
  MAIN:       55,
  /** Score mínimo para entrar em Também Relevantes */
  SECONDARY:  30,
  /** Abaixo deste valor: oculto por baixa relevância */
  HIDDEN:     30,
} as const;

export type ScoreTier = "spotlight" | "main" | "secondary" | "hidden";

/** Classifica um score numérico na faixa de exibição correspondente. */
export function getScoreTier(score: number): ScoreTier {
  if (score >= SCORE_THRESHOLDS.SPOTLIGHT) return "spotlight";
  if (score >= SCORE_THRESHOLDS.MAIN)      return "main";
  if (score >= SCORE_THRESHOLDS.SECONDARY) return "secondary";
  return "hidden";
}
