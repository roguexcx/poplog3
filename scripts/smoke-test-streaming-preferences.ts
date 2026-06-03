/**
 * Smoke test: Fase 13C — Streaming preferences local
 *
 * Valida o caminho Prisma/local de user_streaming_preferences sem Supabase.
 */
import "dotenv/config";
import { db } from "@/server/db/client";
import { isLocalStreamingPreferencesEnabled } from "@/server/runtime/local-db-flags";
import {
  getFavoriteTmdbProviderIds,
  listActiveStreamingProviders,
  listUserStreamingPreferences,
  replaceUserStreamingPreferences,
} from "@/server/local-services/streaming-preferences-local.service";

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`[smoke:streaming-preferences] ✓ ${label}`);
    passed++;
  } else {
    console.error(`[smoke:streaming-preferences] ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

const SMOKE_USER_ID = "local-user-streaming-preferences-smoke";
const PROVIDER_A_ID = "streaming-pref-smoke-provider-a";
const PROVIDER_B_ID = "streaming-pref-smoke-provider-b";

async function cleanup() {
  await db.userStreamingPreference.deleteMany({ where: { userId: SMOKE_USER_ID } });
  await db.streamingProvider.deleteMany({ where: { id: { in: [PROVIDER_A_ID, PROVIDER_B_ID] } } });
  await db.user.deleteMany({ where: { id: SMOKE_USER_ID } });
}

async function seed() {
  await db.user.upsert({
    where: { id: SMOKE_USER_ID },
    update: {},
    create: {
      id: SMOKE_USER_ID,
      email: "streaming-preferences-smoke@poplog.local",
      name: "Streaming Preferences Smoke",
    },
  });

  await db.streamingProvider.createMany({
    data: [
      {
        id: PROVIDER_A_ID,
        name: "Provider Smoke A",
        providerSlug: "provider-smoke-a",
        tmdbProviderId: 91001,
        logoPath: "/provider-a.png",
        country: "BR",
        isActive: true,
      },
      {
        id: PROVIDER_B_ID,
        name: "Provider Smoke B",
        providerSlug: "provider-smoke-b",
        tmdbProviderId: 91002,
        logoPath: "/provider-b.png",
        country: "BR",
        isActive: true,
      },
    ],
    skipDuplicates: true,
  });
}

async function main() {
  const originalLocalDb = process.env.POPLOG_LOCAL_DB_ENABLED;
  const originalStreaming = process.env.POPLOG_LOCAL_STREAMING_PREFERENCES_ENABLED;

  process.env.POPLOG_LOCAL_DB_ENABLED = "false";
  process.env.POPLOG_LOCAL_STREAMING_PREFERENCES_ENABLED = "true";

  await cleanup();
  await seed();

  assert("flag local de streaming preferences é reconhecida", isLocalStreamingPreferencesEnabled());

  const providers = await listActiveStreamingProviders("BR");
  assert(
    "providers ativos locais são listados em formato compatível",
    providers.some((provider) => provider.id === PROVIDER_A_ID && provider.provider_name === "Provider Smoke A"),
  );

  await replaceUserStreamingPreferences({
    userId: SMOKE_USER_ID,
    country: "BR",
    providerIds: [PROVIDER_B_ID, PROVIDER_A_ID],
  });

  const preferences = await listUserStreamingPreferences(SMOKE_USER_ID, "BR");
  assert("duas preferências são gravadas", preferences.length === 2, `got ${preferences.length}`);
  assert("ordem de prioridade é preservada", preferences[0]?.provider_id === PROVIDER_B_ID);

  const favoriteTmdbIds = await getFavoriteTmdbProviderIds({ userId: SMOKE_USER_ID, country: "BR" });
  assert(
    "preferências resolvem tmdb_provider_id para motores",
    favoriteTmdbIds.join(",") === "91002,91001",
    favoriteTmdbIds.join(","),
  );

  await replaceUserStreamingPreferences({
    userId: SMOKE_USER_ID,
    country: "BR",
    providerIds: [PROVIDER_A_ID],
  });

  const replaced = await listUserStreamingPreferences(SMOKE_USER_ID, "BR");
  const enabled = replaced.filter((row) => row.is_enabled);
  assert("replace desativa preferências antigas", enabled.length === 1 && enabled[0]?.provider_id === PROVIDER_A_ID);

  await cleanup();
  process.env.POPLOG_LOCAL_DB_ENABLED = originalLocalDb;
  process.env.POPLOG_LOCAL_STREAMING_PREFERENCES_ENABLED = originalStreaming;

  console.log(`\n[smoke:streaming-preferences] Resultado: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((error) => {
    console.error("[smoke:streaming-preferences] erro fatal", error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
