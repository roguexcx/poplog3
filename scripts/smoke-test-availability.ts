/**
 * Smoke test para o fluxo de leitura/escrita de catalog availability via availability-cache.ts.
 *
 * Testa com POPLOG_LOCAL_AVAILABILITY_ENABLED=true para validar a camada de compatibilidade.
 * Nao requer Supabase configurado.
 *
 * Uso:
 *   tsx -r tsconfig-paths/register scripts/smoke-test-availability.ts
 */

// Forca flag local antes de qualquer import que leia process.env
process.env.POPLOG_LOCAL_AVAILABILITY_ENABLED = "true";

import { db } from "@/server/db/client";
import {
  getAvailability,
  isAvailabilityFresh,
  replaceAvailability,
  type AvailabilityRow,
} from "@/server/cache/availability-cache";

const SMOKE_TMDB_ID = 987655099;
const SMOKE_COUNTRY = "BR";
const SMOKE_MEDIA_TYPE = "movie" as const;

async function assertOk(label: string, cond: boolean) {
  if (!cond) throw new Error(`${label} failed`);
  console.log(`[smoke:availability] ${label}: ok`);
}

async function assertRows(label: string, rows: AvailabilityRow[], expectedCount: number) {
  if (rows.length !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} rows, got ${rows.length}`);
  }
  console.log(`[smoke:availability] ${label}: ok (${rows.length} rows)`);
}

async function cleanup() {
  await db.catalogAvailability.deleteMany({
    where: {
      tmdbId: BigInt(SMOKE_TMDB_ID),
      providerRegion: SMOKE_COUNTRY,
    },
  });
}

async function main() {
  // Sanidade: flag esta ligada
  const { isLocalAvailabilityEnabled } = await import("@/server/runtime/local-db-flags");
  await assertOk("flag POPLOG_LOCAL_AVAILABILITY_ENABLED=true lida", isLocalAvailabilityEnabled());

  await cleanup();

  // --- replaceAvailability: inserir streaming e VOD ---
  await replaceAvailability({
    tmdbId: SMOKE_TMDB_ID,
    mediaType: SMOKE_MEDIA_TYPE,
    country: SMOKE_COUNTRY,
    source: "tmdb",
    rows: [
      {
        providerName: "Netflix",
        availabilityType: "streaming",
        rawPayload: { source: "smoke-test" },
      },
      {
        providerName: "Prime Video",
        availabilityType: "rent",
        rawPayload: { source: "smoke-test" },
      },
    ],
    ttlDays: 7,
  });
  console.log("[smoke:availability] replaceAvailability (insert): ok");

  // --- getAvailability: ler de volta ---
  const rows = await getAvailability(SMOKE_MEDIA_TYPE, SMOKE_TMDB_ID, SMOKE_COUNTRY);
  await assertRows("getAvailability", rows, 2);

  const streaming = rows.find((r) => r.provider_name === "Netflix");
  const rent = rows.find((r) => r.provider_name === "Prime Video");

  await assertOk("Netflix availability_type = streaming", streaming?.availability_type === "streaming");
  await assertOk("Netflix source = tmdb", streaming?.source === "tmdb");
  await assertOk("Netflix country = BR", streaming?.country === SMOKE_COUNTRY);
  await assertOk("Netflix tmdb_id correct", streaming?.tmdb_id === SMOKE_TMDB_ID);
  await assertOk("Prime Video availability_type = rent", rent?.availability_type === "rent");

  // --- isAvailabilityFresh: com expires_at futuro ---
  await assertOk("isAvailabilityFresh (7-day TTL)", isAvailabilityFresh(rows, 7));
  await assertOk("isAvailabilityFresh vazio retorna false", !isAvailabilityFresh([]));

  // --- replaceAvailability: substituir por source diferente (watchmode) ---
  await replaceAvailability({
    tmdbId: SMOKE_TMDB_ID,
    mediaType: SMOKE_MEDIA_TYPE,
    country: SMOKE_COUNTRY,
    source: "watchmode",
    rows: [
      {
        providerName: "Disney+",
        availabilityType: "streaming",
        rawPayload: { source: "smoke-test-watchmode" },
      },
    ],
    ttlDays: 3,
  });
  console.log("[smoke:availability] replaceAvailability (watchmode): ok");

  // --- Nao deve apagar dados do source=tmdb ---
  const rowsAfterWatchmode = await getAvailability(SMOKE_MEDIA_TYPE, SMOKE_TMDB_ID, SMOKE_COUNTRY);
  // tmdb (2) + watchmode (1) = 3 rows total
  await assertRows("getAvailability apos watchmode (tmdb+watchmode)", rowsAfterWatchmode, 3);

  // --- replaceAvailability: limpar source=tmdb (rows vazio) ---
  await replaceAvailability({
    tmdbId: SMOKE_TMDB_ID,
    mediaType: SMOKE_MEDIA_TYPE,
    country: SMOKE_COUNTRY,
    source: "tmdb",
    rows: [],
  });
  console.log("[smoke:availability] replaceAvailability (clear tmdb): ok");

  const rowsAfterClear = await getAvailability(SMOKE_MEDIA_TYPE, SMOKE_TMDB_ID, SMOKE_COUNTRY);
  await assertRows("getAvailability apos clear tmdb (so watchmode)", rowsAfterClear, 1);
  await assertOk("row remanescente e watchmode", rowsAfterClear[0]?.source === "watchmode");

  // --- cleanup ---
  await cleanup();
  const rowsFinal = await getAvailability(SMOKE_MEDIA_TYPE, SMOKE_TMDB_ID, SMOKE_COUNTRY);
  await assertRows("getAvailability apos cleanup (zero rows)", rowsFinal, 0);

  console.log("[smoke:availability] availability smoke completed (local path)");
}

main().catch((error) => {
  console.error("[smoke:availability] availability smoke failed", error);
  process.exitCode = 1;
});
