/**
 * attach-best-provider.ts — Anexa o badge de disponibilidade (best_provider_*) a listas
 * de itens de QUALQUER superfície (Trending, Para você, Acompanhando, Busca…), via o
 * fluxo canônico `hydrateManyTitleAvailability` (cacheOnly + warmCold).
 *
 * Contrato de saída idêntico ao do card da Watchlist (referência):
 *   best_provider_name, best_provider_type (vocabulário do card), best_provider_logo.
 *
 * Reaproveita cache global quando existe e aquece em background quando falta — sem
 * bloquear a resposta principal e sem ler `catalog_availability` diretamente.
 */

import { hydrateManyTitleAvailability } from "./availability-service";
import type { TitleAvailabilitySummary } from "./availability-types";

export type BestProviderBadgeFields = {
  best_provider_name: string | null;
  /** Vocabulário do card: subscription | rent | buy | free | ads. */
  best_provider_type: string | null;
  best_provider_logo: string | null;
};

/** Tipo canônico ("streaming") → vocabulário do card ("subscription"). */
function toCardProviderType(type: string | null | undefined): string | null {
  if (!type) return null;
  if (type === "streaming" || type === "flatrate") return "subscription";
  return type;
}

export async function attachBestProvider<T extends object>(
  items: T[],
  opts: {
    /** Rótulo do bloco para os logs de debug. */
    block: string;
    getMediaType: (item: T) => "movie" | "tv";
    getTmdbId: (item: T) => number | null | undefined;
    getImdbId?: (item: T) => string | null | undefined;
    region?: string;
    /**
     * Modo LIVE (cache-first): além de reusar o cache, faz fetch dos títulos que faltam
     * (Balloonerismm + fallback JustWatch) e persiste — assim o badge aparece já no
     * PRIMEIRO load. Recomendado para rails pequenos/curados (Para você, Trending), NÃO
     * para a biblioteca inteira. Quando false (padrão), usa cacheOnly + warm em background.
     */
    live?: boolean;
    /** Limite de concorrência do fetch (default 6 no modo live). */
    concurrency?: number;
  },
): Promise<Array<T & BestProviderBadgeFields>> {
  if (items.length === 0) return items as Array<T & BestProviderBadgeFields>;

  const region = opts.region ?? "BR";
  const inputs = items.map((item, index) => ({
    key: index,
    input: {
      mediaType: opts.getMediaType(item),
      tmdbId: opts.getTmdbId(item) ?? null,
      imdbId: opts.getImdbId?.(item) ?? null,
      region,
    },
  }));

  const withImdb = inputs.filter((x) => x.input.imdbId).length;
  const sent = inputs.filter((x) => x.input.imdbId || x.input.tmdbId).length;
  const cacheOnly = !opts.live;

  let map: Map<number, TitleAvailabilitySummary>;
  try {
    map = await hydrateManyTitleAvailability(inputs, {
      cacheOnly,
      // cacheOnly → aquece em background; live → já busca os faltantes agora (cache-first).
      warmCold: cacheOnly,
      concurrency: opts.live ? opts.concurrency ?? 6 : undefined,
    });
  } catch (err) {
    console.warn(`[availability:attach] block=${opts.block} hydrate falhou:`, err);
    return items.map((item) => ({
      ...item,
      best_provider_name: null,
      best_provider_type: null,
      best_provider_logo: null,
    }));
  }

  let withBestProvider = 0;
  let renderableBadge = 0;

  const out = items.map((item, index) => {
    const best = map.get(index)?.bestProvider ?? null;
    if (best) withBestProvider++;
    const name = best?.name ?? null;
    if (name) renderableBadge++;
    return {
      ...item,
      best_provider_name: name,
      best_provider_type: toCardProviderType(best?.type ?? null),
      best_provider_logo: best?.logoUrl ?? null,
    };
  });

  // Debug por bloco (critério de aceite): total, com imdb, enviados, com provider, badge.
  console.log(
    `[availability:attach] block=${opts.block} live=${Boolean(opts.live)} total=${items.length} ` +
      `withImdb=${withImdb} sentToHydrate=${sent} withBestProvider=${withBestProvider} renderableBadge=${renderableBadge}`,
  );

  return out;
}
