/**
 * revalidate-negative-availability.ts — Saneamento RETROATIVO de sentinelas negativas.
 *
 * Reavalia, pelo FLUXO CANÔNICO, as sentinelas `__none__` históricas já gravadas em
 * `catalog_availability`. Títulos disponíveis (ex.: via JustWatch) que ficaram presos em
 * negativos legados passam a ser corrigidos automaticamente — independentemente da data
 * de criação ou da origem original do cache.
 *
 * Para cada sentinela:
 *   - resolve título/ano (identidade canônica) p/ alimentar o fallback;
 *   - chama getTitleAvailability LIVE com bypassNegativeCache → Balloonerismm + JustWatch;
 *   - o pipeline canônico persiste o resultado: providers (source "balloonerismm"/"justwatch")
 *     OU re-grava um negativo agora "confiável" (sourceConfidence "low", não-revalidável).
 *
 * Por padrão processa SÓ os negativos REVALIDÁVEIS (sourceConfidence != "low"); use --all
 * para reprocessar todos. Idempotente e seguro para rodar periodicamente (cron).
 *
 * Run:
 *   npx tsx -r tsconfig-paths/register -r dotenv/config scripts/revalidate-negative-availability.ts dotenv_config_path=.env.local
 * Opções (args): --region=BR  --limit=200  --concurrency=3  --all  --dry
 */

import { db } from "@/server/db/client";
import { getTitleAvailabilityWithDebug } from "@/server/availability";
import { resolvePoplogTitleIdentity } from "@/server/titles/poplog-title-identity";

const NONE = "__none__";

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const REGION = arg("region", "BR").toUpperCase();
const LIMIT = Number(arg("limit", "200"));
const CONCURRENCY = Math.max(1, Number(arg("concurrency", "3")));
const INCLUDE_ALL = hasFlag("all");
const DRY = hasFlag("dry");

type Sentinel = { imdbId: string; mediaType: "movie" | "tv" };

async function loadSentinels(): Promise<Sentinel[]> {
  const rows = await db.catalogAvailability.findMany({
    where: {
      providerName: NONE,
      providerRegion: REGION,
      imdbId: { not: null },
      ...(INCLUDE_ALL ? {} : { NOT: { sourceConfidence: "low" } }),
    },
    select: { imdbId: true, mediaType: true },
    take: LIMIT,
    orderBy: { checkedAt: "asc" }, // mais antigos primeiro
  });
  // Dedup por imdbId+mediaType.
  const seen = new Set<string>();
  const out: Sentinel[] = [];
  for (const r of rows) {
    if (!r.imdbId) continue;
    const key = `${r.mediaType}:${r.imdbId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ imdbId: r.imdbId, mediaType: r.mediaType });
  }
  return out;
}

const metrics = {
  scanned: 0,
  revalidatedPositive: 0,
  replacedByJustwatch: 0,
  replacedByBalloonerismm: 0,
  stillNegative: 0,
  errors: 0,
  catalogReplaced: 0, // __none__ realmente substituído por providers no DB (verificado)
  catalogStillNone: 0, // continua __none__ fresco no DB após revalidar
};

// Itens processados (para a verificação de DB pós-gravação).
const processed: { imdbId: string; mediaType: "movie" | "tv"; title: string; wasReal: boolean }[] = [];

async function processOne(s: Sentinel): Promise<void> {
  metrics.scanned++;
  const identity = await resolvePoplogTitleIdentity({ mediaType: s.mediaType, id: s.imdbId }).catch(
    () => null,
  );
  const title = identity?.title ?? "?";
  if (DRY) {
    console.log(`[dry] ${s.mediaType}:${s.imdbId} "${title}" — seria revalidado`);
    return;
  }
  try {
    const { summary, debug } = await getTitleAvailabilityWithDebug({
      mediaType: s.mediaType,
      imdbId: s.imdbId,
      tmdbId: identity?.externalIds?.tmdbId ?? null,
      title: identity?.title ?? null,
      year: identity?.year ?? null,
      region: REGION,
      bypassNegativeCache: true,
      skipReleaseDates: true,
    });

    const r = debug.result;
    const providersCount = r.flatrateCount + r.rentCount + r.buyCount + r.freeCount + r.adsCount;
    const best = summary.bestProvider;
    // "Positive" SÓ quando há provider real: available + hasProviders + count>0 + best válido.
    const isReal =
      summary.state === "available" &&
      r.hasProviders &&
      providersCount > 0 &&
      !!best &&
      best.name !== NONE &&
      best.name.trim() !== "";

    if (isReal) {
      metrics.revalidatedPositive++;
      if (r.source === "justwatch_graphql_unofficial") metrics.replacedByJustwatch++;
      else metrics.replacedByBalloonerismm++;
    } else {
      metrics.stillNegative++;
    }
    processed.push({ imdbId: s.imdbId, mediaType: s.mediaType, title, wasReal: isReal });

    console.log(
      `[${isReal ? "FIXED" : "none "}] ${s.mediaType}:${s.imdbId} "${title}" | ` +
        `balloon=${debug.providerRequest.balloonerismmOutcome} jw=${debug.providerRequest.justwatchOutcome ?? "-"} ` +
        `final=${debug.providerRequest.finalOutcome} source=${r.source} state=${summary.state} ` +
        `providers=${providersCount} best=${best && best.name !== NONE ? best.name : "—"}`,
    );
  } catch (err) {
    metrics.errors++;
    console.warn(`[err  ] ${s.mediaType}:${s.imdbId}: ${err instanceof Error ? err.message : err}`);
  }
}

/** Verifica no DB se a sentinela __none__ foi de fato substituída por providers. */
async function verifyCatalog(): Promise<void> {
  const now = new Date();
  for (const p of processed) {
    const rows = await db.catalogAvailability.findMany({
      where: { imdbId: p.imdbId, providerRegion: REGION },
      select: { providerName: true, expiresAt: true },
    });
    const fresh = rows.filter((row) => row.expiresAt > now);
    const stillNone = fresh.length > 0 && fresh.every((row) => row.providerName === NONE);
    const hasProviders = fresh.some((row) => row.providerName !== NONE);
    if (hasProviders) metrics.catalogReplaced++;
    else if (stillNone) metrics.catalogStillNone++;
    // Inconsistência: classificado como positive mas o DB segue __none__.
    if (p.wasReal && !hasProviders) {
      console.warn(`[INCONSISTÊNCIA] ${p.mediaType}:${p.imdbId} "${p.title}" classificado positive mas catalog_availability segue __none__/vazio`);
    }
  }
}

async function run() {
  console.log(`[revalidate-negatives] region=${REGION} limit=${LIMIT} concurrency=${CONCURRENCY} all=${INCLUDE_ALL} dry=${DRY}`);
  const sentinels = await loadSentinels();
  console.log(`[revalidate-negatives] sentinelas a processar: ${sentinels.length}`);

  let cursor = 0;
  async function worker() {
    while (cursor < sentinels.length) {
      await processOne(sentinels[cursor++]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sentinels.length) }, () => worker()));

  // Dá tempo para as gravações fire-and-forget (writeProvidersToCache) landarem.
  await new Promise((r) => setTimeout(r, 3000));

  // Verifica no DB se as sentinelas foram realmente substituídas.
  if (!DRY) await verifyCatalog();

  console.log("\n[revalidate-negatives] MÉTRICAS:", JSON.stringify(metrics, null, 2));
  console.log("[revalidate-negatives] done");
  await db.$disconnect().catch(() => undefined);
}

run().catch((err) => {
  console.error("[revalidate-negatives] FAILED", err);
  process.exit(1);
});
