/**
 * Backfill: sincroniza user_title_state a partir de user_titles
 *
 * Lê todos os registros de user_titles, compara com user_title_state e
 * chama upsertTitleState() para entradas ausentes ou divergentes.
 * Totalmente idempotente — pode ser executado múltiplas vezes sem efeitos colaterais.
 *
 * Uso:
 *   npx tsx scripts/backfill-user-title-state.ts
 *   npx tsx scripts/backfill-user-title-state.ts --dry-run
 *   npx tsx scripts/backfill-user-title-state.ts --limit 100
 *   npx tsx scripts/backfill-user-title-state.ts --user-id abc123
 *
 * Requer: NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.
 * Carrega .env.local automaticamente se existir.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ── Carrega .env.local se existir ──────────────────────────────────────────────
function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

// ── CLI args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN   = args.includes("--dry-run");
const LIMIT_ARG = args.find((a) => a.startsWith("--limit="));
const USER_ARG  = args.find((a) => a.startsWith("--user-id="));
const LIMIT     = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1], 10) : Infinity;
const FILTER_USER = USER_ARG ? USER_ARG.split("=")[1] : null;

// Alternativa sem "=" para --limit 100 e --user-id abc
const limitIdx = args.indexOf("--limit");
const MAX_SYNC  = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : (isFinite(LIMIT) ? LIMIT : Infinity);
const userIdx   = args.indexOf("--user-id");
const TARGET_USER = FILTER_USER ?? (userIdx >= 0 ? args[userIdx + 1] : null);

const CONCURRENCY = 5;  // chamadas simultâneas a upsertTitleState
const PAGE_SIZE   = 500; // linhas por página ao ler user_titles

// ── Supabase Admin ─────────────────────────────────────────────────────────────
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("[backfill] ERRO: NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Tipos mínimos ──────────────────────────────────────────────────────────────
type MediaType = "movie" | "tv";

type TitleRow = {
  user_id: string;
  tmdb_id: number;
  media_type: MediaType;
  status: string | null;
};

type StateRow = {
  user_id: string;
  tmdb_id: number;
  media_type: MediaType;
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

// ── Helpers ────────────────────────────────────────────────────────────────────
function key(userId: string, mediaType: string, tmdbId: number) {
  return `${userId}:${mediaType}:${tmdbId}`;
}

async function fetchCanonicalTitles(filterUserId: string | null): Promise<Map<string, TitleRow>> {
  const canonical = new Map<string, TitleRow>();
  let offset = 0;
  let totalFetched = 0;

  console.log("[backfill] Lendo user_titles...");

  while (true) {
    let query = supabase
      .from("user_titles")
      .select("user_id, tmdb_id, media_type, status")
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (filterUserId) {
      query = query.eq("user_id", filterUserId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[backfill] Erro ao ler user_titles:", error.message);
      break;
    }

    if (!data || data.length === 0) break;

    for (const row of data as TitleRow[]) {
      const k = key(row.user_id, row.media_type, row.tmdb_id);
      if (!canonical.has(k)) {
        // Primeira entrada = mais recente (ordem DESC por created_at)
        canonical.set(k, row);
      }
    }

    totalFetched += data.length;
    offset += PAGE_SIZE;

    if (data.length < PAGE_SIZE) break;
  }

  console.log(`[backfill] user_titles: ${totalFetched} linhas lidas, ${canonical.size} títulos únicos.`);
  return canonical;
}

async function fetchExistingStates(filterUserId: string | null): Promise<Map<string, StateRow>> {
  const stateMap = new Map<string, StateRow>();
  let offset = 0;

  console.log("[backfill] Lendo user_title_state...");

  while (true) {
    let query = supabase
      .from("user_title_state")
      .select("user_id, tmdb_id, media_type, status")
      .range(offset, offset + PAGE_SIZE - 1);

    if (filterUserId) {
      query = query.eq("user_id", filterUserId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[backfill] Erro ao ler user_title_state:", error.message);
      break;
    }

    if (!data || data.length === 0) break;

    for (const row of data as StateRow[]) {
      stateMap.set(key(row.user_id, row.media_type, row.tmdb_id), row);
    }

    offset += PAGE_SIZE;
    if (data.length < PAGE_SIZE) break;
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
        userId:        row.user_id,
        tmdbId:        row.tmdb_id,
        mediaType:     row.media_type,
        reason:        "missing",
        currentState:  null,
        expectedStatus: row.status,
      });
    } else if (existing.status !== row.status) {
      toSync.push({
        userId:         row.user_id,
        tmdbId:         row.tmdb_id,
        mediaType:      row.media_type,
        reason:         "divergent_status",
        currentState:   existing.status,
        expectedStatus: row.status,
      });
    }
  }

  return toSync;
}

async function upsertOne(entry: SyncEntry): Promise<"ok" | "error"> {
  // upsertTitleState usa supabaseAdmin internamente — chamamos a API via fetch
  // para reutilizar a mesma lógica sem importar dependências Next.js no script.
  //
  // Alternativamente, recriamos a lógica mínima aqui usando o cliente admin.
  // Optamos pela forma inline para evitar dependências de bundle do Next.js.

  const now = new Date().toISOString();

  // Lê o status canônico atual de user_titles (mesma lógica de fetchLibraryEntry)
  const { data: libEntry } = await supabase
    .from("user_titles")
    .select("status, favorite, liked")
    .eq("user_id", entry.userId)
    .eq("tmdb_id", entry.tmdbId)
    .eq("media_type", entry.mediaType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const status   = (libEntry as Record<string,unknown> | null)?.status as string | null ?? null;
  const favorite = Boolean((libEntry as Record<string,unknown> | null)?.favorite);
  const liked    = (libEntry as Record<string,unknown> | null)?.liked as boolean | null ?? null;

  // Computed state simplificado para filmes (TV requer cálculo de episódios — upsertTitleState faz isso)
  // Para o script, passamos apenas os campos básicos; upsertTitleState calcula o resto.
  // Chamamos via HTTP se BASE_URL estiver definida, senão usamos escrita direta de fallback.

  const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL;

  if (BASE_URL) {
    // Modo HTTP: delega toda a lógica para a rota de backfill admin
    const url = `${BASE_URL.replace(/\/$/, "")}/api/admin/backfill-title-state`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-secret": process.env.ADMIN_SECRET ?? "",
      },
      body: JSON.stringify({
        userId:    entry.userId,
        tmdbId:    entry.tmdbId,
        mediaType: entry.mediaType,
      }),
    });
    return res.ok ? "ok" : "error";
  }

  // Modo direto: upsert mínimo em user_title_state sem computar progresso de TV.
  // Para séries TV, o upsertTitleState real é necessário — log um aviso.
  if (entry.mediaType === "tv") {
    console.warn(
      `[backfill] WARN: ${entry.userId}:tv:${entry.tmdbId} — progresso de TV requer ` +
      `NEXT_PUBLIC_APP_URL ou ADMIN_SECRET para cálculo completo. Atualizando apenas status.`
    );
  }

  const movieComputedState = (() => {
    if (!status) return null;
    if (status === "watchlist") return "watchlist";
    if (status === "watching")  return "in_progress";
    if (status === "watched")   return "watched";
    if (status === "abandoned") return "abandoned";
    if (status === "fridge")    return "fridge";
    return null;
  })();

  const row: Record<string, unknown> = {
    user_id:        entry.userId,
    tmdb_id:        entry.tmdbId,
    media_type:     entry.mediaType,
    status,
    favorite,
    liked,
    computed_state: entry.mediaType === "movie" ? movieComputedState : null,
    last_event_at:  now,
    updated_at:     now,
  };

  const { error } = await supabase
    .from("user_title_state")
    .upsert(row, { onConflict: "user_id,tmdb_id,media_type" });

  if (error) {
    console.error(`[backfill] Erro ao upsert ${entry.userId}:${entry.mediaType}:${entry.tmdbId}:`, error.message);
    return "error";
  }

  return "ok";
}

// ── Processador em lotes ───────────────────────────────────────────────────────
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

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = Date.now();

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  BACKFILL: user_title_state ← user_titles");
  console.log("═══════════════════════════════════════════════════════════");
  if (DRY_RUN)     console.log("  MODO: dry-run (nenhuma escrita será feita)");
  if (TARGET_USER) console.log(`  FILTRO: user_id = ${TARGET_USER}`);
  if (isFinite(MAX_SYNC)) console.log(`  LIMITE: ${MAX_SYNC} entradas`);
  console.log();

  // 1. Lê dados
  const [canonical, states] = await Promise.all([
    fetchCanonicalTitles(TARGET_USER),
    fetchExistingStates(TARGET_USER),
  ]);

  // 2. Determina o que precisa ser sincronizado
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
    return;
  }

  // 3. Exibe amostra do que seria feito
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
    return;
  }

  // 4. Executa sincronização
  console.log(`\n  Sincronizando ${toSync.length} entradas (concorrência: ${CONCURRENCY})...`);
  const { ok, errors } = await processBatch(toSync);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log();
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Concluído em ${elapsed}s`);
  console.log(`  Sincronizados com sucesso : ${ok}`);
  console.log(`  Erros                     : ${errors}`);
  console.log("═══════════════════════════════════════════════════════════");

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[backfill] Erro fatal:", err);
  process.exit(1);
});
