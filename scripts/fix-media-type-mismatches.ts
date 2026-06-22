/**
 * Repara itens da biblioteca com mediaType ERRADO — tipicamente FILMES salvos
 * como SÉRIE (cards mostram "Série sem título" e tipo "Série", e o link vai para
 * /title/tv/... embora o conteúdo seja um filme).
 *
 * Estratégia:
 *   1. Varre user_titles cujo título (via Poplog3Title) está vazio/técnico.
 *   2. Resolve o mediaType REAL na fonte (Trakt) de forma bidirecional
 *      (`resolveCanonicalMediaAndTitle`): tenta filme E série.
 *   3. Se o tipo detectado difere do salvo, corrige em:
 *        - poplog3Title (tmdbId, mediaType) + title
 *        - user_titles  (userId, tmdbId, mediaType)
 *        - user_title_state (userId, tmdbId, mediaType)
 *      Com proteção a conflito: se a linha-alvo já existe, pula e avisa.
 *
 * Uso:
 *   npx tsx scripts/fix-media-type-mismatches.ts                # dry-run
 *   npx tsx scripts/fix-media-type-mismatches.ts --apply        # aplica
 *   npx tsx scripts/fix-media-type-mismatches.ts --limit=100
 *
 * Requer DATABASE_URL e credenciais da fonte (Trakt) no ambiente.
 */

import { config } from "dotenv";

import { isTechnicalIdLike } from "@/lib/titles/display-title";
import {
  resolveCanonicalMediaAndTitle,
  type RecoverableTitleRow,
} from "@/server/titles/recover-canonical-title";
import { imdbIdFromSyntheticTmdbId, isSyntheticTmdbId } from "@/lib/ids/synthetic-tmdb-id";

config({ path: ".env.local" });
config({ path: ".env" });

const APPLY = process.argv.includes("--apply");
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1]) : undefined;

type MediaType = "movie" | "tv";

type Mismatch = {
  tmdbId: number;
  from: MediaType;
  to: MediaType;
  title: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { db } = await import("@/server/db/client");

  console.log(
    `[fix-media-type] modo: ${APPLY ? "APPLY (grava)" : "DRY-RUN"}${LIMIT ? ` | limite: ${LIMIT}` : ""}`,
  );

  // Linhas de biblioteca — fonte da verdade do que o usuário vê.
  const userTitles = await db.userTitle.findMany({
    select: { tmdbId: true, mediaType: true },
    ...(LIMIT ? { take: LIMIT } : {}),
  });

  // Pares únicos (tmdbId, mediaType) para não resolver o mesmo título N vezes.
  const pairs = new Map<string, { tmdbId: number; mediaType: MediaType }>();
  for (const ut of userTitles) {
    pairs.set(`${ut.mediaType}:${ut.tmdbId}`, {
      tmdbId: ut.tmdbId,
      mediaType: ut.mediaType as MediaType,
    });
  }

  // Carrega Poplog3Title correspondentes para checar título e payloads.
  const titleRows = await db.poplog3Title.findMany({
    where: { tmdbId: { in: [...new Set([...pairs.values()].map((p) => p.tmdbId))] } },
    select: {
      id: true, tmdbId: true, imdbId: true, traktId: true, slug: true,
      mediaType: true, title: true, originalTitle: true, tmdbPayload: true, sourcePayload: true,
    },
  });
  const titleByKey = new Map(titleRows.map((r) => [`${r.mediaType}:${r.tmdbId}`, r]));

  const mismatches: Mismatch[] = [];

  for (const [key, pair] of pairs) {
    const row = titleByKey.get(key);
    const ids = {
      tmdbId: pair.tmdbId,
      imdbId: row?.imdbId ?? (isSyntheticTmdbId(pair.tmdbId) ? imdbIdFromSyntheticTmdbId(pair.tmdbId) : null),
      traktId: row?.traktId != null ? String(row.traktId) : null,
      poplogId: row?.id ?? null,
      slug: row?.slug ?? null,
    };

    // Só investiga itens VISIVELMENTE quebrados (título técnico/vazio).
    if (!isTechnicalIdLike(row?.title ?? null, ids)) continue;

    const input: RecoverableTitleRow = {
      id: row?.id ?? null,
      tmdbId: pair.tmdbId,
      imdbId: ids.imdbId,
      traktId: row?.traktId ?? null,
      slug: row?.slug ?? null,
      mediaType: pair.mediaType,
      title: row?.title ?? null,
      originalTitle: row?.originalTitle ?? null,
      tmdbPayload: row?.tmdbPayload,
      sourcePayload: row?.sourcePayload,
    };

    const resolved = await resolveCanonicalMediaAndTitle(input);
    await sleep(120); // educado com a fonte

    if (resolved.title && resolved.mediaType && resolved.mediaType !== pair.mediaType) {
      mismatches.push({
        tmdbId: pair.tmdbId,
        from: pair.mediaType,
        to: resolved.mediaType,
        title: resolved.title,
      });
    }
  }

  console.log(`\n[fix-media-type] ${mismatches.length} divergência(s) de tipo encontradas:`);
  for (const m of mismatches) {
    console.log(`  [${m.from}→${m.to}] tmdb=${m.tmdbId} "${m.title}"`);
  }

  if (!APPLY) {
    console.log("\n[fix-media-type] DRY-RUN: nada gravado. Rode com --apply para corrigir.");
    await db.$disconnect();
    return;
  }

  const affectedUsers = new Set<string>();
  let fixed = 0;
  let skipped = 0;
  for (const m of mismatches) {
    try {
      // 1) Poplog3Title: move (tmdbId, from) → (tmdbId, to) + título.
      const targetTitle = await db.poplog3Title.findUnique({
        where: { tmdbId_mediaType: { tmdbId: m.tmdbId, mediaType: m.to } },
        select: { id: true, title: true },
      });
      if (targetTitle) {
        if (isTechnicalIdLike(targetTitle.title)) {
          await db.poplog3Title.update({ where: { id: targetTitle.id }, data: { title: m.title } });
        }
        // Remove a linha antiga (tipo errado) para não reaparecer.
        await db.poplog3Title
          .deleteMany({ where: { tmdbId: m.tmdbId, mediaType: m.from } })
          .catch(() => {});
      } else {
        await db.poplog3Title.updateMany({
          where: { tmdbId: m.tmdbId, mediaType: m.from },
          data: { mediaType: m.to, title: m.title },
        });
      }

      // 2) user_titles e 3) user_title_state: move por usuário, com anti-conflito.
      for (const table of ["userTitle", "userTitleState"] as const) {
        const rows = await (db[table] as typeof db.userTitle).findMany({
          where: { tmdbId: m.tmdbId, mediaType: m.from },
          select: { id: true, userId: true },
        });
        for (const r of rows) {
          affectedUsers.add(r.userId);
          const existsTarget = await (db[table] as typeof db.userTitle).findUnique({
            where: { userId_tmdbId_mediaType: { userId: r.userId, tmdbId: m.tmdbId, mediaType: m.to } },
            select: { id: true },
          });
          if (existsTarget) {
            // Usuário já tem o item no tipo correto → remove o duplicado errado.
            await (db[table] as typeof db.userTitle).delete({ where: { id: r.id } }).catch(() => {});
          } else {
            await (db[table] as typeof db.userTitle).update({
              where: { id: r.id },
              data: { mediaType: m.to },
            });
          }
        }
      }

      fixed++;
      if (fixed % 25 === 0) console.log(`  - corrigido ${fixed}/${mismatches.length}`);
    } catch (err) {
      skipped++;
      console.warn(`  ⚠ pulado tmdb=${m.tmdbId} (${m.from}→${m.to}):`, err instanceof Error ? err.message : err);
    }
  }

  // Invalida caches de seção (acompanhando / watchlist picks) para os usuários
  // afetados, senão o "O que ver primeiro?" continua servindo o payload antigo.
  if (affectedUsers.size > 0) {
    try {
      const { invalidateContinuitySectionCache } = await import(
        "@/server/continuity/continuity-section-cache"
      );
      for (const userId of affectedUsers) invalidateContinuitySectionCache(userId);
      console.log(`  - cache de continuidade invalidado p/ ${affectedUsers.size} usuário(s)`);
    } catch {
      /* cache em memória pode não estar disponível fora do servidor — ignora */
    }
  }

  console.log(
    [
      "",
      "[fix-media-type] CONCLUÍDO",
      `✓ Corrigidos: ${fixed}`,
      skipped > 0 ? `⚠ Pulados (conflito/erro): ${skipped}` : "✓ Sem conflitos",
    ].join("\n"),
  );

  await db.$disconnect();
}

main().catch((err) => {
  console.error("[fix-media-type] erro fatal", err);
  process.exitCode = 1;
});
