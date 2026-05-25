// ── src/lib/radar/eligibility.ts ─────────────────────────────────────────────
// Camada de elegibilidade editorial do Radar.
//
// NOVA ARQUITETURA — MODELO DE CURADORIA POR SCORE:
//
//   O sistema deixou de bloquear conteúdo amplamente por categoria.
//   Em vez disso, opera em duas camadas:
//
//   CAMADA 1 — Bloqueios estruturais rígidos (hard blocks):
//     Remoção completa — o item nunca aparece em nenhuma seção.
//       • DAILY_SOAP / Novela — formato diário serial, bloqueio absoluto
//       • SPORTS, NEWS, PODCAST, LIVE_EVENT, VARIETY — fora do escopo
//       • Episódios fantasmas ou tecnicamente inválidos
//       • Duplicatas confirmadas
//       • Sem identificação mínima (sem título, sem tmdb_id)
//       • Devocional explícito (programação religiosa de nicho declarada)
//       • Infantil pré-escolar genérico explícito (tmdbType Kids + rede infantil)
//       • Dorama/drama asiático serializado sem distribuição global — sem rede
//         global E sem provider BR (K-drama na Netflix/Amazon passa normalmente)
//       • Reality/Docs irrelevantes — sem rede global E sem provider BR E pop < 40
//
//   CAMADA 2 — Penalidades de score (soft penalties):
//     Item passa mas com score rebaixado — pode aparecer em Também Relevantes.
//     Reservado apenas para casos onde há algum sinal positivo parcial.
//
//   Penalidades disponíveis:
//     • kids_content_generic      → -30 (infantil genérico, não-premiado)
//     • preschool_kids_explicit   → BLOQUEIO (pré-escolar explícito — único hard block de KIDS)
//     • religious_niche           → -35 (canal/keyword devocional sem sinal global)
//     • low_brazil_relevance      → -15 (sem provider BR + sem rede global + baixa pop)
//     • low_editorial_signal      → -10 (sem TMDB enriquecido + irrisório)
//
// REGRA DE DESIGN:
//   Toda penalidade deve ser justificável por metadados objetivos, não por título.
//
// BBC:
//   Não é bloqueada, não é penalizada automaticamente.
//   É Tier 2 no score — produções BBC locais de nicho terão score baixo
//   pela ausência de popularidade + provider BR, caindo em seções secundárias.
// ─────────────────────────────────────────────────────────────────────────────

import type { ContentCategory } from "./categories";
import { isCategoryHardBlocked } from "./categories";
import type { ScorePenalty } from "./score";

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type EligibilityReason =
  | "eligible"
  // Hard blocks (sem override)
  | "hard_blocked_category"
  | "preschool_kids_explicit"
  | "devotional_explicit"
  | "invalid_episode"
  | "duplicate"
  | "no_minimum_data"
  | "hard_blocked_asian_serial"     // dorama sem distribuição global
  | "hard_blocked_nonfiction_niche" // reality/doc irrelevante sem sinal global
  // Soft penalties (item passa com score rebaixado)
  | "penalized_kids_generic"
  | "penalized_religious_niche"
  | "penalized_low_brazil_relevance"
  | "penalized_low_editorial_signal";

export interface EligibilityResult {
  eligible: boolean;
  reason: EligibilityReason;
  /** Penalidades de score a aplicar (vazio se bloqueado ou sem penalidades) */
  penalties: ScorePenalty[];
  /** Sinais usados na decisão — para diagnóstico e calibração */
  signals: string[];
}

export interface EligibilityInput {
  title: string;
  category: ContentCategory;
  tmdbType?: string | null;
  genreIds?: number[] | null;
  originalLanguage?: string | null;
  originCountry?: string[] | null;
  overview?: string | null;
  keywords?: string[] | null;
  popularity?: number | null;
  voteCount?: number | null;
  voteAverage?: number | null;
  networks?: Array<{ id?: number | null; name?: string | null; origin_country?: string | null }> | null;
  productionCompanies?: Array<{ id?: number | null; name?: string | null; origin_country?: string | null }> | null;
  brazilProviders?: string[] | null;
  hasTmdb?: boolean;
  relevanceScore?: number | null;
}

// ── Gêneros TMDB ──────────────────────────────────────────────────────────────

const GENRE_ANIMATION   = 16;
const GENRE_DOCUMENTARY = 99;
const GENRE_FAMILY      = 10751;
const GENRE_KIDS        = 10762;
const GENRE_REALITY     = 10764;
const GENRE_SOAP        = 10766;
const GENRE_TALK        = 10767;
const GENRE_NEWS        = 10763;
const GENRE_DRAMA       = 18;

// Suprimir warnings de variáveis não usadas neste arquivo
void GENRE_DOCUMENTARY;
void GENRE_REALITY;

// ── Networks globais relevantes ───────────────────────────────────────────────
//
// DOIS NÍVEIS de "rede global":
//
// STREAMING_GLOBAL_IDS — plataformas de streaming com presença real no Brasil.
//   Escudo FORTE: bypassa blocos de reality, documentary e nonfiction niche.
//   Exemplos que PASSAM: RuPaul na Netflix, Making a Murderer na Netflix.
//
// GLOBALLY_RELEVANT_NETWORK_IDS — union: streaming + redes broadcast/prestige
//   que produzem ficção de qualidade (AMC, FX, BBC, NBC, ABC…).
//   Escudo FRACO: bypassa blocos de scripted/dorama/ibero, mas NÃO bypassa
//   blocos de reality e documentary — esses exigem streaming ou provider BR.
//   Exemplos que PASSAM com escudo fraco: Dark Winds (AMC), Sherlock (BBC).
//   Exemplos que NÃO passam só com escudo fraco: Who Do You Think You Are?
//   (NBC, documentary sem provider BR), genealogy docs de broadcast.

const STREAMING_GLOBAL_IDS = new Set<number>([
  213,  // Netflix
  1024, // Amazon Prime Video (exclui Amazon Freevee — ver FREEMIUM_ADDON_IDS)
  2552, // Apple TV+
  2739, // Disney+
  3353, // Paramount+
  453,  // Hulu
  49,   // HBO
  6267, // Max (HBO Max)
  4330, // Peacock
  57,   // Showtime
  318,  // Starz
  3527, // Globo (BR — streaming Globoplay)
  684,  // Canal+ (FR — streaming internacional)
]);

// Sub-serviços freemium/AVOD que aparecem como "rede" no TMDB mas não são
// plataformas de streaming premium com presença editorial no Brasil.
// Quando uma série tem APENAS redes desta lista (sem nenhuma rede de STREAMING_GLOBAL_IDS
// que não seja o serviço-pai), não deve ser considerada como tendo "streaming global".
const FREEMIUM_ADDON_IDS = new Set<number>([
  5865,  // Amazon Freevee (AVOD gratuito — Tribunal Justice, court shows US)
  2552,  // (placeholder — Tubi, Pluto TV e similares podem ser adicionados aqui)
]);

const GLOBALLY_RELEVANT_NETWORK_IDS = new Set<number>([
  // Streaming (subconjunto de STREAMING_GLOBAL_IDS)
  213,  // Netflix
  1024, // Amazon Prime Video
  2552, // Apple TV+
  2739, // Disney+
  3353, // Paramount+
  453,  // Hulu
  49,   // HBO
  6267, // Max (HBO Max)
  4330, // Peacock
  57,   // Showtime
  318,  // Starz
  3527, // Globo (BR)
  684,  // Canal+ (FR)
  // Redes prestige/scripted (escudo fraco — só para ficção)
  174,  // AMC (Mad Men, Breaking Bad, The Walking Dead)
  1709, // FX (The Americans, Fargo, The Bear)
  67,   // Syfy (ficção científica global)
  2336, // National Geographic (docs premium co-produzidos)
  6,    // NBC (broadcast US — apenas scripted prestige)
  2,    // ABC (broadcast US — apenas scripted prestige)
  1,    // Fox (broadcast US — apenas scripted prestige)
  3,    // CBS (broadcast US — apenas scripted prestige)
  4,    // BBC One (prestige UK scripted)
  393,  // BBC Two
  9,    // BBC Three
  3327, // Channel 4 (UK — Humans, Utopia, It's a Sin)
  // 64 — Discovery Channel removido: reality de nicho US (Gold Rush, Homestead Rescue,
  //      Deadliest Catch) passava indevidamente.
]);

// ── Networks de nicho local ───────────────────────────────────────────────────

const LOCAL_NICHE_NETWORK_IDS = new Set<number>([
  1267, // HGTV
  182,  // History Channel
  74,   // A&E
  80,   // Travel Channel
  71,   // Lifetime
  2659, // Oxygen
  1985, // MeTV
  3371, // Comet TV
  1790, // Ion Television
  1659, // Reelz
]);

// ── Networks religiosos de nicho ─────────────────────────────────────────────

const RELIGIOUS_NETWORK_IDS = new Set<number>([]);

const RELIGIOUS_NETWORK_NAME_PATTERNS: RegExp[] = [
  /\btbn\b/i, /\bdaystar\b/i, /\bewtn\b/i, /\bgod\s?tv\b/i,
  /\btrinity\s*broadcast/i, /\bfaith\s*channel\b/i,
  /\bchristian\s*(broadcast|network|channel)\b/i, /\bcbn\b/i,
  /\bjesus\s*channel\b/i,
];

// ── Keywords TMDB ─────────────────────────────────────────────────────────────

const RELIGIOUS_NICHE_KEYWORDS = new Set<string>([
  "bible", "biblical", "bible study", "scripture", "devotional",
  "sermon", "gospel music", "christian television", "religious programming",
  "faith-based", "ministry", "evangelical", "catechism",
]);

const RELIGIOUS_PREMIUM_KEYWORDS = new Set<string>([
  "religion", "catholicism", "vatican", "mythology", "cult", "exorcism",
  "supernatural", "faith", "spirituality",
]);

const LOCAL_FACTUAL_KEYWORDS = new Set<string>([
  "home renovation", "home improvement", "house hunting", "real estate",
  "property", "interior design", "fixer upper", "home makeover",
  "cabin restoration", "house flipping", "regional cuisine", "local food",
  "cooking show", "food travel", "restaurant", "street food",
  "chef competition", "travel", "railway", "train journey", "road trip",
  "local tourism", "countryside", "rural life", "village",
  "storm chasing", "extreme weather", "tornado", "weather",
  "wildlife", "fishing", "hunting", "outdoor", "lifestyle",
  "gardening", "crafts", "sewing", "baking", "slow television", "wellness",
]);

const KIDS_KEYWORDS = new Set<string>([
  "preschool", "children", "kids", "toddler", "animated series for children",
  "educational children", "children's animation", "puppet show",
  "nursery rhyme", "fairy tale for children",
]);

// ── Padrões de formato em título (último recurso) ─────────────────────────────

const SOAP_FORMAT_IN_TITLE: RegExp[] = [
  /\bdaily\s+soap\b/i, /\bsoap\s+opera\b/i, /\btelenovela\b/i,
  /\bk-?\s*drama\b/i, /\bj-?\s*drama\b/i, /\bc-?\s*drama\b/i,
  /\bdorama\b/i, /\blakorn\b/i, /\bdizi\b/i, /\bdaily\s+drama\b/i,
];

const DEVOTIONAL_FORMAT_IN_TITLE: RegExp[] = [
  /\bbible\s+study\b/i, /\bscripture\s+lesson\b/i, /\bdevotion(al)?\b/i,
  /\bsermon\b/i, /\bpastor['s]*\s+\w+\s+show\b/i,
  /\bgospel\s+(hour|show|time)\b/i, /\bword\s+of\s+(god|life|faith)\b/i,
];

// ── Países de alta relevância para o Brasil ───────────────────────────────────

const HIGH_RELEVANCE_COUNTRIES = new Set<string>([
  "BR", "US", "GB", "FR", "ES", "MX", "AR", "CO", "IT", "DE",
  "JP", "KR", "AU", "CA", "SE", "DK", "NO", "IL", "IN",
]);

const RELEVANT_LANGUAGES = new Set<string>(["en", "pt", "es", "fr", "it", "de", "ja", "ko"]);

const BBC_NETWORK_IDS = new Set<number>([4, 393, 9, 2, 3327]);

const KIDS_NETWORK_IDS = new Set<number>([44, 56, 1591, 2103]);

const KIDS_NETWORK_NAME_PATTERNS: RegExp[] = [
  /\bdisney\s*jr(unior)?\b/i, /\bnick\s*jr\b/i, /\bnickelodeon\b/i,
  /\bcartoon\s*network\b/i, /\bpbs\s*kids\b/i, /\bcbeebies\b/i,
  /\babc\s*kids\b/i,
];

// ── Funções auxiliares ────────────────────────────────────────────────────────

type Network = { id?: number | null; name?: string | null; origin_country?: string | null };

function networkIds(networks: Network[] | null | undefined): number[] {
  return (networks ?? []).filter((n) => n.id != null).map((n) => n.id as number);
}

function hasGlobalNetwork(networks: Network[] | null | undefined): boolean {
  return networkIds(networks).some((id) => GLOBALLY_RELEVANT_NETWORK_IDS.has(id));
}

// Escudo forte: só plataformas de streaming com presença real no Brasil.
// Usado nos blocos de reality e documentary — broadcast (NBC, BBC, CBS…) não basta.
function hasStreamingGlobal(networks: Network[] | null | undefined): boolean {
  return networkIds(networks).some((id) => STREAMING_GLOBAL_IDS.has(id));
}

// Escudo forte excluindo serviços freemium/AVOD.
// Usado no bloco de reality — Amazon Freevee (Tribunal Justice) não deve escudar reality.
// Uma série com Prime Video (1024) + Amazon Freevee (5865) passa normalmente porque
// tem o serviço-pai. Uma com APENAS Freevee não passa.
function hasStreamingGlobalNonFreemium(networks: Network[] | null | undefined): boolean {
  const ids = networkIds(networks);
  const streamingIds = ids.filter((id) => STREAMING_GLOBAL_IDS.has(id));
  if (streamingIds.length === 0) return false;
  // Todos os streaming IDs presentes são apenas freemium addons → não conta
  return streamingIds.some((id) => !FREEMIUM_ADDON_IDS.has(id));
}

function hasLocalNicheNetwork(networks: Network[] | null | undefined): boolean {
  return networkIds(networks).some((id) => LOCAL_NICHE_NETWORK_IDS.has(id));
}

function isBBCOnly(networks: Network[] | null | undefined): boolean {
  const nets = networks ?? [];
  if (nets.length === 0) return false;
  return nets.every((n) => n.id != null && BBC_NETWORK_IDS.has(n.id));
}

function hasReligiousNetwork(networks: Network[] | null | undefined): boolean {
  return (
    (networks ?? []).some((n) => n.id != null && RELIGIOUS_NETWORK_IDS.has(n.id)) ||
    (networks ?? []).some((n) => n.name != null && RELIGIOUS_NETWORK_NAME_PATTERNS.some((p) => p.test(n.name!)))
  );
}

function hasKidsNetwork(networks: Network[] | null | undefined): boolean {
  return (
    networkIds(networks).some((id) => KIDS_NETWORK_IDS.has(id)) ||
    (networks ?? []).some((n) => n.name != null && KIDS_NETWORK_NAME_PATTERNS.some((p) => p.test(n.name!)))
  );
}

function hasKeyword(
  keywords: string[] | null | undefined,
  targetSet: Set<string>,
): string | null {
  for (const kw of keywords ?? []) {
    const lower = kw.toLowerCase().trim();
    if (targetSet.has(lower)) return kw;
    for (const target of targetSet) {
      if (lower.includes(target) || target.includes(lower)) return kw;
    }
  }
  return null;
}

function hasBrazilProvider(providers: string[] | null | undefined): boolean {
  return (providers ?? []).length > 0;
}

function isHighRelevanceCountry(countries: string[] | null | undefined): boolean {
  return (countries ?? []).some((c) => HIGH_RELEVANCE_COUNTRIES.has(c));
}

function describeNetworks(networks: Network[] | null | undefined): string {
  const nets = networks ?? [];
  if (nets.length === 0) return "none";
  return nets.slice(0, 3).map((n) => (n.name ?? `id:${n.id ?? "?"}`)).join(",");
}

// ── Função principal ──────────────────────────────────────────────────────────

/**
 * Classifica a elegibilidade editorial de um item para o Radar.
 *
 * Retorna:
 *   eligible: true  → item passa para o pipeline (com penalidades opcionais de score)
 *   eligible: false → item bloqueado rigidamente (hard block, sem override possível)
 */
export function classifyRadarEligibility(input: EligibilityInput): EligibilityResult {
  const signals: string[] = [];
  const penalties: ScorePenalty[] = [];

  const category    = input.category;
  const tmdbType    = (input.tmdbType ?? "").trim();
  const genreIds    = input.genreIds ?? [];
  const lang        = input.originalLanguage ?? "";
  const countries   = input.originCountry ?? [];
  const networks    = input.networks ?? [];
  const keywords    = input.keywords ?? [];
  const popularity  = input.popularity ?? 0;
  const voteCount   = input.voteCount ?? 0;
  const voteAverage = input.voteAverage ?? 0;
  const hasTmdb     = input.hasTmdb ?? false;
  const relevScore  = input.relevanceScore ?? 0;
  const brProviders = input.brazilProviders ?? [];
  const title       = (input.title ?? "").trim();

  signals.push(`category:${category}`);
  if (tmdbType)             signals.push(`type:${tmdbType}`);
  if (genreIds.length > 0)  signals.push(`genres:[${genreIds.join(",")}]`);
  if (lang)                 signals.push(`lang:${lang}`);
  if (countries.length > 0) signals.push(`origin:[${countries.join(",")}]`);
  signals.push(`networks:${describeNetworks(networks)}`);
  signals.push(`pop:${Math.round(popularity)}`);
  signals.push(`votes:${voteCount}`);
  if (brProviders.length > 0) signals.push(`br_providers:[${brProviders.join(",")}]`);
  if (keywords.length > 0)  signals.push(`keywords:[${keywords.slice(0, 5).join(",")}]`);
  signals.push(hasTmdb ? "has_tmdb" : "no_tmdb");

  // Sinal global positivo — reduz penalidades contextuais
  const hasStrongPositiveSignal =
    hasGlobalNetwork(networks) ||
    hasBrazilProvider(brProviders) ||
    popularity > 80 ||
    (voteCount > 500 && voteAverage >= 7.0);

  if (hasStrongPositiveSignal) signals.push("override:strong_positive_signal");

  // ══════════════════════════════════════════════════════════════════════════
  // CAMADA 1 — BLOQUEIOS ESTRUTURAIS RÍGIDOS
  // ══════════════════════════════════════════════════════════════════════════

  // 1a. Categorias estruturalmente bloqueadas (DAILY_SOAP, SPORTS, NEWS…)
  if (isCategoryHardBlocked(category)) {
    signals.push(`hard_block:category:${category}`);
    return { eligible: false, reason: "hard_blocked_category", penalties: [], signals };
  }

  // 1b. DAILY_SOAP por tipo/gênero TMDB — sem override possível jamais
  if (
    tmdbType === "Soap" ||
    genreIds.includes(GENRE_SOAP) ||
    SOAP_FORMAT_IN_TITLE.some((p) => p.test(title))
  ) {
    const trigger =
      tmdbType === "Soap"            ? "tmdb_type:Soap" :
      genreIds.includes(GENRE_SOAP)  ? "genre:10766_soap" :
                                       "title_contains_soap_format";
    signals.push(`hard_block:soap:${trigger}`);
    return { eligible: false, reason: "hard_blocked_category", penalties: [], signals };
  }

  // 1c. Talk Show / News por tipo/gênero
  if (
    tmdbType === "Talk Show" || tmdbType === "News" ||
    genreIds.includes(GENRE_TALK) || genreIds.includes(GENRE_NEWS)
  ) {
    signals.push("hard_block:talk_or_news");
    return { eligible: false, reason: "hard_blocked_category", penalties: [], signals };
  }

  // 1d. Infantil pré-escolar explícito
  // APENAS: rede infantil confirmada + tmdbType Kids + keyword pré-escolar
  // NÃO bloqueia: animações adultas, anime, Bluey, Simpsons, etc.
  const isExplicitPreschool =
    hasKidsNetwork(networks) &&
    (tmdbType === "Kids" || genreIds.includes(GENRE_KIDS)) &&
    hasKeyword(keywords, KIDS_KEYWORDS) !== null;

  if (isExplicitPreschool) {
    signals.push(
      `hard_block:preschool_explicit network:${describeNetworks(networks)}` +
      ` type:${tmdbType}`,
    );
    return { eligible: false, reason: "preschool_kids_explicit", penalties: [], signals };
  }

  // 1d-bis. Infantil de nicho sem distribuição relevante — HARD BLOCK
  //
  // Bloqueia títulos infantis (category KIDS ou genre KIDS/FAMILY) distribuídos
  // apenas em redes infantis de nicho (Disney Junior, Nick Jr., etc.) sem nenhum
  // sinal de distribuição global ou presença no Brasil.
  //
  // Exemplos que BLOQUEIAM: Sofia the First, PAW Patrol (sem Netflix), shows
  //   Disney Junior genéricos sem provider BR
  // Exemplos que PASSAM: Bluey (provider BR / rede global), Pokémon (pop alta +
  //   rede global), The Simpsons (não é rede infantil), Bluey na Netflix
  //
  // Condições necessárias (todas):
  //   • category KIDS OU genre KIDS (10762) OU genre FAMILY (10751) + rede infantil
  //   • rede infantil confirmada (Disney Jr, Nick Jr, Cartoon Network, etc.)
  //   • sem rede globalmente relevante
  //   • sem provider no Brasil
  //   • popularidade baixa (< 40)
  const isKidsCategory = category === "KIDS" || genreIds.includes(GENRE_KIDS);
  const isFamilyWithKidsNet =
    genreIds.includes(GENRE_FAMILY) && hasKidsNetwork(networks);

  const isKidsNicheNoDistribution =
    (isKidsCategory || isFamilyWithKidsNet) &&
    hasKidsNetwork(networks) &&
    !hasStreamingGlobal(networks) &&   // broadcast (NBC, ABC, BBC) não protege conteúdo kids
    !hasBrazilProvider(brProviders) &&
    popularity < 40;

  if (isKidsNicheNoDistribution) {
    signals.push(
      `hard_block:kids_niche_no_distribution network:${describeNetworks(networks)}` +
      ` pop:${Math.round(popularity)}`,
    );
    return { eligible: false, reason: "preschool_kids_explicit", penalties: [], signals };
  }

  // 1e. Devocional explícito
  // APENAS: canal religioso de nicho (TBN, Daystar, EWTN) + keyword devocional + sem rede global
  // NÃO bloqueia: filmes/séries com tema religioso (The Young Pope, Midnight Mass)
  const isExplicitDevotional =
    hasReligiousNetwork(networks) &&
    hasKeyword(keywords, RELIGIOUS_NICHE_KEYWORDS) !== null &&
    !hasGlobalNetwork(networks);

  if (isExplicitDevotional) {
    signals.push(`hard_block:devotional_explicit network:${describeNetworks(networks)}`);
    return { eligible: false, reason: "devotional_explicit", penalties: [], signals };
  }

  // 1f. Devocional por título (fallback — apenas formato, não nome de programa)
  if (DEVOTIONAL_FORMAT_IN_TITLE.some((p) => p.test(title)) && !hasGlobalNetwork(networks)) {
    signals.push("hard_block:devotional_title_format");
    return { eligible: false, reason: "devotional_explicit", penalties: [], signals };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CAMADA 2 — PENALIDADES DE SCORE (soft penalties)
  // Item passa — score é rebaixado progressivamente
  // ══════════════════════════════════════════════════════════════════════════

  // 2a. Conteúdo infantil genérico
  if (!hasStrongPositiveSignal) {
    const isKidsGenre = genreIds.includes(GENRE_KIDS) || category === "KIDS";
    const isChildrenAnimation =
      genreIds.includes(GENRE_ANIMATION) &&
      genreIds.includes(GENRE_FAMILY) &&
      popularity < 60 &&
      !hasGlobalNetwork(networks);

    if (isKidsGenre || isChildrenAnimation) {
      const reason = isKidsGenre ? "genre:KIDS" : "animation+family+low_pop";
      penalties.push({ reason: `penalized_kids_generic:${reason}`, value: -30 });
      signals.push(`penalty:-30 kids_generic:${reason}`);
    } else if (hasKidsNetwork(networks) && !hasGlobalNetwork(networks)) {
      penalties.push({ reason: "penalized_kids_generic:kids_network", value: -20 });
      signals.push(`penalty:-20 kids_network:${describeNetworks(networks)}`);
    }
  }

  // 2b. Canal/keywords religioso de nicho
  if (!hasStrongPositiveSignal) {
    const hasReligNet = hasReligiousNetwork(networks);
    const religKw = hasKeyword(keywords, RELIGIOUS_NICHE_KEYWORDS);
    const isPremiumReligKw = hasKeyword(keywords, RELIGIOUS_PREMIUM_KEYWORDS);

    if (hasReligNet && !hasGlobalNetwork(networks)) {
      penalties.push({ reason: "penalized_religious_niche:religious_network", value: -35 });
      signals.push(`penalty:-35 religious_network:${describeNetworks(networks)}`);
    } else if (religKw && !isPremiumReligKw && !hasGlobalNetwork(networks) && popularity < 30) {
      penalties.push({ reason: `penalized_religious_niche:keyword:${religKw}`, value: -25 });
      signals.push(`penalty:-25 religious_keyword:"${religKw}" pop:${Math.round(popularity)}`);
    }
  }

  // 2c. Reality / Docs irrelevantes — HARD BLOCK
  //
  // REALITY: bloqueado sem override de popularidade.
  //   Talent shows, home makeover, survival rural, court shows — mesmo com audiência
  //   alta localmente, não têm valor editorial no Radar de lançamentos.
  //   Passa APENAS se tiver provider BR (ex: Big Brother Brasil na Globoplay) ou
  //   rede global confirmada (ex: RuPaul na Netflix).
  //
  // DOCUMENTARY: threshold mais generoso (pop < 40) — docs de natureza/investigação
  //   podem ter relevância editorial mesmo sem provider BR confirmado.
  //
  // Exemplos que PASSAM:  Making a Murderer (Netflix provider BR), RuPaul's Drag Race
  //   (Netflix global), Big Brother Brasil (Globoplay provider BR)
  // Exemplos que BLOQUEIAM: Britain's Got Talent (ITV, sem BR), Gold Rush (Discovery,
  //   sem BR), Homestead Rescue (Discovery, sem BR), Tribunal Justice (nicho US)
  const isReality =
    category === "REALITY" || category === "REALITY_PREMIUM" ||
    tmdbType === "Reality" ||
    genreIds.includes(GENRE_REALITY);

  const isDocumentary =
    category === "DOCUMENTARY" ||
    tmdbType === "Documentary" ||
    genreIds.includes(GENRE_DOCUMENTARY);

  // Reality: sem provider BR e sem streaming global → bloqueio incondicional.
  //   Broadcast (NBC, ITV, BBC, CBS) NAO protege reality.
  //   AVOD/Freevee (ex: Tribunal Justice): tem Prime Video (1024) tecnico mas
  //   tambem Amazon Freevee (5865) — tier gratuito sem valor editorial.
  //   Se QUALQUER rede do item esta em FREEMIUM_ADDON_IDS, tratamos como sem streaming.
  const hasFreemiumTaint = networkIds(networks).some((id) => FREEMIUM_ADDON_IDS.has(id));
  const realityStreamingOk = !hasFreemiumTaint && hasStreamingGlobal(networks);
  if (isReality && !realityStreamingOk && !hasBrazilProvider(brProviders)) {
    signals.push(
      `hard_block:reality_no_distribution pop:${Math.round(popularity)}` +
      ` networks:${describeNetworks(networks)}`,
    );
    return { eligible: false, reason: "hard_blocked_nonfiction_niche", penalties: [], signals };
  }

  // Documentary: threshold mantido — docs sem streaming global e pop baixa
  //   Broadcast (NBC, BBC, Channel 4) NÃO protege documentários de nicho.
  //   Exemplos bloqueados: Who Do You Think You Are? (NBC, genealogy doc, pop < 40)
  //   Exemplos que PASSAM: Planet Earth III (BBC + Netflix provider BR)
  if (isDocumentary && !hasStreamingGlobal(networks) && !hasBrazilProvider(brProviders) && popularity < 40) {
    signals.push(
      `hard_block:nonfiction_niche pop:${Math.round(popularity)}` +
      ` networks:${describeNetworks(networks)}`,
    );
    return { eligible: false, reason: "hard_blocked_nonfiction_niche", penalties: [], signals };
  }

  // 2d. Baixa relevância para o Brasil

  // Cenário A: BBC-only britânico local de nicho
  const isBritishLocalBBCOnly =
    countries.includes("GB") &&
    !countries.some((c) => ["US", "CA", "AU", "NZ", "IE"].includes(c)) &&
    lang === "en" &&
    isBBCOnly(networks) &&
    !hasBrazilProvider(brProviders) &&
    popularity < 30 &&
    voteCount < 150;

  if (isBritishLocalBBCOnly) {
    penalties.push({ reason: "penalized_low_brazil_relevance:british_bbc_only", value: -15 });
    signals.push(
      `penalty:-15 low_brazil_relevance:british_bbc_only pop:${Math.round(popularity)}` +
      ` votes:${voteCount}`,
    );
  }

  // Cenário B: Idioma/país irrelevante + sem sinal global
  if (
    !RELEVANT_LANGUAGES.has(lang) &&
    !isHighRelevanceCountry(countries) &&
    !hasGlobalNetwork(networks) &&
    !hasBrazilProvider(brProviders) &&
    popularity < 25 &&
    voteCount < 80
  ) {
    penalties.push({ reason: "penalized_low_brazil_relevance:no_relevant_signal", value: -15 });
    signals.push(
      `penalty:-15 low_brazil_relevance:no_relevant_signal lang:${lang}` +
      ` pop:${Math.round(popularity)} votes:${voteCount}`,
    );
  }

  // 2e. Drama asiático serializado de nicho — HARD BLOCK
  // Doramas (KR, TH, VN, PH, TR) sem rede global E sem provider BR são removidos.
  // K-drama mainstream no Netflix/Amazon (hasGlobalNetwork=true) continua passando.
  // Anime japonês não cai aqui — já sai filtrado por genre 16 (ANIMATION) antes.
  const isAsianSerialNiche =
    (countries.includes("KR") || countries.includes("TH") ||
     countries.includes("VN") || countries.includes("PH") ||
     (countries.includes("TR") && lang === "tr") ||
     (countries.includes("CN") && !genreIds.includes(GENRE_ANIMATION)) ||
     (countries.includes("TW") && !genreIds.includes(GENRE_ANIMATION)) ||
     (countries.includes("HK") && !genreIds.includes(GENRE_ANIMATION))) &&
    (genreIds.includes(GENRE_DRAMA) || tmdbType === "Scripted") &&
    !hasGlobalNetwork(networks) &&
    !hasBrazilProvider(brProviders);

  if (isAsianSerialNiche) {
    signals.push(
      `hard_block:asian_serial_niche country:[${countries.join(",")}]` +
      ` votes:${voteCount} pop:${Math.round(popularity)}`,
    );
    return { eligible: false, reason: "hard_blocked_asian_serial", penalties: [], signals };
  }

  // 2f. Série ibero-americana de nicho — HARD BLOCK
  //
  // Séries scripted em espanhol (ou português europeu) de países latinos/ibéricos
  // sem qualquer distribuição global ou presença no Brasil.
  //
  // Exemplos que BLOQUEIAM: Lobo morir matando (MX, rede local), séries Televisa/
  //   Canal Estrellas/RCN sem Netflix ou provider BR, produções espanholas de nicho
  //   sem HBO/Netflix/Prime
  //
  // Exemplos que PASSAM:
  //   • Casa de Papel → Netflix (rede global)
  //   • Narcos: Mexico → Netflix + provider BR
  //   • El Ministerio del Tiempo → pop 75 + votos 1200 (acima dos thresholds)
  //   • Séries brasileiras → origin BR já tem tratamento separado (HIGH_RELEVANCE_COUNTRIES)
  //   • Séries ES/MX com popularidade alta (> 30) → sinal de relevância suficiente
  //
  // Países cobertos: ES, MX, CO, AR, CL, PE, VE, EC, BO, PY, UY, CR, PA, DO, GT, HN, NI, SV
  // (PT de Portugal incluído — não confundir com BR que já é HIGH_RELEVANCE)
  const IBERO_LATAM_COUNTRIES = new Set([
    "ES", "MX", "CO", "AR", "CL", "PE", "VE", "EC", "BO", "PY", "UY",
    "CR", "PA", "DO", "GT", "HN", "NI", "SV", "PT",
  ]);

  // Nota: não usamos hasStrongPositiveSignal aqui — votos altos de séries antigas
  // (Grand Hotel, séries Antena 3/TVE históricas) indicam legado, não distribuição atual.
  // Somente rede global real ou provider BR justifica passar este bloco.
  const isIberoLatamScripted =
    (lang === "es" || (lang === "pt" && !countries.includes("BR"))) &&
    countries.some((c) => IBERO_LATAM_COUNTRIES.has(c)) &&
    !countries.includes("BR") &&           // séries BR têm tratamento próprio
    (tmdbType === "Scripted" || genreIds.includes(GENRE_DRAMA)) &&
    !hasGlobalNetwork(networks) &&
    !hasBrazilProvider(brProviders) &&
    popularity < 60;  // threshold ampliado — votos altos não substituem distribuição

  if (isIberoLatamScripted) {
    signals.push(
      `hard_block:ibero_latam_niche country:[${countries.join(",")}]` +
      ` lang:${lang} pop:${Math.round(popularity)} votes:${voteCount}`,
    );
    return { eligible: false, reason: "hard_blocked_nonfiction_niche", penalties: [], signals };
  }

  // 2g. Série americana em rede local de nicho — HARD BLOCK
  //
  // Shows de nicho produzidos para redes locais/syndication americanas sem qualquer
  // distribuição global ou presença no Brasil.
  //
  // Exemplos que BLOQUEIAM: Svengoolie (MeTV), shows de horror B de madrugada,
  //   séries locais de game show / lifestyle sem Peacock/Hulu/Netflix
  //
  // Exemplos que PASSAM:
  //   • Dark Winds (AMC) → rede AMC está em GLOBALLY_RELEVANT_NETWORK_IDS
  //   • Qualquer série com provider BR
  //   • Série US com popularity > 30 (já tem sinal de audiência suficiente)
  //
  // Redes cobertas por LOCAL_NICHE_NETWORK_IDS: HGTV (1267), Travel Channel (80),
  //   History Channel (182), A&E (74), Lifetime (71), Oxygen (2659), MeTV (1985)
  const isUSLocalNicheNetwork =
    countries.includes("US") &&
    lang === "en" &&
    (hasLocalNicheNetwork(networks) ||
     // fallback: rede presente mas não está em nenhuma das listas conhecidas
     // + sem rede global = rede de nicho não catalogada
     (networks.length > 0 && !hasGlobalNetwork(networks))) &&
    !hasBrazilProvider(brProviders) &&
    popularity < 30 &&
    voteCount < 200;

  if (isUSLocalNicheNetwork) {
    signals.push(
      `hard_block:us_local_niche_network network:${describeNetworks(networks)}` +
      ` pop:${Math.round(popularity)} votes:${voteCount}`,
    );
    return { eligible: false, reason: "hard_blocked_nonfiction_niche", penalties: [], signals };
  }

  // 2g-bis. Série anglófona de nicho local não-americana (AU, NZ, IE, ZA…) — HARD BLOCK
  //
  // Quiz shows, game shows, lifestyle e factual de redes locais de países anglófonos
  // que não sejam US/GB (já cobertos por outros blocos). Sem rede global, sem provider BR,
  // baixíssima popularidade.
  //
  // Exemplos que BLOQUEIAM: Hard Quiz (ABC AU, pop < 5), local quiz AU/NZ/IE
  // Exemplos que PASSAM: séries australianas na Netflix/Stan com provider BR
  const OTHER_ANGLOPHONE = new Set(["AU", "NZ", "IE", "ZA", "IN"]);
  const isAngloNicheNonUS =
    lang === "en" &&
    countries.some((c) => OTHER_ANGLOPHONE.has(c)) &&
    !countries.some((c) => ["US", "GB"].includes(c)) &&
    !hasGlobalNetwork(networks) &&
    !hasBrazilProvider(brProviders) &&
    popularity < 10 &&
    voteCount < 200;

  if (isAngloNicheNonUS) {
    signals.push(
      `hard_block:anglo_niche_local country:[${countries.join(",")}]` +
      ` pop:${Math.round(popularity)} votes:${voteCount}`,
    );
    return { eligible: false, reason: "hard_blocked_nonfiction_niche", penalties: [], signals };
  }

  // 2g-ter. Série ghost — sem redes, popularidade irrisória, sem provider BR — HARD BLOCK
  //
  // Conteúdo que chegou ao banco via ICS mas tem enriquecimento TMDB mínimo ou inexistente:
  // sem genre_ids, sem redes, popularidade < 1. Sem nenhum sinal de relevância.
  //
  // Exemplos que BLOQUEIAM: Home Town: Inn This Together (Scripted, genre_ids=[], sem redes, pop 0.2)
  // Exemplos que PASSAM: qualquer série com genre_ids preenchidos, ou com rede, ou pop > 1
  const isGhostContent =
    !hasBrazilProvider(brProviders) &&
    networks.length === 0 &&
    genreIds.length === 0 &&
    popularity < 1;

  if (isGhostContent) {
    signals.push(
      `hard_block:ghost_no_signal pop:${Math.round(popularity * 100) / 100}` +
      ` genres:[] networks:none`,
    );
    return { eligible: false, reason: "hard_blocked_nonfiction_niche", penalties: [], signals };
  }

  // 2h. Sinal editorial muito baixo
  if (!hasTmdb && !hasBrazilProvider(brProviders) && popularity < 5 && relevScore < 15) {
    penalties.push({ reason: "penalized_low_editorial_signal:no_tmdb", value: -10 });
    signals.push(
      `penalty:-10 low_editorial_signal:no_tmdb pop:${Math.round(popularity)} score:${relevScore}`,
    );
  }

  // ── ELEGÍVEL ───────────────────────────────────────────────────────────────
  const hasAnyPenalty = penalties.length > 0;
  const totalPenalty = hasAnyPenalty ? penalties.reduce((s, p) => s + p.value, 0) : 0;

  if (hasAnyPenalty) {
    signals.push(`eligible:with_penalties total_penalty:${totalPenalty}`);
  } else {
    signals.push("eligible:clean");
  }

  // Determinar reason baseado na maior penalidade aplicada
  let reason: EligibilityReason = "eligible";
  if (penalties.length > 0) {
    const strongest = penalties.reduce((a, b) => (a.value < b.value ? a : b));
    if      (strongest.reason.startsWith("penalized_kids"))            reason = "penalized_kids_generic";
    else if (strongest.reason.startsWith("penalized_religious"))       reason = "penalized_religious_niche";
    else if (strongest.reason.startsWith("penalized_low_brazil"))      reason = "penalized_low_brazil_relevance";
    else if (strongest.reason.startsWith("penalized_low_editorial"))   reason = "penalized_low_editorial_signal";
  }

  return { eligible: true, reason, penalties, signals };
}

// ── Diagnóstico ───────────────────────────────────────────────────────────────

export interface EligibilityDiagnostics {
  total: number;
  eligible: number;
  eligibleWithPenalties: number;
  blocked: number;
  byReason: Record<EligibilityReason, {
    count: number;
    examples: Array<{ title: string; signals: string[]; penaltyTotal?: number }>;
  }>;
}

export function createEligibilityDiagnostics(): EligibilityDiagnostics {
  const reasons: EligibilityReason[] = [
    "eligible",
    "hard_blocked_category", "preschool_kids_explicit", "devotional_explicit",
    "invalid_episode", "duplicate", "no_minimum_data",
    "hard_blocked_asian_serial", "hard_blocked_nonfiction_niche",
    "penalized_kids_generic", "penalized_religious_niche",
    "penalized_low_brazil_relevance", "penalized_low_editorial_signal",
  ];
  return {
    total: 0,
    eligible: 0,
    eligibleWithPenalties: 0,
    blocked: 0,
    byReason: Object.fromEntries(
      reasons.map((r) => [r, {
        count: 0,
        examples: [] as Array<{ title: string; signals: string[]; penaltyTotal?: number }>,
      }]),
    ) as unknown as EligibilityDiagnostics["byReason"],
  };
}

export function accumulateDiagnostics(
  diag: EligibilityDiagnostics,
  result: EligibilityResult,
  title: string,
): void {
  diag.total++;
  if (!result.eligible) {
    diag.blocked++;
  } else {
    diag.eligible++;
    if (result.penalties.length > 0) diag.eligibleWithPenalties++;
  }
  const entry = diag.byReason[result.reason];
  if (entry) {
    entry.count++;
    if (entry.examples.length < 5) {
      const penaltyTotal = result.penalties.reduce((s, p) => s + p.value, 0);
      entry.examples.push({
        title,
        signals: result.signals,
        penaltyTotal: penaltyTotal || undefined,
      });
    }
  }
}

export function logEligibilityDiagnostics(diag: EligibilityDiagnostics): void {
  const lines: string[] = [
    "+- [Radar Eligibility] DIAGNOSTICO -------------------------------------------",
    `|  Total avaliados         : ${diag.total}`,
    `|  Elegiveis (limpos)      : ${diag.eligible - diag.eligibleWithPenalties}`,
    `|  Elegiveis c/ penalidades: ${diag.eligibleWithPenalties}`,
    `|  Bloqueados (hard)       : ${diag.blocked}`,
    `|  Taxa de bloqueio        : ${diag.total > 0 ? ((diag.blocked / diag.total) * 100).toFixed(1) : "0"}` + "%",
    `|`,
  ];

  const allEntries = Object.entries(diag.byReason) as Array<[
    EligibilityReason,
    EligibilityDiagnostics["byReason"][EligibilityReason],
  ]>;

  const hardBlocks = allEntries
    .filter(([r]) => r !== "eligible" && !r.startsWith("penalized_"))
    .filter(([, e]) => e.count > 0)
    .sort(([, a], [, b]) => b.count - a.count);

  const softPenalties = allEntries
    .filter(([r]) => r.startsWith("penalized_"))
    .filter(([, e]) => e.count > 0)
    .sort(([, a], [, b]) => b.count - a.count);

  if (hardBlocks.length > 0) {
    lines.push("|  [HARD BLOCKS]");
    for (const [reason, entry] of hardBlocks) {
      lines.push(`|    ${reason}: ${entry.count}`);
      for (const ex of entry.examples.slice(0, 2)) {
        lines.push(`|      - "${ex.title}"`);
      }
    }
  }

  if (softPenalties.length > 0) {
    lines.push("|  [PENALIDADES SOFT]");
    for (const [reason, entry] of softPenalties) {
      lines.push(`|    ${reason}: ${entry.count}`);
    }
  }

  lines.push("+-----------------------------------------------------------------------------");
  console.log(lines.join("\n"));
}
