import { db } from "@/server/db/client";
import { buildSorteioPool, pickWeightedSorteioItem } from "@/server/sorteio/sorteio-engine";

const USER_ID = "smoke-sorteio-local-draw";
const TMDB_ID = 199991234;

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
  console.log(`[smoke:sorteio-local-draw] ${message}: ok`);
}

async function run() {
  await db.userEvent.deleteMany({ where: { userId: USER_ID } });
  await db.userTitleState.deleteMany({ where: { userId: USER_ID, tmdbId: TMDB_ID, mediaType: "movie" } });
  await db.user.deleteMany({ where: { id: USER_ID } });
  await db.poplog3Title.deleteMany({ where: { tmdbId: TMDB_ID, mediaType: "movie" } });

  await db.user.create({
    data: { id: USER_ID, email: `${USER_ID}@poplog.dev`, name: "Sorteio Local Smoke" },
  });
  await db.poplog3Title.create({
    data: {
      tmdbId: TMDB_ID,
      mediaType: "movie",
      imdbId: "tt9912345",
      title: "Sorteio Local Smoke Movie",
      originalTitle: "Sorteio Local Smoke Movie",
      posterPath: "/poster-smoke.jpg",
      backdropPath: "/backdrop-smoke.jpg",
      releaseDate: new Date("2024-01-01"),
      year: 2024,
      voteAverage: 7.5,
      voteCount: 800,
      popularity: 100,
      source: "smoke",
    },
  });

  const pool = await buildSorteioPool(
    USER_ID,
    { mode: "discovery", type: "all", vibe: "all" },
    { externalDiscovery: false, warmAvailability: false },
  );
  assert(pool.meta.poolSource === "local_db", "pool local-db sem descoberta externa");
  assert(pool.meta.skippedReasons.includes("external_discovery_disabled_for_draw"), "fallback externo desativado no draw");
  assert(pool.items.some((item) => item.id === TMDB_ID), "pool inclui fixture local");

  const item = pickWeightedSorteioItem(pool.items);
  assert(Boolean(item), "draw seleciona item do pool local");

  await db.poplog3Title.deleteMany({ where: { tmdbId: TMDB_ID, mediaType: "movie" } });
  await db.user.deleteMany({ where: { id: USER_ID } });
  await db.$disconnect();
}

run().catch(async (error) => {
  console.error("[smoke:sorteio-local-draw] FAILED", error instanceof Error ? error.message : error);
  await db.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
