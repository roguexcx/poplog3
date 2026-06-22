/**
 * verify-availability-titles.ts — Verificação ponta a ponta de disponibilidade (P2).
 *
 * Para cada título (por IMDb ID exato) percorre TODA a cadeia canônica e imprime:
 *   1. Identidade canônica: poplogId, imdbId, tmdbId, traktId, mediaType, aliases, título/ano
 *   2. catalog_availability ANTES (linhas frescas + sentinela __none__)
 *   3. Payload BRUTO das fontes: Balloonerismm (detailed) + JustWatch (raw/match)
 *   4. getTitleAvailability LIVE (bypassNegativeCache) → state, source, providers parseados,
 *      bestProvider e o trace de debug (balloon/justwatch/final outcomes)
 *   5. getTitleAvailability CACHE-ONLY (como a Biblioteca/cards leem) → após o passo 4 ter
 *      persistido, deve encontrar o provider e habilitar o badge no fluxo normal das listas
 *   6. catalog_availability DEPOIS (confirma persistência; JustWatch grava source "justwatch")
 *   7. Payload final do card (best_provider_name/type/logo derivado do bestProvider)
 *
 * Pré-requisitos: .env.local com DATABASE_URL e (para o fallback) JUSTWATCH_UNOFFICIAL_FALLBACK=true.
 *
 * Run:
 *   npx tsx -r tsconfig-paths/register -r dotenv/config scripts/verify-availability-titles.ts dotenv_config_path=.env.local
 *
 * Opcional: passe IMDb IDs como args para sobrescrever os casos padrão:
 *   ... scripts/verify-availability-titles.ts dotenv_config_path=.env.local tt11379026:tv tt0412142:tv
 */

import { db } from "@/server/db/client";
import { getTitleAvailabilityWithDebug } from "@/server/availability";
import { resolvePoplogTitleIdentity } from "@/server/titles/poplog-title-identity";
import { getBalloonerismWatchProvidersDetailed } from "@/server/titles/balloonerismm-providers";
import {
  getJustWatchUnofficialProviders,
  isJustWatchUnofficialEnabled,
} from "@/server/streaming/justwatch-graphql-unofficial-source";

type Case = {
  label: string;
  imdb: string;
  mediaType: "movie" | "tv";
  /** Controle: indisponível no BR — sem providers NÃO é bug. */
  expectUnavailableBR?: boolean;
};

const DEFAULT_CASES: Case[] = [
  { label: "Ghosts (US) — positivo BR", imdb: "tt11379026", mediaType: "tv" },
  { label: "House / Dr. House — positivo BR", imdb: "tt0412142", mediaType: "tv" },
  { label: "The Handmaid's Tale — positivo BR (estava preso em __none__)", imdb: "tt5834204", mediaType: "tv" },
  {
    label: "The Flight Attendant — CONTROLE de indisponibilidade BR",
    imdb: "tt7569592",
    mediaType: "tv",
    expectUnavailableBR: true,
  },
];

const REGION = "BR";

function parseArgs(): Case[] {
  const argCases: Case[] = [];
  for (const arg of process.argv.slice(2)) {
    const m = /^(tt\d+):(movie|tv)$/.exec(arg);
    if (m) argCases.push({ label: `CLI ${m[1]}`, imdb: m[1], mediaType: m[2] as "movie" | "tv" });
  }
  return argCases.length > 0 ? argCases : DEFAULT_CASES;
}

async function catalogRows(imdbId: string) {
  const now = new Date();
  const rows = await db.catalogAvailability.findMany({
    where: { imdbId },
    select: {
      providerName: true, providerRegion: true, providerType: true,
      source: true, sourceConfidence: true, checkedAt: true, expiresAt: true,
    },
    orderBy: { checkedAt: "desc" },
    take: 20,
  });
  const fresh = rows.filter((r) => r.expiresAt > now);
  return {
    total: rows.length,
    fresh: fresh.length,
    negativeSentinel: fresh.some((r) => r.providerName === "__none__"),
    freshProviders: fresh.filter((r) => r.providerName !== "__none__").map((r) => `${r.providerName}(${r.providerType}/${r.source})`),
  };
}

function flat(providers: { flatrate: unknown[]; rent: unknown[]; buy: unknown[]; free: unknown[]; ads: unknown[] }) {
  return {
    flatrate: providers.flatrate.length,
    rent: providers.rent.length,
    buy: providers.buy.length,
    free: providers.free.length,
    ads: providers.ads.length,
  };
}

async function verifyTitle(c: Case) {
  console.log("\n" + "═".repeat(78));
  console.log(`▶ ${c.label}  [${c.imdb} / ${c.mediaType}]${c.expectUnavailableBR ? "  (controle)" : ""}`);
  console.log("═".repeat(78));

  // 1. Identidade canônica
  let identity: Awaited<ReturnType<typeof resolvePoplogTitleIdentity>> | null = null;
  try {
    identity = await resolvePoplogTitleIdentity({ mediaType: c.mediaType, id: c.imdb });
    console.log("1) IDENTIDADE CANÔNICA");
    console.log("   poplogId :", identity.poplogId ?? null);
    console.log("   title    :", identity.title ?? null, "| year:", identity.year ?? null);
    console.log("   externalIds:", JSON.stringify(identity.externalIds));
  } catch (err) {
    console.log("1) IDENTIDADE — erro:", err instanceof Error ? err.message : err);
  }

  const imdbId = identity?.externalIds?.imdbId ?? c.imdb;
  const tmdbId = identity?.externalIds?.tmdbId ?? null;
  const title = identity?.title ?? c.label;
  const year = identity?.year ?? null;

  // 2. catalog_availability ANTES
  try {
    console.log("2) catalog_availability ANTES:", JSON.stringify(await catalogRows(imdbId)));
  } catch (err) {
    console.log("2) catalog_availability — DB erro:", err instanceof Error ? err.message : err);
  }

  // 3. Payload bruto das fontes
  console.log("3) FONTES (payload bruto / parse)");
  try {
    const balloon = await getBalloonerismWatchProvidersDetailed(imdbId, c.mediaType, REGION);
    console.log(`   Balloonerismm: outcome=${balloon.outcome} providers=${balloon.providers.length} path=${balloon.path}`);
    if (balloon.providers.length) {
      console.log("     →", balloon.providers.map((p) => `${p.name}(${p.type})`).join(", "));
    }
  } catch (err) {
    console.log("   Balloonerismm — erro:", err instanceof Error ? err.message : err);
  }
  console.log(`   JustWatch enabled=${isJustWatchUnofficialEnabled()}`);
  try {
    const jw = await getJustWatchUnofficialProviders({ title, year, imdbId, tmdbId, mediaType: c.mediaType, region: REGION });
    console.log(`   JustWatch: outcome=${jw.outcome} via=${jw.matched?.matchedVia ?? "-"} offers=${jw.offersCount} parsed=${jw.providers.length} emptyReason=${jw.emptyReason ?? "-"}`);
    console.log(`     matched: "${jw.matched?.title ?? "-"}" imdb=${jw.matched?.imdbId ?? "-"} tmdb=${jw.matched?.tmdbId ?? "-"}`);
    if (jw.providers.length) console.log("     →", jw.providers.map((p) => `${p.name}(${p.type})`).join(", "));
  } catch (err) {
    console.log("   JustWatch — erro:", err instanceof Error ? err.message : err);
  }

  // 4. getTitleAvailability LIVE (força caminho ao vivo + fallback)
  console.log("4) getTitleAvailability LIVE (bypassNegativeCache)");
  try {
    const { summary, debug } = await getTitleAvailabilityWithDebug({
      mediaType: c.mediaType, imdbId, tmdbId, region: REGION,
      title, year, bypassNegativeCache: true,
    });
    console.log("   state:", summary.state, "| source:", summary.source, "| best:", summary.bestProvider?.name ?? null);
    console.log("   providers:", JSON.stringify(flat(summary.providers)));
    console.log("   providerRequest:", JSON.stringify(debug.providerRequest));
    console.log("   justwatch:", JSON.stringify(debug.justwatch));
    if (debug.errors.length) console.log("   errors:", debug.errors);

    // 7. Payload final do card (derivado do bestProvider)
    const best = summary.bestProvider;
    console.log("7) PAYLOAD DO CARD (live):", JSON.stringify({
      best_provider_name: best?.name ?? null,
      best_provider_type: best?.type ?? null,
      best_provider_logo: best?.logoUrl ?? null,
      hasBadge: Boolean(best?.name || best?.logoUrl),
    }));
  } catch (err) {
    console.log("   LIVE — DB/erro:", err instanceof Error ? err.message : err);
  }

  // A persistência no passo 4 é fire-and-forget; espera um pouco para a gravação landar
  // antes de ler em cacheOnly (simula o próximo carregamento da Biblioteca).
  await new Promise((r) => setTimeout(r, 1200));

  // 5. getTitleAvailability CACHE-ONLY (como Biblioteca/cards leem)
  console.log("5) getTitleAvailability CACHE-ONLY (fluxo das listas/cards, pós-persistência)");
  try {
    const { summary } = await getTitleAvailabilityWithDebug({
      mediaType: c.mediaType, imdbId, tmdbId, region: REGION, title, year, cacheOnly: true,
    });
    const best = summary.bestProvider;
    console.log("   state:", summary.state, "| source:", summary.source, "| best:", best?.name ?? null,
      "| badgeNoCard:", Boolean(best?.name || best?.logoUrl));
  } catch (err) {
    console.log("   CACHE-ONLY — DB/erro:", err instanceof Error ? err.message : err);
  }

  // 6. catalog_availability DEPOIS (deve conter as linhas persistidas — source "justwatch"
  //    quando o fallback entrou; ou "balloonerismm" quando a fonte primária resolveu).
  try {
    console.log("6) catalog_availability DEPOIS:", JSON.stringify(await catalogRows(imdbId)));
  } catch (err) {
    console.log("6) catalog_availability — DB erro:", err instanceof Error ? err.message : err);
  }
}

async function run() {
  console.log("[verify-availability] JUSTWATCH_UNOFFICIAL_FALLBACK =", isJustWatchUnofficialEnabled());
  for (const c of parseArgs()) {
    await verifyTitle(c).catch((err) => console.error(`FALHA em ${c.label}:`, err));
  }
  console.log("\n[verify-availability] done");
  await db.$disconnect().catch(() => undefined);
}

run().catch((err) => {
  console.error("[verify-availability] FAILED", err);
  process.exit(1);
});
