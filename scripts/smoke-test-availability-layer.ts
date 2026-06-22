/**
 * Smoke test da camada global de disponibilidade.
 * Exercita: distinção de outcome (ok/empty/error), resolução de imdbId e o trace de debug.
 *
 * Run: npx tsx -r tsconfig-paths/register -r dotenv/config scripts/smoke-test-availability-layer.ts dotenv_config_path=.env.local
 */

import { getBalloonerismWatchProvidersDetailed } from "@/server/titles/balloonerismm-providers";
import { getTitleAvailabilityWithDebug } from "@/server/availability";

type Case = { label: string; imdb?: string; tmdbId?: number; mediaType: "movie" | "tv" };

const CASES: Case[] = [
  { label: "Oppenheimer (filme, rent/buy BR)", imdb: "tt15398776", mediaType: "movie" },
  { label: "Breaking Bad (série, BR vazio)", imdb: "tt0903747", mediaType: "tv" },
  { label: "ID inválido (deve dar empty/error, NÃO crashar)", imdb: "tt00000000", mediaType: "movie" },
  { label: "Sem imdbId nem tmdbId → unresolved", mediaType: "movie" },
];

async function run() {
  console.log("──── outcome distinction (sem DB) ────");
  for (const c of CASES) {
    if (!c.imdb) continue;
    const d = await getBalloonerismWatchProvidersDetailed(c.imdb, c.mediaType, "BR");
    console.log(`${c.label}: outcome=${d.outcome} providers=${d.providers.length} path=${d.path}`);
  }

  console.log("\n──── getTitleAvailabilityWithDebug (DB) ────");
  for (const c of CASES) {
    try {
      const { summary, debug } = await getTitleAvailabilityWithDebug({
        mediaType: c.mediaType,
        imdbId: c.imdb ?? null,
        tmdbId: c.tmdbId ?? null,
        region: "BR",
      });
      console.log(`\n${c.label}`);
      console.log("  state:", summary.state, "| source:", summary.source, "| best:", summary.bestProvider?.name ?? null);
      console.log("  resolved:", debug.resolved, "| cache:", debug.cache);
      console.log("  providerRequest:", debug.providerRequest);
      console.log("  result:", debug.result);
      if (debug.errors.length) console.log("  errors:", debug.errors);
    } catch (err) {
      console.log(`\n${c.label}\n  DB indisponível → pulado (${err instanceof Error ? err.message.slice(0, 60) : err})`);
    }
  }
  console.log("\n[smoke:availability-layer] done");
}

run().catch((err) => {
  console.error("[smoke:availability-layer] FAILED", err);
  process.exit(1);
});
