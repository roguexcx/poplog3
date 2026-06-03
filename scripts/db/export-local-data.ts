/**
 * db:export — Exporta dados locais do MySQL/Prisma para JSON versionado.
 *
 * Gera: exports/poplog-export-YYYY-MM-DD-HH-mm.json
 *
 * Tabelas incluídas:
 *   User data  : users, user_titles, user_title_state, user_watching,
 *                user_episodes, user_ratings, user_title_feedback,
 *                user_events, user_curadoria_preferences,
 *                user_curadoria_signals, user_curadoria_state,
 *                user_streaming_preferences, hero_spotlight_sessions
 *   Auth.js    : accounts, sessions, verification_tokens
 *   Catálogo   : poplog3_titles, poplog3_episodes, title_seasons,
 *                title_external_ids, title_ratings, streaming_providers,
 *                catalog_availability
 *   Caches     : continuity_section_cache, ics_agenda_cache
 *
 * Tabelas omitidas (podem ser re-populadas / são apenas logs):
 *   engine_api_call_logs, api_usage_daily, poplog3_premium_api_usage,
 *   poplog3_title_availability, poplog3_availability_fallback_state,
 *   rating_aggregates
 *
 * Não exporta variáveis de ambiente, segredos ou .env.
 */

import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: ".env.local" });
dotenv.config();

const prisma = new PrismaClient();

// BigInt não é suportado nativamente pelo JSON.stringify
function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value;
}

function padded(n: number): string {
  return String(n).padStart(2, "0");
}

async function main() {
  const now = new Date();
  const ts = [
    now.getFullYear(),
    padded(now.getMonth() + 1),
    padded(now.getDate()),
    padded(now.getHours()),
    padded(now.getMinutes()),
  ].join("-");

  const filename = `poplog-export-${ts}.json`;
  const outputDir = path.resolve("exports");
  const outputPath = path.join(outputDir, filename);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log("[db:export] Iniciando exportação de dados locais...\n");

  const [
    users,
    accounts,
    sessions,
    verificationTokens,
    userTitles,
    userTitleState,
    userWatching,
    userEpisodes,
    userRatings,
    userTitleFeedback,
    userEvents,
    userCuradoriaPreferences,
    userCuradoriaSignals,
    userCuradoriaState,
    userStreamingPreferences,
    heroSpotlightSessions,
    poplog3Titles,
    poplog3Episodes,
    titleSeasons,
    titleExternalIds,
    titleRatings,
    streamingProviders,
    catalogAvailability,
    continuitySectionCache,
    icsAgendaCache,
  ] = await Promise.all([
    prisma.user.findMany(),
    prisma.account.findMany(),
    prisma.session.findMany(),
    prisma.verificationToken.findMany(),
    prisma.userTitle.findMany(),
    prisma.userTitleState.findMany(),
    prisma.userWatching.findMany(),
    prisma.userEpisode.findMany(),
    prisma.userRating.findMany(),
    prisma.userTitleFeedback.findMany(),
    prisma.userEvent.findMany(),
    prisma.userCuradoriaPreference.findMany(),
    prisma.userCuradoriaSignal.findMany(),
    prisma.userCuradoriaState.findMany(),
    prisma.userStreamingPreference.findMany(),
    prisma.heroSpotlightSession.findMany(),
    prisma.poplog3Title.findMany(),
    prisma.poplog3Episode.findMany(),
    prisma.titleSeason.findMany(),
    prisma.titleExternalId.findMany(),
    prisma.titleRating.findMany(),
    prisma.streamingProvider.findMany(),
    prisma.catalogAvailability.findMany(),
    prisma.continuitySectionCache.findMany(),
    prisma.icsAgendaCache.findMany(),
  ]);

  const tables = {
    users,
    accounts,
    sessions,
    verification_tokens: verificationTokens,
    user_titles: userTitles,
    user_title_state: userTitleState,
    user_watching: userWatching,
    user_episodes: userEpisodes,
    user_ratings: userRatings,
    user_title_feedback: userTitleFeedback,
    user_events: userEvents,
    user_curadoria_preferences: userCuradoriaPreferences,
    user_curadoria_signals: userCuradoriaSignals,
    user_curadoria_state: userCuradoriaState,
    user_streaming_preferences: userStreamingPreferences,
    hero_spotlight_sessions: heroSpotlightSessions,
    poplog3_titles: poplog3Titles,
    poplog3_episodes: poplog3Episodes,
    title_seasons: titleSeasons,
    title_external_ids: titleExternalIds,
    title_ratings: titleRatings,
    streaming_providers: streamingProviders,
    catalog_availability: catalogAvailability,
    continuity_section_cache: continuitySectionCache,
    ics_agenda_cache: icsAgendaCache,
  };

  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(tables)) {
    counts[k] = (v as unknown[]).length;
  }

  const payload = {
    schemaVersion: "1",
    exportedAt: now.toISOString(),
    app: "poplog-v3",
    tables,
    counts,
  };

  fs.writeFileSync(outputPath, JSON.stringify(payload, jsonReplacer, 2), "utf-8");

  const colW = 35;
  console.log("[db:export] Tabelas exportadas:");
  for (const [table, count] of Object.entries(counts)) {
    const label = table.padEnd(colW);
    console.log(`  ${label}: ${count} row${count !== 1 ? "s" : ""}`);
  }

  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`\n[db:export] Arquivo : ${outputPath}`);
  console.log(`[db:export] Tabelas : ${Object.keys(counts).length}`);
  console.log(`[db:export] Linhas  : ${totalRows}`);
  console.log(`\n[db:export] Exportação concluída.\n`);
}

main()
  .catch((err) => {
    console.error("[db:export] Erro fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
