/**
 * justwatch-graphql-unofficial-source.ts
 *
 * Fonte JustWatch via GraphQL não oficial. No POPLOG V2 ela é a fonte protagonista
 * de disponibilidade (assinatura, canais, aluguel e compra), isolada neste arquivo
 * para ser trocada por Partner API/licenciada sem alterar o modelo interno.
 *
 * Origem técnica: HTML de teste validado manualmente (endpoint apis.justwatch.com/graphql,
 * query `GetSearchTitles`, fragments `PackageDetails`/`TitleOffer`/`TitleDetails`). Aqui
 * extraímos somente a lógica interna necessária e a adaptamos ao contrato interno de
 * availability do POPLOG (`TitleProvider`).
 *
 * Garantias / isolamento:
 *   - Lookup primário ativado por padrão em local/dev e desligável com
 *     `JUSTWATCH_PRIMARY=false`.
 *   - Timeout curto (AbortController) — nunca trava o caminho da resposta.
 *   - Cache forte em processo (TTL + teto), com deduplicação por título/ID/região.
 *   - Baixo volume: só roda no caminho ao vivo, nunca em massa em listas/cards.
 *   - Nunca lança — falha vira outcome "error".
 *   - Preserva payload bruto (`raw`) e o node casado (`matched`) para debug.
 *   - Substituível: trocar por fonte licenciada/Partner API mexe só neste arquivo.
 */

import type { TitleProvider, TitleProviderType } from "@/features/title/types";

const GRAPHQL_ENDPOINT = "https://apis.justwatch.com/graphql";
const IMAGES_URL = "https://images.justwatch.com";
const JW_URL = "https://www.justwatch.com";

const DEFAULT_TIMEOUT_MS = 4500;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — disponibilidade muda raramente
const CACHE_MAX_ENTRIES = 500;
const SEARCH_FIRST = 10;

export type JustWatchOutcome = "ok" | "empty" | "error" | "disabled";

export type JustWatchMatch = {
  nodeId: string | null;
  objectType: string | null;
  title: string | null;
  year: number | null;
  imdbId: string | null;
  tmdbId: number | null;
  justwatchUrl: string | null;
  /** Como o node foi casado: por id externo (forte) ou por título/ano (fraco). */
  matchedVia: "imdb" | "tmdb" | "title" | null;
};

export type JustWatchResult = {
  outcome: JustWatchOutcome;
  providers: TitleProvider[];
  region: string;
  matched: JustWatchMatch | null;
  /** Nº de offers brutas no node casado (antes do parse/dedup). null se não casou. */
  offersCount: number | null;
  /** Motivo legível quando não há providers (debug). null quando outcome "ok". */
  emptyReason: string | null;
  /** Payload bruto preservado para debug (node casado + contagem de edges). */
  raw: unknown;
};

export type JustWatchLookupInput = {
  title?: string | null;
  year?: number | null;
  imdbId?: string | null;
  tmdbId?: number | null;
  mediaType: "movie" | "tv";
  region?: string;
  language?: string;
  timeoutMs?: number;
};

function envFlag(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/** Flag/env de ativação do lookup primário de providers via JustWatch. */
export function isJustWatchPrimaryEnabled(): boolean {
  const raw = process.env.JUSTWATCH_PRIMARY;
  if (raw === undefined) return true;
  return envFlag(raw);
}

/** Flag/env de ativação do fallback legado — mantida para compatibilidade. */
export function isJustWatchUnofficialEnabled(): boolean {
  return envFlag(process.env.JUSTWATCH_UNOFFICIAL_FALLBACK);
}

/**
 * Flag/env do ENRIQUECIMENTO de canais (Amazon/Apple TV Channels).
 *
 * Diferente do fallback: o enriquecimento roda quando o Balloonerismm RETORNOU
 * providers, mas de forma genérica (ex.: "Prime Video" sem distinguir que o título
 * está dentro do canal "Diamond Films"). Aí o JustWatch — que lista cada canal como
 * pacote próprio — é consultado para quebrar o host genérico em canais reais.
 * Só roda no caminho ao vivo (nunca em listas/cards cacheOnly). Ativa por padrão,
 * mas pode ser desligada explicitamente com false/0/off/no.
 */
export function isJustWatchChannelEnrichmentEnabled(): boolean {
  const raw = process.env.JUSTWATCH_CHANNEL_ENRICHMENT;
  if (raw === undefined) return true;
  return envFlag(raw);
}

function isJustWatchLookupEnabled(): boolean {
  return isJustWatchPrimaryEnabled() || isJustWatchUnofficialEnabled() || isJustWatchChannelEnrichmentEnabled();
}

// ─── GraphQL: query + fragments (extraídos do HTML de referência) ──────────────

const PACKAGE_FRAGMENT = `
fragment PackageDetails on Package {
  id
  packageId
  clearName
  technicalName
  shortName
  slug
  monetizationTypes
  icon(profile: S100, format: $formatOfferIcon)
}`;

const OFFER_FRAGMENT = `
fragment TitleOffer on Offer {
  id
  monetizationType
  presentationType
  retailPrice(language: $language)
  retailPriceValue
  currency
  type
  standardWebURL
  availableTo
  package { ...PackageDetails }
}`;

const TITLE_DETAILS_FRAGMENT = `
fragment TitleDetails on MovieOrShowOrSeasonOrEpisode {
  id
  objectId
  objectType
  content(country: $country, language: $language) {
    title
    originalReleaseYear
    originalReleaseDate
    runtime
    shortDescription
    ... on MovieOrShowContent {
      fullPath
      ageCertification
      posterUrl(profile: $profile, format: $formatPoster)
      genres { shortName technicalName }
      externalIds { imdbId tmdbId }
      scoring { imdbScore imdbVotes tmdbPopularity tmdbScore jwRating }
    }
  }
  offers(country: $country, platform: WEB, filter: $filter) { ...TitleOffer }
}`;

const SEARCH_QUERY = `
query GetSearchTitles(
  $searchTitlesFilter: TitleFilter!,
  $country: Country!,
  $language: Language!,
  $first: Int!,
  $formatPoster: ImageFormat,
  $formatOfferIcon: ImageFormat,
  $profile: PosterProfile,
  $filter: OfferFilter!,
  $offset: Int = 0
) {
  popularTitles(
    country: $country,
    filter: $searchTitlesFilter,
    first: $first,
    sortBy: POPULAR,
    sortRandomSeed: 0,
    offset: $offset
  ) {
    edges { cursor node { ...TitleDetails } }
    pageInfo { hasNextPage endCursor }
  }
}
${TITLE_DETAILS_FRAGMENT}
${OFFER_FRAGMENT}
${PACKAGE_FRAGMENT}`;

// ─── Helpers de URL/imagem (espelham o HTML de referência) ─────────────────────

function safeImage(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return IMAGES_URL + path;
}

function safeUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return JW_URL + path;
}

/** monetizationType (JustWatch) → tipo do contrato interno. CINEMA/desconhecido → null. */
function mapMonetization(type: string | null | undefined): TitleProviderType | null {
  switch ((type ?? "").toUpperCase()) {
    case "FLATRATE":
    case "FLATRATE_AND_BUY":
      return "streaming";
    case "RENT":
      return "rent";
    case "BUY":
      return "buy";
    case "ADS":
      return "ads";
    case "FREE":
      return "free";
    // CINEMA e quaisquer outros não têm representação no contrato de providers
    // (o status "theatrical" é derivado de release dates na camada canônica).
    default:
      return null;
  }
}

export function mapJustWatchMonetizationForProvider(type: string | null | undefined): TitleProviderType | null {
  return mapMonetization(type);
}

// ─── Cache em processo (forte, com TTL e teto) ─────────────────────────────────

type CacheEntry = { value: JustWatchResult; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function cacheKey(input: JustWatchLookupInput, region: string): string {
  const id = input.imdbId ?? (input.tmdbId != null ? `tmdb:${input.tmdbId}` : null);
  const idKey = id ?? `title:${(input.title ?? "").trim().toLowerCase()}`;
  return `${region}:${input.mediaType}:${idKey}`;
}

function getCached(key: string): JustWatchResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(key: string, value: JustWatchResult): void {
  // Não cacheia erro: a falha pode ser transitória (timeout/CORS/schema).
  if (value.outcome === "error") return;
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── Seleção do melhor node ────────────────────────────────────────────────────

type Edge = { node?: JwNode };
type JwNode = {
  id?: string;
  objectId?: number | string;
  objectType?: string;
  content?: {
    title?: string;
    originalReleaseYear?: number | null;
    fullPath?: string | null;
    posterUrl?: string | null;
    externalIds?: { imdbId?: string | null; tmdbId?: number | string | null };
  };
  offers?: JwOffer[];
};
type JwOffer = {
  monetizationType?: string | null;
  presentationType?: string | null;
  retailPriceValue?: number | null;
  retailPrice?: string | null;
  currency?: string | null;
  standardWebURL?: string | null;
  package?: {
    id?: string;
    packageId?: number | string;
    clearName?: string | null;
    shortName?: string | null;
    technicalName?: string | null;
    slug?: string | null;
    icon?: string | null;
  };
};

function objectTypeFor(mediaType: "movie" | "tv"): "MOVIE" | "SHOW" {
  return mediaType === "movie" ? "MOVIE" : "SHOW";
}

function normalizeTitleStr(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Casa o node correto entre os edges retornados pela busca:
 *   1. por imdbId exato (forte)
 *   2. por tmdbId exato (forte)
 *   3. por título + objectType compatível, com proximidade de ano (fraco)
 * Retorna null se nenhum candidato confiável — evita anexar providers do título errado.
 */
function pickMatchingNode(
  edges: Edge[],
  input: JustWatchLookupInput,
): { node: JwNode; via: JustWatchMatch["matchedVia"] } | null {
  const wantType = objectTypeFor(input.mediaType);
  const nodes = edges.map((e) => e.node).filter((n): n is JwNode => Boolean(n));

  if (input.imdbId) {
    const byImdb = nodes.find(
      (n) => n.content?.externalIds?.imdbId && n.content.externalIds.imdbId === input.imdbId,
    );
    if (byImdb) return { node: byImdb, via: "imdb" };
  }

  if (input.tmdbId != null) {
    const byTmdb = nodes.find(
      (n) =>
        n.content?.externalIds?.tmdbId != null &&
        String(n.content.externalIds.tmdbId) === String(input.tmdbId),
    );
    if (byTmdb) return { node: byTmdb, via: "tmdb" };
  }

  // Fraco: só aceita com título idêntico E objectType compatível.
  const wantTitle = normalizeTitleStr(input.title);
  if (wantTitle) {
    const candidates = nodes.filter(
      (n) => n.objectType === wantType && normalizeTitleStr(n.content?.title) === wantTitle,
    );
    if (candidates.length > 0) {
      // Desempata por proximidade de ano, quando informado.
      if (input.year != null) {
        candidates.sort(
          (a, b) =>
            Math.abs((a.content?.originalReleaseYear ?? 0) - input.year!) -
            Math.abs((b.content?.originalReleaseYear ?? 0) - input.year!),
        );
      }
      return { node: candidates[0], via: "title" };
    }
  }

  return null;
}

// ─── Parser de offers → TitleProvider[] ────────────────────────────────────────

function offersToProviders(node: JwNode, region: string): TitleProvider[] {
  const offers = node.offers ?? [];
  const seen = new Set<string>();
  const providers: TitleProvider[] = [];

  for (const offer of offers) {
    const type = mapMonetization(offer.monetizationType);
    if (!type) continue; // descarta CINEMA/desconhecido (fora do contrato)
    const pkg = offer.package ?? {};
    const name =
      pkg.clearName?.trim() || pkg.shortName?.trim() || pkg.technicalName?.trim() || null;
    if (!name) continue;

    // Dedup por nome+tipo (uma oferta por provider/tipo basta para o card).
    const dedupeKey = `${type}:${name.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    providers.push({
      name,
      logoUrl: safeImage(pkg.icon),
      type,
      providerId: pkg.packageId ?? pkg.id ?? null,
      deepLink: safeUrl(offer.standardWebURL),
      quality: offer.presentationType ?? null,
      source: "justwatch_graphql_unofficial",
      country: region,
    });
  }

  return providers;
}

// ─── Fetch GraphQL com timeout ─────────────────────────────────────────────────

async function graphQL(
  variables: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ operationName: "GetSearchTitles", query: SEARCH_QUERY, variables }),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: { data?: unknown; errors?: unknown };
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`non-json response (${res.status})`);
    }
    if (!res.ok || json.errors) {
      throw new Error(`graphql error (${res.status})`);
    }
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

function buildVariables(input: JustWatchLookupInput, region: string) {
  const language = input.language ?? "pt";
  const searchQuery =
    (input.title ?? "").trim() ||
    input.imdbId?.trim() ||
    (input.tmdbId != null ? String(input.tmdbId) : "");
  return {
    searchTitlesFilter: {
      searchQuery,
      includeTitlesWithoutUrl: true,
      objectTypes: [objectTypeFor(input.mediaType)],
    },
    country: region.toUpperCase(),
    language,
    first: SEARCH_FIRST,
    offset: 0,
    formatPoster: "JPG",
    formatOfferIcon: "PNG",
    profile: "S718",
    filter: { bestOnly: true },
  };
}

// ─── API pública ───────────────────────────────────────────────────────────────

/**
 * Consulta a JustWatch (não oficial) e retorna providers normalizados ao contrato
 * interno. Prefere título textual, mas também tenta IMDb/TMDB como query quando
 * o título local ainda não existe; o match final continua validado por external IDs.
 * Nunca lança.
 */
export async function getJustWatchUnofficialProviders(
  input: JustWatchLookupInput,
): Promise<JustWatchResult> {
  const region = (input.region ?? "BR").toUpperCase();

  if (!isJustWatchLookupEnabled()) {
    return {
      outcome: "disabled", providers: [], region, matched: null,
      offersCount: null, emptyReason: "disabled", raw: null,
    };
  }

  const title = (input.title ?? "").trim();
  const query = title || input.imdbId?.trim() || (input.tmdbId != null ? String(input.tmdbId) : "");
  if (!query) {
    console.warn("[justwatch-unofficial] sem título/id para busca — pulando", {
      imdbId: input.imdbId ?? null,
      tmdbId: input.tmdbId ?? null,
      region,
    });
    return {
      outcome: "empty", providers: [], region, matched: null,
      offersCount: null, emptyReason: "missing_title", raw: null,
    };
  }

  const key = cacheKey(input, region);
  const cached = getCached(key);
  if (cached) {
    console.log(`[justwatch-unofficial] cache-hit "${query}" region=${region} outcome=${cached.outcome}`);
    return cached;
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const data = (await graphQL(buildVariables(input, region), timeoutMs)) as {
      popularTitles?: { edges?: Edge[] };
    } | null;

    const edges = data?.popularTitles?.edges ?? [];
    const picked = pickMatchingNode(edges, input);

    if (!picked) {
      const result: JustWatchResult = {
        outcome: "empty",
        providers: [],
        region,
        matched: null,
        offersCount: null,
        emptyReason: edges.length === 0 ? "no_search_results" : "no_confident_match",
        raw: { edgeCount: edges.length },
      };
      console.log(
        `[justwatch-unofficial] no-match "${query}" region=${region} edges=${edges.length} imdb=${input.imdbId ?? "-"} tmdb=${input.tmdbId ?? "-"}`,
      );
      setCached(key, result);
      return result;
    }

    const { node, via } = picked;
    const providers = offersToProviders(node, region);
    const offersCount = node.offers?.length ?? 0;
    const matched: JustWatchMatch = {
      nodeId: node.id ?? null,
      objectType: node.objectType ?? null,
      title: node.content?.title ?? null,
      year: node.content?.originalReleaseYear ?? null,
      imdbId: node.content?.externalIds?.imdbId ?? null,
      tmdbId:
        node.content?.externalIds?.tmdbId != null
          ? Number(node.content.externalIds.tmdbId)
          : null,
      justwatchUrl: safeUrl(node.content?.fullPath),
      matchedVia: via,
    };

    const result: JustWatchResult = {
      outcome: providers.length > 0 ? "ok" : "empty",
      providers,
      region,
      matched,
      offersCount,
      emptyReason: providers.length > 0 ? null : "matched_no_supported_offers",
      raw: { node, edgeCount: edges.length },
    };

    console.log(
      `[justwatch-unofficial] ${result.outcome} "${query}" region=${region} via=${via} providers=${providers.length}`,
    );
    setCached(key, result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[justwatch-unofficial] error "${query}" region=${region}: ${message}`);
    return {
      outcome: "error", providers: [], region, matched: null,
      offersCount: null, emptyReason: `error:${message}`, raw: { error: message },
    };
  }
}
