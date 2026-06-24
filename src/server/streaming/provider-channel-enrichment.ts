/**
 * provider-channel-enrichment.ts
 *
 * Mescla os pacotes de CANAL do JustWatch (Amazon Channels / Apple TV Channels)
 * sobre os providers genéricos da fonte primária (Balloonerismm).
 *
 * Problema que resolve
 * ────────────────────
 * A fonte primária entrega disponibilidade no formato TMDB/JustWatch agregado, no qual
 * um título disponível por um CANAL ("O Lobo de Wall Street" via "Diamond Films Amazon
 * Channel", incluído no canal) chega rotulado apenas como "Amazon Prime Video". O usuário
 * vê "Prime Video — assistir" quando na verdade é o canal Diamond Films DENTRO do Prime
 * Video. O JustWatch, por sua vez, lista cada canal como um pacote próprio
 * (clearName = "Diamond Films Amazon Channel"), então é a fonte com granularidade de canal.
 *
 * Estratégia (conservadora, determinística e testável)
 * ────────────────────────────────────────────────────
 *  - Classifica cada provider por identidade canônica (root + variante + acesso) via
 *    `normalizeTitleProvider` — funciona mesmo quando a fonte primária não preencheu esses
 *    campos.
 *  - Para cada oferta INCLUÍDA (flatrate) de um HOST de canais (Prime Video, Apple TV…):
 *      • Se o JustWatch tem canais daquele host PARA O MESMO tipo E NÃO tem o host "puro"
 *        (sinal de que o título só está via canal) → REMOVE a oferta genérica do host
 *        (ela era, na verdade, o canal).
 *      • Caso o JustWatch tenha o host puro também → MANTÉM a genérica (está nos dois) e
 *        ainda assim adiciona os canais.
 *  - Lojas (aluguel/compra) do host permanecem intactas — são a loja real do Amazon Video.
 *  - SEMPRE adiciona os canais reais que o JustWatch encontrou (dedup por identidade).
 *
 * Nunca lança. Se o JustWatch não trouxer canais, devolve a base inalterada.
 */

import type { TitleProvider } from "@/features/title/types";
import { normalizeTitleProvider } from "@/server/streaming/provider-normalization";

/** Roots que hospedam canais de terceiros (channel stores). */
const CHANNEL_HOST_ROOTS = new Set<string>(["prime-video", "apple-tv-plus", "roku"]);

/** variantKey de canal → rootKey do host que o vende. */
const CHANNEL_VARIANT_TO_HOST: Record<string, string> = {
  "prime-video-channel": "prime-video",
  "apple-tv-channel": "apple-tv-plus",
  "roku-channel": "roku",
};

export type ChannelEnrichmentResult = {
  providers: TitleProvider[];
  /** Identidades genéricas de host removidas por serem, na verdade, canais. */
  replaced: string[];
  /** Identidades de canal adicionadas a partir do JustWatch. */
  added: string[];
  /** Houve qualquer mudança em relação à base. */
  changed: boolean;
};

type Classified = {
  provider: TitleProvider;
  rootKey: string;
  variantKey: string;
  accessKind: string;
  type: string;
  /** Host de canais ao qual este provider pertence (genérico ou canal), se houver. */
  host: string | null;
  /** É um pacote de canal de terceiro (ex.: "X Amazon Channel"). */
  isChannel: boolean;
  identity: string;
};

function classify(provider: TitleProvider): Classified {
  const n = normalizeTitleProvider(provider);
  const rootKey = n.rootKey ?? "";
  const variantKey = n.variantKey ?? "direct";
  const accessKind = n.accessKind ?? "unknown";
  const type = n.type ?? "streaming";
  const isChannel = accessKind === "partner_channel";
  const host = isChannel
    ? CHANNEL_VARIANT_TO_HOST[variantKey] ?? null
    : CHANNEL_HOST_ROOTS.has(rootKey)
      ? rootKey
      : null;
  return {
    provider: n,
    rootKey,
    variantKey,
    accessKind,
    type,
    host,
    isChannel,
    identity: `${rootKey}:${variantKey}:${type}`,
  };
}

/**
 * `true` se a lista contém alguma oferta genérica de um host de canais — sinal de que
 * vale a pena consultar o JustWatch para tentar quebrar o host em canais reais.
 */
export function hasChannelHostGeneric(providers: TitleProvider[]): boolean {
  return providers.some((p) => {
    const c = classify(p);
    return !c.isChannel && c.host !== null && c.accessKind === "included";
  });
}

export function mergeChannelOffers(
  base: TitleProvider[],
  justwatch: TitleProvider[],
): ChannelEnrichmentResult {
  const replaced: string[] = [];
  const added: string[] = [];

  const baseClass = base.map(classify);
  const jwClass = justwatch.map(classify);

  // Canais reais que o JustWatch encontrou, indexados por host+tipo.
  const jwChannels = jwClass.filter((c) => c.isChannel && c.host);
  const jwChannelHostType = new Set(jwChannels.map((c) => `${c.host}:${c.type}`));

  // Hosts "puros" (incluídos) que o JustWatch confirma — sinal de que o título ESTÁ
  // mesmo no plano base do host (não apenas via canal).
  const jwPlainHostType = new Set(
    jwClass
      .filter((c) => !c.isChannel && c.host && c.accessKind === "included")
      .map((c) => `${c.host}:${c.type}`),
  );

  // 1) Mantém/descarta cada provider da base.
  const kept: Classified[] = [];
  for (const c of baseClass) {
    const isGenericHostIncluded = !c.isChannel && c.host !== null && c.accessKind === "included";
    if (isGenericHostIncluded) {
      const hostType = `${c.host}:${c.type}`;
      const jwHasChannelHere = jwChannelHostType.has(hostType);
      const jwHasPlainHostHere = jwPlainHostType.has(hostType);
      if (jwHasChannelHere && !jwHasPlainHostHere) {
        // O genérico era, na verdade, um canal → descarta (canais entram no passo 2).
        replaced.push(c.identity);
        continue;
      }
    }
    kept.push(c);
  }

  // 2) Adiciona os canais do JustWatch (dedup por identidade canônica).
  const present = new Set(kept.map((c) => c.identity));
  for (const c of jwChannels) {
    if (present.has(c.identity)) continue;
    present.add(c.identity);
    kept.push(c);
    added.push(c.identity);
  }

  return {
    providers: kept.map((c) => c.provider),
    replaced,
    added,
    changed: replaced.length > 0 || added.length > 0,
  };
}
