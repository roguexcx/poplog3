/**
 * Fallback de dados financeiros via infobox da Wikipedia (PT primeiro, EN depois).
 *
 * Usado quando a Wikidata não tem orçamento (P2130) ou bilheteria (P2142). Lê o
 * wikitext da página, extrai os campos da infobox e normaliza os valores
 * monetários para número.
 *
 * Campos reconhecidos:
 *   - orçamento: orçamento / orcamento / budget
 *   - bilheteria/receita: bilheteria / receita / arrecadação / arrecadacao /
 *     box office / gross / worldwide gross
 */

const WIKI_ENDPOINTS: Record<"pt" | "en", string> = {
  pt: "https://pt.wikipedia.org/w/api.php",
  en: "https://en.wikipedia.org/w/api.php",
};

const USER_AGENT =
  "POPLOG/1.0 (https://poplog.app; budget/revenue enrichment) node-fetch";

const BUDGET_KEYS = ["orçamento", "orcamento", "budget"];
const REVENUE_KEYS = [
  "bilheteria",
  "receita",
  "arrecadação",
  "arrecadacao",
  "box[ _]office",
  "worldwide[ _]gross",
  "gross",
];

export type WikipediaFinancials = {
  budget: number | null;
  revenue: number | null;
};

// ─── Money parser ─────────────────────────────────────────────────────────────

const SCALE_PATTERNS: Array<{ re: RegExp; factor: number }> = [
  { re: /^(trilh|trillion|tri\b|tri$)/i, factor: 1e12 },
  { re: /^(bilh|billion|bi\b|bi$)/i, factor: 1e9 },
  { re: /^(milh|million|mi\b|mi$)/i, factor: 1e6 },
  { re: /^(mil|thousand)/i, factor: 1e3 },
];

function scaleFactor(token: string | undefined): number {
  if (!token) return 1;
  for (const { re, factor } of SCALE_PATTERNS) {
    if (re.test(token)) return factor;
  }
  return 1;
}

/**
 * Converte o token numérico em número.
 * - Com escala (milhões/bilhões): um único separador é tratado como DECIMAL
 *   ("1,005 bilhão" = 1.005, "1.005 billion" = 1.005).
 * - Sem escala: separadores são de milhar e são removidos ("2.798.000.000").
 */
function parseNumberToken(token: string, hasScale: boolean): number | null {
  const hasComma = token.includes(",");
  const hasDot = token.includes(".");

  if (hasScale) {
    if (hasComma && hasDot) {
      const lastSep = Math.max(token.lastIndexOf(","), token.lastIndexOf("."));
      const intPart = token.slice(0, lastSep).replace(/[.,]/g, "");
      const frac = token.slice(lastSep + 1).replace(/[.,]/g, "");
      const n = Number(`${intPart}.${frac}`);
      return Number.isFinite(n) ? n : null;
    }
    // Um único tipo de separador → decimal.
    const normalized = token.replace(/[.,]/g, ".");
    const firstDot = normalized.indexOf(".");
    const cleaned =
      firstDot === -1
        ? normalized
        : normalized.slice(0, firstDot + 1) +
          normalized.slice(firstDot + 1).replace(/\./g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  const digits = token.replace(/[.,]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

/** Limpa markup de wikitext (refs, templates, links, html) antes de extrair números. */
function stripWikitext(raw: string): string {
  let s = raw;
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, " ");
  s = s.replace(/<ref[^>]*\/>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Desembrulha templates {{US$|185 million}} → "US$ 185 million" (até 3 níveis).
  for (let i = 0; i < 3; i += 1) {
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_m, inner: string) =>
      ` ${inner.split("|").join(" ")} `,
    );
  }
  // [[link|texto]] → "texto"
  s = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/gi, " ");
  return s;
}

const SANITY_MIN = 10_000;
const SANITY_MAX = 1e12;

/**
 * Extrai o maior valor monetário plausível de um trecho de texto.
 * Aceita "US$ 185 milhões", "$1.005 billion", "2.798.000.000", "$2,798,000,000".
 */
export function parseMoneyToNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = stripWikitext(raw);

  const re =
    /(?:US\$|R\$|\$|€|£|USD)?\s*(\d[\d.,]*)\s*(trilh\w*|trillion|bilh\w*|billion|milh\w*|million|mil\b|thousand|\bbi\b|\bmi\b)?/gi;

  let best: number | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const numToken = match[1];
    const scaleToken = match[2];
    if (!numToken) continue;
    const factor = scaleFactor(scaleToken);
    const base = parseNumberToken(numToken, factor > 1);
    if (base === null) continue;
    // Arredonda para inteiro: 1.005 * 1e9 em float vira 1004999999.9999.
    const value = Math.round(base * factor);
    if (value < SANITY_MIN || value > SANITY_MAX) continue;
    if (best === null || value > best) best = value;
  }

  return best;
}

// ─── Infobox extraction ─────────────────────────────────────────────────────────

/** Extrai o valor cru de um parâmetro de infobox (`| chave = valor`). */
function extractInfoboxField(wikitext: string, keys: string[]): string | null {
  for (const key of keys) {
    // Captura tudo após "= " até a próxima linha que começa com "|" ou "}}".
    const re = new RegExp(
      `\\|\\s*${key}\\s*=\\s*([^\\n]*(?:\\n(?!\\s*[|}])[^\\n]*)*)`,
      "i",
    );
    const m = wikitext.match(re);
    if (m && m[1] && m[1].trim()) return m[1].trim();
  }
  return null;
}

async function fetchWikitext(
  lang: "pt" | "en",
  title: string,
): Promise<string | null> {
  const url =
    `${WIKI_ENDPOINTS[lang]}?action=parse&page=${encodeURIComponent(title)}` +
    `&prop=wikitext&redirects=1&format=json&origin=*`;

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: 60 * 60 * 24 * 30 },
  });

  if (!response.ok) return null;

  const data = (await response.json()) as {
    parse?: { wikitext?: { "*"?: string } };
  };
  return data.parse?.wikitext?.["*"] ?? null;
}

function financialsFromWikitext(wikitext: string): WikipediaFinancials {
  return {
    budget: parseMoneyToNumber(extractInfoboxField(wikitext, BUDGET_KEYS)),
    revenue: parseMoneyToNumber(extractInfoboxField(wikitext, REVENUE_KEYS)),
  };
}

/**
 * Lê a infobox da Wikipedia (PT antes de EN) e extrai orçamento + bilheteria.
 * Combina as duas línguas: um campo presente em uma cobre a ausência na outra.
 */
export async function fetchWikipediaInfoboxFinancials(sitelinks: {
  ptwiki?: string;
  enwiki?: string;
}): Promise<WikipediaFinancials> {
  let budget: number | null = null;
  let revenue: number | null = null;

  const sources: Array<["pt" | "en", string | undefined]> = [
    ["pt", sitelinks.ptwiki],
    ["en", sitelinks.enwiki],
  ];

  for (const [lang, title] of sources) {
    if (!title) continue;
    if (budget && revenue) break;
    const wikitext = await fetchWikitext(lang, title).catch(() => null);
    if (!wikitext) continue;
    const parsed = financialsFromWikitext(wikitext);
    if (!budget && parsed.budget) budget = parsed.budget;
    if (!revenue && parsed.revenue) revenue = parsed.revenue;
  }

  return { budget, revenue };
}
