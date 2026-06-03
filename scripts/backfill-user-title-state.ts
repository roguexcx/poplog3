/**
 * Backfill: sincroniza user_title_state a partir de user_titles (Prisma/MySQL)
 *
 * Lê todos os registros de userTitle, compara com userTitleState e
 * chama a rota admin para entradas ausentes ou divergentes.
 * Totalmente idempotente — pode ser executado múltiplas vezes sem efeitos colaterais.
 *
 * Uso:
 *   npx tsx scripts/backfill-user-title-state.ts
 *   npx tsx scripts/backfill-user-title-state.ts --dry-run
 *   npx tsx scripts/backfill-user-title-state.ts --limit 100
 *   npx tsx scripts/backfill-user-title-state.ts --user-id abc123
 *
 * Requer: DATABASE_URL no .env (ou .env.local)
 */

import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

// ── CLI args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN     = args.includes("--dry-run");
const LIMIT_ARG   = args.find((a) => a.startsWith("--limit="));
const USER_ARG    = args.find((a) => a.startsWith("--user-id="));
const limitIdx    = args.indexOf("--limit");
const userIdx     = args.indexOf("--user-id");
const MAX_SYNC    = LIMIT_ARG
  ? parseInt(LIMIT_ARG.split("=")[1], 10)
  : limitIdx >= 0
  ? parseInt(args[limitIdx + 1], 10)
  : Infinity;
const TARGET_USER = USER_ARG
  ? USER_ARG.split("=")[1]
  : userIdx >= 0
  ? args[userIdx + 1]
  : null;

const CONCURRENCY = 5;

type MediaType = "movie" | "tv";

type TitleRow = {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  status: string | null;
};

type StateRow = {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  status: string | null;
};

type SyncReason = "missing" | "divergent_status";

type SyncEntry = {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  reason: SyncReason;
  currentState: string | null;
  expectedStatus: string | null;
};

function key(userId: string, mediaType: string, tmdbId: number) {
  return `${userId}:${mediaType}:${tmdbId}`;
}

async function fetchCanonicalTitles(
  db: Awaited<typeof import("@/server/db/client")>["db"],
  filterUserId: string | null,
): Promise<Map<string, TitleRow>> {
  console.log("[backfill] Lendo user_titles (Prisma)...");

  const rows = await db.userTitle.findMany({
    where: filterUserId ? { userId: filterUserId } : undefined,
    select: { userId: true, tmdbId: true, mediaType: true, status: true },
    orderBy: { createdAt: "desc" },
  });

  const canonical = new Map<string, TitleRow>();
  for (const row of rows) {
    const k = key(row.userId, row.mediaType, row.tmdbId);
    if (!canonical.has(k)) {
      canonical.set(k, {
        userId: row.userId,
        tmdbId: row.tmdbId,
        mediaType: row.mediaType as MediaType,
        status: row.status,
      });
    }
  }

  console.log(`[backfill] user_titles: ${rows.length} linhas lidas, ${canonical.size} títulos únicos.`);
  return canonical;
}

async function fetchExistingStates(
  db: Awaited<typeof import("@/server/db/client")>["db"],
  filterUserId: string | null,
): Promise<Map<string, StateRow>> {
  console.log("[backfill] Lendo user_title_state (Prisma)...");

  const rows = await db.userTitleState.findMany({
    where: filterUserId ? { userId: filterUserId } : undefined,
    select: { userId: true, tmdbId: true, mediaType: true, status: true },
  });

  const stateMap = new Map<string, StateRow>();
  for (const row of rows) {
    stateMap.set(key(row.userId, row.mediaType, row.tmdbId), {
      userId: row.userId,
      tmdbId: row.tmdbId,
      mediaType: row.mediaType as MediaType,
      status: row.status,
    });
  }

  console.log(`[backfill] user_title_state: ${stateMap.size} entradas encontradas.`);
  return stateMap;
}

function buildSyncList(
  canonical: Map<string, TitleRow>,
  states: Map<string, StateRow>,
  maxEntries: number,
): SyncEntry[] {
  const toSync: SyncEntry[] = [];

  for (const [k, row] of canonical) {
    if (toSync.length >= maxEntries) break;

    const existing = states.get(k);

    if (!existing) {
      toSync.push({
        userId: row.userId,
        tmdbId: row.tmdbId,
        mediaType: row.mediaType,
        reason: "missing",
        currentState: null,
        expectedStatus: row.status,
      });
    } else if (existing.status !== row.status) {
      toSync.push({
        userId: row.userId,
        tmdbId: row.tmdbId,
        mediaType: row.mediaType,
        reason: "divergent_status",
        currentState: existing.status,
        expectedStatus: row.status,
      });
    }
  }

  return toSync;
}

async function upsertOne(entry: SyncEntry): Promise<"ok" | "error"> {
  const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL;

  if (!BASE_URL) {
    console.error("[backfill] ERRO: NEXT_PUBLIC_APP_URL não definida. Este script requer o app rodando.");
    return "error";
  }

  const url = `${BASE_URL.replace(/\/$/, "")}/api/admin/backfill-title-state`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-secret": process.env.ADMIN_SECRET ?? "",
    },
    body: JSON.stringify({
      userId: entry.userId,
      tmdbId: entry.tmdbId,
      mediaType: entry.mediaType,
    }),
  });
  return res.ok ? "ok" : "error";
}

async function processBatch(entries: SyncEntry[]): Promise<{ ok: number; errors: number }> {
  let ok = 0;
  let errors = 0;

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(upsertOne));
    ok     += results.filter((r) => r === "ok").length;
    errors += results.filter((r) => r === "error").length;
  }

  return { ok, errors };
}

async function main() {
  const { db } = await import("@/server/db/client");
  const startedAt = Date.now();

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  BACKFILL: user_title_state ← user_titles (Prisma/MySQL)");
  console.log("═══════════════════════════════════════════════════════════");
  if (DRY_RUN)     console.log("  MODO: dry-run (nenhuma escrita será feita)");
  if (TARGET_USER) console.log(`  FILTRO: user_id = ${TARGET_USER}`);
  if (isFinite(MAX_SYNC)) console.log(`  LIMITE: ${MAX_SYNC} entradas`);
  console.log();

  const [canonical, states] = await Promise.all([
    fetchCanonicalTitles(db, TARGET_USER),
    fetchExistingStates(db, TARGET_USER),
  ]);

  const toSync = buildSyncList(canonical, states, isFinite(MAX_SYNC) ? MAX_SYNC : Infinity);

  const missing   = toSync.filter((e) => e.reason === "missing").length;
  const divergent = toSync.filter((e) => e.reason === "divergent_status").length;

  console.log();
  console.log("───────────────────────────────────────────────────────────");
  console.log(`  Total de títulos únicos em user_titles : ${canonical.size}`);
  console.log(`  Entradas em user_title_state           : ${states.size}`);
  console.log(`  Ausentes (missing)                     : ${missing}`);
  console.log(`  Divergentes (status diferente)         : ${divergent}`);
  console.log(`  Total a sincronizar                    : ${toSync.length}`);
  console.log("───────────────────────────────────────────────────────────");

  if (toSync.length === 0) {
    console.log("\n  Tudo sincronizado. Nenhuma ação necessária.");
    await db.$disconnect();
    return;
  }

  const sample = toSync.slice(0, 10);
  console.log("\n  Amostra (primeiras 10 entradas):");
  for (const e of sample) {
    const tag = e.reason === "missing" ? "AUSENTE  " : "DIVERGENTE";
    console.log(
      `    [${tag}] user=${e.userId.slice(0, 8)}… ${e.mediaType}:${e.tmdbId}` +
      (e.reason === "divergent_status"
        ? ` | state.status="${e.currentState}" ← titles.status="${e.expectedStatus}"`
        : ` | status="${e.expectedStatus}"`)
    );
  }
  if (toSync.length > 10) console.log(`    ... e mais ${toSync.length - 10} entradas.`);

  if (DRY_RUN) {
    console.log("\n  [dry-run] Nenhuma escrita realizada. Remova --dry-run para executar.");
    await db.$disconnect();
    return;
  }

  console.log(`\n  Sincronizando ${toSync.length} entradas (concorrência: ${CONCURRENCY})...`);
  const { ok, errors } = await processBatch(toSync);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log();
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Concluído em ${elapsed}s`);
  console.log(`  Sincronizados com sucesso : ${ok}`);
  console.log(`  Erros                     : ${errors}`);
  console.log("═══════════════════════════════════════════════════════════");

  await db.$disconnect();
  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[backfill] Erro fatal:", err);
  process.exit(1);
});
