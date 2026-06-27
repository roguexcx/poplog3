/**
 * db:import — Importa dados de um export JSON para o MySQL local via Prisma.
 *
 * Modos:
 *   Seguro (padrão)  : createMany com skipDuplicates=true.
 *                      Não apaga dados existentes. Apenas adiciona novos registros.
 *   Substituição     : --replace --yes  →  apaga tudo e reinsere do arquivo.
 *                      DESTRUCTIVO. Exige confirmação explícita com --yes.
 *
 * Uso:
 *   npm run db:import
 *   npm run db:import -- --file exports/poplog-export-2026-06-03-10-00.json
 *   npm run db:import -- --replace --yes
 *   npm run db:import -- --replace --yes --file exports/poplog-export-...json
 *   npm run db:import -- --dry-run
 *
 * Limitações conhecidas:
 *   - Campos @updatedAt são sempre atualizados para o momento do import pelo Prisma.
 *     Timestamps originais de updatedAt NÃO são preservados.
 *   - Para restauração fiel de timestamps, use db:restore (SQL dump).
 */

import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: ".env.local" });
dotenv.config();

const prisma = new PrismaClient();

// ── CLI args ──────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const isReplace = argv.includes("--replace") || argv.includes("--force");
const isConfirmed = argv.includes("--yes") || argv.includes("-y");
const isDryRun = argv.includes("--dry-run");

const fileArgIndex = argv.findIndex((a) => a === "--file" || a === "-f");
const fileArgValue =
  fileArgIndex !== -1 ? argv[fileArgIndex + 1] : argv.find((a) => !a.startsWith("-"));

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExportPayload {
  schemaVersion: string;
  exportedAt: string;
  app: string;
  tables: Record<string, Record<string, unknown>[]>;
  counts: Record<string, number>;
}

// ── File resolution ───────────────────────────────────────────────────────────

function findLatestExport(): string | null {
  const dir = path.resolve("exports");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("poplog-export-") && f.endsWith(".json"))
    .sort()
    .reverse();
  return files.length > 0 ? path.join(dir, files[0]) : null;
}

function resolveFile(): string {
  if (fileArgValue) {
    const abs = path.resolve(fileArgValue);
    if (!fs.existsSync(abs)) {
      console.error(`[db:import] Arquivo não encontrado: ${abs}`);
      process.exit(1);
    }
    return abs;
  }
  const latest = findLatestExport();
  if (!latest) {
    console.error(
      "[db:import] Nenhum arquivo de export encontrado em exports/.\n" +
        "           Execute npm run db:export primeiro.",
    );
    process.exit(1);
  }
  return latest;
}

// ── BigInt helpers ────────────────────────────────────────────────────────────

// catalog_availability tem campos BigInt serializados como string no JSON
function toBigInt(v: unknown): bigint | null {
  if (v === null || v === undefined) return null;
  return BigInt(v as string | number);
}

function prepareCatalogAvailabilityRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...row,
    id: row.id != null ? toBigInt(row.id) : undefined,
    traktId: row.traktId != null ? toBigInt(row.traktId) : null,
    tmdbId: row.tmdbId != null ? toBigInt(row.tmdbId) : null,
  };
}

// ── Clear all (replace mode) ──────────────────────────────────────────────────

async function clearAll(): Promise<void> {
  console.log("[db:import] Apagando dados existentes (modo replace)...");
  // Ordem: tabelas dependentes antes das tabelas-pai (FK constraints)
  await prisma.$transaction(async (tx) => {
    await tx.continuitySectionCache.deleteMany();
    await tx.session.deleteMany();
    await tx.account.deleteMany();
    await tx.verificationToken.deleteMany();
    await tx.heroSpotlightSession.deleteMany();
    await tx.userStreamingPreference.deleteMany();
    await tx.userCuradoriaSignal.deleteMany();
    await tx.userCuradoriaState.deleteMany();
    await tx.userCuradoriaPreference.deleteMany();
    await tx.userTitleFeedback.deleteMany();
    await tx.userEvent.deleteMany();
    await tx.userRating.deleteMany();
    await tx.userEpisode.deleteMany();
    await tx.userTitleState.deleteMany(); // sem FK mas tem userId
    await tx.userTitle.deleteMany();
    await tx.user.deleteMany();
    // Catálogo (sem FK para users)
    await tx.catalogAvailability.deleteMany();
    await tx.titleRating.deleteMany();
    await tx.titleExternalId.deleteMany();
    await tx.titleSeason.deleteMany();
    await tx.poplog3Episode.deleteMany();
    await tx.poplog3Title.deleteMany();
    await tx.icsAgendaCache.deleteMany();
  });
  console.log("[db:import] Dados apagados.\n");
}

// ── Import helpers ────────────────────────────────────────────────────────────

type ImportResult = { attempted: number; inserted: number };

async function importTable(
  label: string,
  rows: Record<string, unknown>[],
  inserter: (data: Record<string, unknown>[]) => Promise<{ count: number }>,
): Promise<ImportResult> {
  if (rows.length === 0) {
    console.log(`  ${label.padEnd(35)}: 0 rows (vazio no export)`);
    return { attempted: 0, inserted: 0 };
  }

  if (isDryRun) {
    console.log(`  ${label.padEnd(35)}: ${rows.length} rows (dry-run, não inserido)`);
    return { attempted: rows.length, inserted: 0 };
  }

  const result = await inserter(rows);
  const msg =
    isReplace
      ? `${result.count} rows inseridos`
      : `${result.count} novos rows (${rows.length - result.count} já existiam)`;
  console.log(`  ${label.padEnd(35)}: ${msg}`);
  return { attempted: rows.length, inserted: result.count };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const filePath = resolveFile();
  console.log(`\n[db:import] Arquivo : ${filePath}`);

  const raw = fs.readFileSync(filePath, "utf-8");
  const payload = JSON.parse(raw) as ExportPayload;

  if (payload.app !== "poplog-v3") {
    console.error(`[db:import] Arquivo inválido: app="${payload.app}" (esperado: poplog-v3)`);
    process.exit(1);
  }
  if (payload.schemaVersion !== "1") {
    console.error(
      `[db:import] Versão de schema não suportada: ${payload.schemaVersion} (suportado: 1)`,
    );
    process.exit(1);
  }

  console.log(`[db:import] Schema  : v${payload.schemaVersion}`);
  console.log(`[db:import] Exportado em: ${payload.exportedAt}`);
  console.log(`[db:import] Modo    : ${isReplace ? "REPLACE (destrutivo)" : "seguro (skipDuplicates)"}`);
  if (isDryRun) console.log(`[db:import] Dry-run : SIM — nenhum dado será gravado\n`);

  if (isReplace && !isConfirmed) {
    console.error(
      "\n[db:import] ATENÇÃO: modo --replace apaga TODOS os dados do banco antes de importar.\n" +
        "           Passe --yes para confirmar:\n\n" +
        "             npm run db:import -- --replace --yes\n",
    );
    process.exit(1);
  }

  const { tables } = payload;

  if (isReplace && !isDryRun) {
    await clearAll();
  }

  console.log("[db:import] Importando tabelas...\n");

  const results: Record<string, ImportResult> = {};

  // ── User data (ordem: users primeiro, depois dependentes) ──────────────────

  results.users = await importTable("users", tables.users ?? [], (data) =>
    prisma.user.createMany({ data: data as Parameters<typeof prisma.user.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.accounts = await importTable("accounts", tables.accounts ?? [], (data) =>
    prisma.account.createMany({ data: data as Parameters<typeof prisma.account.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.sessions = await importTable("sessions", tables.sessions ?? [], (data) =>
    prisma.session.createMany({ data: data as Parameters<typeof prisma.session.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.verification_tokens = await importTable(
    "verification_tokens",
    tables.verification_tokens ?? [],
    (data) =>
      prisma.verificationToken.createMany({ data: data as Parameters<typeof prisma.verificationToken.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.streaming_providers = await importTable(
    "streaming_providers",
    tables.streaming_providers ?? [],
    (data) =>
      prisma.streamingProvider.createMany({ data: data as Parameters<typeof prisma.streamingProvider.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.user_titles = await importTable("user_titles", tables.user_titles ?? [], (data) =>
    prisma.userTitle.createMany({ data: data as Parameters<typeof prisma.userTitle.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.user_title_state = await importTable(
    "user_title_state",
    tables.user_title_state ?? [],
    (data) =>
      prisma.userTitleState.createMany({ data: data as Parameters<typeof prisma.userTitleState.createMany>[0]["data"], skipDuplicates: true }),
  );


  results.user_episodes = await importTable("user_episodes", tables.user_episodes ?? [], (data) =>
    prisma.userEpisode.createMany({ data: data as Parameters<typeof prisma.userEpisode.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.user_ratings = await importTable("user_ratings", tables.user_ratings ?? [], (data) =>
    prisma.userRating.createMany({ data: data as Parameters<typeof prisma.userRating.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.user_title_feedback = await importTable(
    "user_title_feedback",
    tables.user_title_feedback ?? [],
    (data) =>
      prisma.userTitleFeedback.createMany({ data: data as Parameters<typeof prisma.userTitleFeedback.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.user_events = await importTable("user_events", tables.user_events ?? [], (data) =>
    prisma.userEvent.createMany({ data: data as Parameters<typeof prisma.userEvent.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.user_curadoria_preferences = await importTable(
    "user_curadoria_preferences",
    tables.user_curadoria_preferences ?? [],
    (data) =>
      prisma.userCuradoriaPreference.createMany({ data: data as Parameters<typeof prisma.userCuradoriaPreference.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.user_curadoria_signals = await importTable(
    "user_curadoria_signals",
    tables.user_curadoria_signals ?? [],
    (data) =>
      prisma.userCuradoriaSignal.createMany({ data: data as Parameters<typeof prisma.userCuradoriaSignal.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.user_curadoria_state = await importTable(
    "user_curadoria_state",
    tables.user_curadoria_state ?? [],
    (data) =>
      prisma.userCuradoriaState.createMany({ data: data as Parameters<typeof prisma.userCuradoriaState.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.user_streaming_preferences = await importTable(
    "user_streaming_preferences",
    tables.user_streaming_preferences ?? [],
    (data) =>
      prisma.userStreamingPreference.createMany({ data: data as Parameters<typeof prisma.userStreamingPreference.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.hero_spotlight_sessions = await importTable(
    "hero_spotlight_sessions",
    tables.hero_spotlight_sessions ?? [],
    (data) =>
      prisma.heroSpotlightSession.createMany({ data: data as Parameters<typeof prisma.heroSpotlightSession.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.continuity_section_cache = await importTable(
    "continuity_section_cache",
    tables.continuity_section_cache ?? [],
    (data) =>
      prisma.continuitySectionCache.createMany({ data: data as Parameters<typeof prisma.continuitySectionCache.createMany>[0]["data"], skipDuplicates: true }),
  );

  // ── Catálogo ───────────────────────────────────────────────────────────────

  results.poplog3_titles = await importTable(
    "poplog3_titles",
    tables.poplog3_titles ?? [],
    (data) =>
      prisma.poplog3Title.createMany({ data: data as Parameters<typeof prisma.poplog3Title.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.poplog3_episodes = await importTable(
    "poplog3_episodes",
    tables.poplog3_episodes ?? [],
    (data) =>
      prisma.poplog3Episode.createMany({ data: data as Parameters<typeof prisma.poplog3Episode.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.title_seasons = await importTable(
    "title_seasons",
    tables.title_seasons ?? [],
    (data) =>
      prisma.titleSeason.createMany({ data: data as Parameters<typeof prisma.titleSeason.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.title_external_ids = await importTable(
    "title_external_ids",
    tables.title_external_ids ?? [],
    (data) =>
      prisma.titleExternalId.createMany({ data: data as Parameters<typeof prisma.titleExternalId.createMany>[0]["data"], skipDuplicates: true }),
  );

  results.title_ratings = await importTable(
    "title_ratings",
    tables.title_ratings ?? [],
    (data) =>
      prisma.titleRating.createMany({ data: data as Parameters<typeof prisma.titleRating.createMany>[0]["data"], skipDuplicates: true }),
  );

  // catalog_availability tem campos BigInt — conversão necessária
  const catalogRows = (tables.catalog_availability ?? []).map(
    prepareCatalogAvailabilityRow,
  );
  results.catalog_availability = await importTable(
    "catalog_availability",
    catalogRows,
    (data) =>
      prisma.catalogAvailability.createMany({ data: data as Parameters<typeof prisma.catalogAvailability.createMany>[0]["data"], skipDuplicates: true }),
  );

  // ── Caches ─────────────────────────────────────────────────────────────────

  results.ics_agenda_cache = await importTable(
    "ics_agenda_cache",
    tables.ics_agenda_cache ?? [],
    (data) =>
      prisma.icsAgendaCache.createMany({ data: data as Parameters<typeof prisma.icsAgendaCache.createMany>[0]["data"], skipDuplicates: true }),
  );

  // ── Sumário ────────────────────────────────────────────────────────────────

  const totalAttempted = Object.values(results).reduce((a, r) => a + r.attempted, 0);
  const totalInserted = Object.values(results).reduce((a, r) => a + r.inserted, 0);

  console.log(`\n[db:import] Total tentados : ${totalAttempted}`);
  console.log(`[db:import] Total inseridos : ${totalInserted}`);

  if (isDryRun) {
    console.log("\n[db:import] Dry-run concluído. Nenhum dado foi gravado.\n");
  } else {
    console.log("\n[db:import] Import concluído.\n");
    if (!isReplace) {
      console.log(
        "  Nota: campos @updatedAt foram atualizados para o momento do import.\n" +
          "  Para restaurar timestamps originais, use: npm run db:restore\n",
      );
    }
  }
}

main()
  .catch((err) => {
    console.error("[db:import] Erro fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
