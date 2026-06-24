/**
 * Wikidata como fonte primária de dados financeiros (orçamento / bilheteria).
 *
 * Lookup por IMDb ID (P345) → entidade Q…, lendo:
 *   - P2130 = production cost   → orçamento (budget)
 *   - P2142 = box office        → bilheteria (revenue)
 *
 * Os valores `wdt:` já vêm "achatados" (sem qualificadores/unidade). A grande
 * maioria dos títulos do catálogo é denominada em USD; valores em outras moedas
 * são uma aproximação best-effort e ficam cobertos pelo fallback da Wikipedia e
 * pelos dados já existentes da fonte primária.
 */

const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

// A Wikidata exige um User-Agent identificável (rejeita requests anônimos).
const USER_AGENT =
  "POPLOG/1.0 (https://poplog.app; budget/revenue enrichment) node-fetch";

export type WikidataSparqlCell = {
  type?: string;
  value?: string;
  datatype?: string;
  "xml:lang"?: string;
};

export type WikidataSparqlResponse<
  TBinding extends Record<string, WikidataSparqlCell | undefined>,
> = {
  results?: {
    bindings?: TBinding[];
  };
};

export type WikidataSitelinks = {
  ptwiki?: string;
  enwiki?: string;
};

export type WikidataFinancials = {
  entityId: string | null;
  budget: number | null;
  revenue: number | null;
};

function isImdbId(value: string): boolean {
  return /^tt\d+$/.test(value);
}

function numberFromSparql(cell: { value?: string } | undefined): number | null {
  if (!cell?.value) return null;
  const n = Number(cell.value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function entityIdFromUri(uri: string | undefined): string | null {
  if (!uri) return null;
  const match = uri.match(/\/(Q\d+)$/);
  return match ? match[1] : null;
}

export async function fetchWikidataSparql<
  TBinding extends Record<string, WikidataSparqlCell | undefined>,
>(
  query: string,
  options: {
    revalidateSeconds?: number;
    timeoutMs?: number;
  } = {},
): Promise<WikidataSparqlResponse<TBinding>> {
  const url = `${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(query)}`;
  const timeoutMs = options.timeoutMs ?? 7_000;

  const response = await fetch(url, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
    next: { revalidate: options.revalidateSeconds ?? 60 * 60 * 24 * 30 },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Wikidata SPARQL failed: ${response.status}`);
  }

  return response.json() as Promise<WikidataSparqlResponse<TBinding>>;
}

/**
 * Busca orçamento e bilheteria na Wikidata a partir do IMDb ID.
 * Retorna também o entityId (wikibase_item) para o fallback da Wikipedia.
 */
export async function fetchWikidataFinancials(
  imdbId: string,
): Promise<WikidataFinancials | null> {
  const trimmed = imdbId.trim();
  if (!isImdbId(trimmed)) return null;

  // GROUP BY + MAX evita o produto cartesiano dos dois OPTIONAL e escolhe o maior
  // valor de bilheteria (mundial > doméstica) quando há múltiplas declarações.
  const query = `SELECT ?item (MAX(?budgetRaw) AS ?budget) (MAX(?boxRaw) AS ?box) WHERE {
  ?item wdt:P345 "${trimmed}".
  OPTIONAL { ?item wdt:P2130 ?budgetRaw. }
  OPTIONAL { ?item wdt:P2142 ?boxRaw. }
} GROUP BY ?item LIMIT 1`;

  const url = `${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
    next: { revalidate: 60 * 60 * 24 * 30 },
  });

  if (!response.ok) {
    throw new Error(`Wikidata SPARQL failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    results?: {
      bindings?: Array<{
        item?: { value?: string };
        budget?: { value?: string };
        box?: { value?: string };
      }>;
    };
  };

  const row = data.results?.bindings?.[0];
  if (!row) return { entityId: null, budget: null, revenue: null };

  return {
    entityId: entityIdFromUri(row.item?.value),
    budget: numberFromSparql(row.budget),
    revenue: numberFromSparql(row.box),
  };
}

/**
 * Resolve os títulos das páginas PT/EN da Wikipedia ligadas à entidade Wikidata.
 * Usado pelo fallback de infobox quando faltam orçamento ou bilheteria.
 */
export async function fetchWikidataSitelinks(
  entityId: string,
): Promise<WikidataSitelinks> {
  if (!/^Q\d+$/.test(entityId)) return {};

  const url =
    `${WIKIDATA_API}?action=wbgetentities&ids=${entityId}` +
    `&props=sitelinks&sitefilter=ptwiki|enwiki&format=json&origin=*`;

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: 60 * 60 * 24 * 30 },
  });

  if (!response.ok) {
    throw new Error(`Wikidata wbgetentities failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    entities?: Record<
      string,
      { sitelinks?: Record<string, { title?: string }> }
    >;
  };

  const sitelinks = data.entities?.[entityId]?.sitelinks ?? {};
  return {
    ptwiki: sitelinks.ptwiki?.title,
    enwiki: sitelinks.enwiki?.title,
  };
}
