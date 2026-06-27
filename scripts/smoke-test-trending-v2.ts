/**
 * Smoke test do Trending V2 (lógica pura — sem rede/banco).
 *
 * Cobre:
 *  - localização de catálogo: pt-BR/en-US sem contaminação cruzada + fallback;
 *  - contrato V2: projeção por idioma, realness (trending vs fallback_local),
 *    identidade IMDb-first e estatísticas de idioma;
 *  - ranking "termômetro vivo": lançamentos recentes priorizados; antigos
 *    evergreen (ex.: The Big Bang Theory) amortizados sem spike vivo, mas
 *    poupados quando há spike (`*_trending`).
 *
 * Uso: npx tsx -r tsconfig-paths/register scripts/smoke-test-trending-v2.ts
 */

import {
  pickLocalized,
  computeCatalogLanguageStats,
  normalizeCatalogLanguageStrict,
  orderCatalogTitlesByLanguage,
} from "@/lib/i18n/catalog-localization";
import { buildTrendingV2Response } from "@/lib/trending/trending-contract";
import { recencyContribution } from "@/lib/trakt-index/engine";
import type { PoplogTitle } from "@/server/types/title";

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${msg}`);
  }
}
function eq(actual: unknown, expected: unknown, msg: string) {
  ok(actual === expected, `${msg}\n    obtido: ${JSON.stringify(actual)} | esperado: ${JSON.stringify(expected)}`);
}

// ─── 1. Normalização de idioma ────────────────────────────────────────────────
eq(normalizeCatalogLanguageStrict("pt"), "pt-BR", "pt → pt-BR");
eq(normalizeCatalogLanguageStrict("en_US"), "en-US", "en_US → en-US");
eq(normalizeCatalogLanguageStrict(undefined), "pt-BR", "undefined → pt-BR (default)");

// ─── 2. pickLocalized: sem contaminação cruzada ───────────────────────────────
const bilingual = {
  "pt-BR": { title: "A Origem", overview: "Sinopse PT", tagline: null },
  "en-US": { title: "Inception", overview: "EN synopsis", tagline: null },
};
eq(pickLocalized(bilingual, "pt-BR").text.title, "A Origem", "pt-BR escolhe título PT");
eq(pickLocalized(bilingual, "en-US").text.title, "Inception", "en-US escolhe título EN");
eq(pickLocalized(bilingual, "en-US").text.overview, "EN synopsis", "en-US escolhe sinopse EN (não PT)");
ok(!pickLocalized(bilingual, "pt-BR").usedFallback, "pt-BR não usa fallback quando há dado");

// Fallback explícito quando o idioma pedido não tem dado
const onlyEn = { "en-US": { title: "Severance", overview: "EN", tagline: null } };
eq(pickLocalized(onlyEn, "pt-BR").text.title, "Severance", "pt-BR sem dado → fallback EN");
ok(pickLocalized(onlyEn, "pt-BR").usedFallback, "fallback sinalizado");
eq(pickLocalized(onlyEn, "en-US").usedFallback, false, "en-US com dado não é fallback");

// ─── 3. Estatísticas de idioma ────────────────────────────────────────────────
const stats = computeCatalogLanguageStats([bilingual, onlyEn, null], "pt-BR");
eq(stats.total, 3, "stats.total");
eq(stats.hasPtBrData, 1, "stats.hasPtBrData");
eq(stats.hasEnUsData, 2, "stats.hasEnUsData");
eq(stats.usedFallbackLanguage, 1, "stats.usedFallbackLanguage (onlyEn em pt-BR)");
eq(stats.incompleteInRequested, 2, "stats.incompleteInRequested (onlyEn + null)");

// ─── 4. Contrato V2: projeção + identidade IMDb-first ─────────────────────────
const baseItem: PoplogTitle = {
  tmdb_id: -1375666,
  media_type: "movie",
  title: "Inception",
  original_title: "Inception",
  poplogId: "cuid_inception",
  externalIds: { imdbId: "tt1375666", traktId: 16662, slug: "inception-2010" },
  localized: bilingual,
};

const ptResp = buildTrendingV2Response({
  items: [baseItem],
  language: "pt-BR",
  region: "BR",
  source: "trakt_index",
  cacheStatus: "trakt_index_primary",
});
eq(ptResp.items[0].title, "A Origem", "V2 pt-BR projeta título PT");
eq(ptResp.items[0].originalTitle, "Inception", "V2 preserva originalTitle EN");
eq(ptResp.items[0].imdbId, "tt1375666", "V2 expõe imdbId (IMDb-first)");
eq(ptResp.items[0].poplogId, "cuid_inception", "V2 expõe poplogId");
eq(ptResp.realness, "trending", "trakt_index → realness=trending");

const enResp = buildTrendingV2Response({
  items: [baseItem],
  language: "en-US",
  region: "US",
  source: "trakt_index",
  cacheStatus: "trakt_index_primary",
});
eq(enResp.items[0].title, "Inception", "V2 en-US projeta título EN");
eq(enResp.language, "en-US", "V2 ecoa idioma resolvido en-US");

// realness de fallback local
const localResp = buildTrendingV2Response({
  items: [baseItem],
  language: "pt-BR",
  region: "BR",
  source: "local_db",
  cacheStatus: "local_db_fast",
});
eq(localResp.realness, "fallback_local", "local_db → realness=fallback_local");

// ─── 5. Ranking termômetro vivo ───────────────────────────────────────────────
const BASE = 300;
const recent = recencyContribution({ ageDays: 20, hasLiveSpike: true, baseScore: BASE });
const fresh = recencyContribution({ ageDays: 300, hasLiveSpike: true, baseScore: BASE });
const oldSpike = recencyContribution({ ageDays: 4000, hasLiveSpike: true, baseScore: BASE });
const oldNoSpike = recencyContribution({ ageDays: 4000, hasLiveSpike: false, baseScore: BASE });

ok(recent.boost > fresh.boost, "lançamento recente recebe boost maior que fresco");
ok(recent.boost > 0, "recente tem boost positivo");
ok(!recent.isEvergreenWithoutSpike, "recente não é evergreen");

// The Big Bang Theory (antigo, sem spike): amortizado → contribuição negativa
ok(oldNoSpike.isEvergreenWithoutSpike, "antigo sem spike é evergreen-without-spike");
ok(oldNoSpike.recencyScore < 0, "evergreen sem spike recebe damp negativo");

// Antigo COM spike vivo (revival/relançamento): poupado do damp
ok(!oldSpike.isEvergreenWithoutSpike, "antigo COM spike não é evergreen-without-spike");
ok(oldSpike.recencyScore >= 0, "antigo com spike não é penalizado");

// Score final: recente supera evergreen-sem-spike de mesmo score base
ok(
  BASE + recent.recencyScore > BASE + oldNoSpike.recencyScore,
  "recente vence evergreen-sem-spike com mesmo score base",
);

// ─── 6. orderCatalogTitlesByLanguage (For You / Watchlist / catálogo geral) ───
// Caso "Obsessão" (pt) / "Obsession" (original en).
const obs = { title: "Obsessão", originalTitle: "Obsession" };
eq(orderCatalogTitlesByLanguage({ ...obs, language: "en-US" }).primary, "Obsession", "en-US → título original (Obsession)");
eq(orderCatalogTitlesByLanguage({ ...obs, language: "pt-BR" }).primary, "Obsessão", "pt-BR → título traduzido (Obsessão)");
eq(orderCatalogTitlesByLanguage({ ...obs, language: "en-US" }).secondary, "Obsessão", "en-US secundário = pt");
// Sem original: cai para o título exibível em ambos.
eq(orderCatalogTitlesByLanguage({ title: "Rooster", originalTitle: null, language: "en-US" }).primary, "Rooster", "en-US sem original → título");
eq(orderCatalogTitlesByLanguage({ title: null, originalTitle: "Legends", language: "pt-BR" }).primary, "Legends", "pt-BR sem título → original");

console.log(`\n[trending-v2] ${pass} passaram, ${fail} falharam`);
if (fail > 0) process.exitCode = 1;
