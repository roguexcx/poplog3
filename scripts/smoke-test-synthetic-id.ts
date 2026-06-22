/**
 * Smoke test do round-trip synthetic ↔ IMDb.
 *
 * IDs IMDb são zero-padded para no mínimo 7 dígitos. A conversão para tmdbId
 * synthetic perde os zeros à esquerda, então a reconstrução PRECISA re-aplicar
 * o padding — caso contrário "tt0458339" → -458339 → "tt458339" (inválido),
 * quebrando identity/hidratação/página de título.
 *
 * Uso: npx tsx -r tsconfig-paths/register scripts/smoke-test-synthetic-id.ts
 */

import {
  syntheticTmdbFromImdbId,
  imdbIdFromSyntheticTmdbId,
} from "@/lib/ids/synthetic-tmdb-id";

let pass = 0;
let fail = 0;
function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) pass++;
  else {
    fail++;
    console.error(`✗ ${msg}\n    obtido: ${JSON.stringify(actual)} | esperado: ${JSON.stringify(expected)}`);
  }
}

// Round-trip canônico (inclui as URLs que falhavam).
for (const imdb of [
  "tt0458339",
  "tt0848228",
  "tt0087800",
  "tt10172266",
  "tt5164432",
  "tt0137523",
  "tt1375666",
]) {
  const syn = syntheticTmdbFromImdbId(imdb)!;
  eq(imdbIdFromSyntheticTmdbId(syn), imdb, `round-trip ${imdb} (syn=${syn})`);
}

// Reconstrução direta dos sintéticos reportados.
eq(imdbIdFromSyntheticTmdbId(-458339), "tt0458339", "-458339 → tt0458339 (zero-padding)");
eq(imdbIdFromSyntheticTmdbId(-848228), "tt0848228", "-848228 → tt0848228");
eq(imdbIdFromSyntheticTmdbId(-87800), "tt0087800", "-87800 → tt0087800");
eq(imdbIdFromSyntheticTmdbId(-10172266), "tt10172266", "-10172266 → tt10172266 (8 dígitos)");
eq(imdbIdFromSyntheticTmdbId(-5164432), "tt5164432", "-5164432 → tt5164432 (7 dígitos)");
eq(imdbIdFromSyntheticTmdbId(5), null, "tmdbId positivo → null");

console.log(`\n[synthetic-id] ${pass} passaram, ${fail} falharam`);
if (fail > 0) process.exitCode = 1;
