/**
 * Orquestrador de dados financeiros (orçamento / bilheteria) por título.
 *
 * Ordem de resolução:
 *   1. Valores já presentes na fonte primária (Balloonerismm) — se ambos existem,
 *      não há fetch externo.
 *   2. Cache local (poplog_title_financials_cache), indexado por imdbId.
 *   3. Wikidata (P2130 orçamento / P2142 bilheteria) via IMDb ID.
 *   4. Fallback: infobox da Wikipedia PT/EN, resolvida pelo wikibase_item.
 *
 * O resultado é normalizado para número, persistido por imdbId/poplogId e usado
 * para preencher `metadata.budget` / `metadata.revenue`, que dispara o
 * TitleFinancialBadge.
 */

import { db } from "@/server/db/client";
import {
  fetchWikidataFinancials,
  fetchWikidataSitelinks,
  type WikidataSitelinks,
} from "@/server/api-clients/wikidata/client";
import { fetchWikipediaInfoboxFinancials } from "@/server/api-clients/wikipedia/client";

export type TitleFinancials = {
  budget: number | null;
  revenue: number | null;
};

type GetMovieFinancialsArgs = {
  imdbId: string;
  poplogId?: string | null;
  /** Orçamento já conhecido pela fonte primária (evita fetch quando completo). */
  existingBudget?: number | null;
  /** Bilheteria já conhecida pela fonte primária. */
  existingRevenue?: number | null;
};

// Dados financeiros mudam pouco; cache longo para títulos com dados, curto para
// negativos (permite re-tentar títulos sem dados após algumas semanas).
const TTL_FOUND_MS = 1000 * 60 * 60 * 24 * 90; // 90 dias
const TTL_EMPTY_MS = 1000 * 60 * 60 * 24 * 14; // 14 dias

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function numberFromBigInt(value: bigint | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function bigIntFrom(value: number | null): bigint | null {
  return value != null ? BigInt(Math.round(value)) : null;
}

function isImdbId(value: string): boolean {
  return /^tt\d+$/.test(value);
}

async function resolveFromSources(
  imdbId: string,
  existingBudget: number | null,
  existingRevenue: number | null,
): Promise<{ budget: number | null; revenue: number | null; entityId: string | null }> {
  let budget = existingBudget;
  let revenue = existingRevenue;
  let entityId: string | null = null;

  // 1. Wikidata (fonte primária do enrichment)
  const wikidata = await fetchWikidataFinancials(imdbId).catch((err) => {
    console.warn("[title-financials] Wikidata erro:", (err as Error)?.message);
    return null;
  });
  if (wikidata) {
    entityId = wikidata.entityId;
    if (!budget) budget = positive(wikidata.budget);
    if (!revenue) revenue = positive(wikidata.revenue);
  }

  // 2. Fallback Wikipedia (infobox) — só se faltar orçamento ou bilheteria e
  //    tivermos o wikibase_item para localizar a página.
  if ((!budget || !revenue) && entityId) {
    const sitelinks = await fetchWikidataSitelinks(entityId).catch(
      (): WikidataSitelinks => ({}),
    );
    if (sitelinks.ptwiki || sitelinks.enwiki) {
      const wiki = await fetchWikipediaInfoboxFinancials(sitelinks).catch((err) => {
        console.warn("[title-financials] Wikipedia erro:", (err as Error)?.message);
        return null;
      });
      if (wiki) {
        if (!budget) budget = positive(wiki.budget);
        if (!revenue) revenue = positive(wiki.revenue);
      }
    }
  }

  return { budget, revenue, entityId };
}

/**
 * Resolve orçamento + bilheteria de um filme, combinando dados existentes,
 * cache e fontes externas (Wikidata → Wikipedia). Retorna null apenas para
 * entradas inválidas; caso contrário retorna os melhores valores disponíveis.
 */
export async function getMovieFinancials(
  args: GetMovieFinancialsArgs,
): Promise<TitleFinancials> {
  const existingBudget = positive(args.existingBudget);
  const existingRevenue = positive(args.existingRevenue);

  // Já completo pela fonte primária → nada a fazer.
  if (existingBudget && existingRevenue) {
    return { budget: existingBudget, revenue: existingRevenue };
  }

  const imdbId = args.imdbId?.trim();
  if (!imdbId || !isImdbId(imdbId)) {
    return { budget: existingBudget, revenue: existingRevenue };
  }

  // 1. Cache fresco
  const cached = await db.poplogTitleFinancialsCache
    .findUnique({ where: { imdbId } })
    .catch(() => null);

  const isFresh =
    cached?.expiresAt != null && cached.expiresAt.getTime() > Date.now();

  if (isFresh) {
    return {
      budget: existingBudget ?? numberFromBigInt(cached!.budget),
      revenue: existingRevenue ?? numberFromBigInt(cached!.revenue),
    };
  }

  // 2. Resolver das fontes externas
  try {
    const resolved = await resolveFromSources(imdbId, existingBudget, existingRevenue);
    const found = Boolean(resolved.budget || resolved.revenue);
    const ttl = found ? TTL_FOUND_MS : TTL_EMPTY_MS;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl);

    const data = {
      poplogId: args.poplogId ?? null,
      budget: bigIntFrom(resolved.budget),
      revenue: bigIntFrom(resolved.revenue),
      wikidataId: resolved.entityId,
      lastFetchedAt: now,
      staleAt: expiresAt,
      expiresAt,
    };

    await db.poplogTitleFinancialsCache
      .upsert({
        where: { imdbId },
        create: { imdbId, ...data },
        update: data,
      })
      .catch((err) => {
        console.warn("[title-financials] cache upsert erro:", (err as Error)?.message);
      });

    return { budget: resolved.budget, revenue: resolved.revenue };
  } catch (err) {
    console.warn("[title-financials] erro:", (err as Error)?.message);
    // Stale-serve: melhor um cache vencido do que nada.
    if (cached) {
      return {
        budget: existingBudget ?? numberFromBigInt(cached.budget),
        revenue: existingRevenue ?? numberFromBigInt(cached.revenue),
      };
    }
    return { budget: existingBudget, revenue: existingRevenue };
  }
}
