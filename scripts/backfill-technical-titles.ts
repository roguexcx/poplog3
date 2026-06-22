/**
 * Backfill: RECUPERA e persiste o título real de linhas de Poplog3Title cujo
 * campo `title` está vazio ou guarda um identificador técnico (tt..., tmdb:...,
 * traktId, poplogId/cuid, slug, tmdbId synthetic negativo, etc.).
 *
 * NÃO zera mais o campo às cegas. Para cada linha problemática roda a cadeia
 * CANÔNICA de recuperação (`recoverCanonicalTitle`):
 *   1. title existente válido
 *   2. name (payload)
 *   3. originalTitle
 *   4. originalName (payload)
 *   5. localizado pt-BR (payload)
 *   6. linha irmã (mesmo imdbId/tmdbId/traktId/poplogId)
 *   7. aliases/identity
 *   8. re-hidratação na fonte (tmdbId real / imdbId / traktId)
 *   9. só então mantém title = null
 *
 * Uso:
 *   npx tsx scripts/backfill-technical-titles.ts                # dry-run (não grava)
 *   npx tsx scripts/backfill-technical-titles.ts --no-rehydrate # dry-run só local (sem rede)
 *   npx tsx scripts/backfill-technical-titles.ts --apply        # aplica as correções
 *   npx tsx scripts/backfill-technical-titles.ts --limit=50     # processa no máx. N linhas
 *
 * Requer: DATABASE_URL no .env.local (ou .env).
 * A re-hidratação requer credenciais da fonte (Trakt) no ambiente.
 */

import { config } from "dotenv";

import { isTechnicalIdLike } from "@/lib/titles/display-title";
import {
  recoverCanonicalTitle,
  type RecoverableTitleRow,
  type TitleRecoverySource,
} from "@/server/titles/recover-canonical-title";

config({ path: ".env.local" });
config({ path: ".env" });

const APPLY = process.argv.includes("--apply");
const NO_REHYDRATE = process.argv.includes("--no-rehydrate");
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1]) : undefined;
const DEBUG_ARG = process.argv.find((a) => a.startsWith("--debug="));
const DEBUG_TMDB = DEBUG_ARG ? Number(DEBUG_ARG.split("=")[1]) : undefined;

type Repair = {
  id: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  oldTitle: string | null;
  newTitle: string | null;
  source: TitleRecoverySource;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fmtOld(v: string | null): string {
  return v === null || v === "" ? "null" : `"${v}"`;
}

async function main() {
  const { db } = await import("@/server/db/client");

  console.log(
    [
      `[backfill-titles] modo: ${APPLY ? "APPLY (grava)" : "DRY-RUN (não grava)"}`,
      `re-hidratação: ${NO_REHYDRATE ? "OFF (só local)" : "ON"}`,
      LIMIT ? `limite: ${LIMIT}` : "limite: nenhum",
    ].join(" | "),
  );

  const rows = await db.poplog3Title.findMany({
    select: {
      id: true,
      tmdbId: true,
      imdbId: true,
      traktId: true,
      slug: true,
      mediaType: true,
      title: true,
      originalTitle: true,
      tmdbPayload: true,
      sourcePayload: true,
    },
    ...(LIMIT ? { take: LIMIT } : {}),
  });

  // Apenas linhas cujo title é técnico/vazio.
  const candidates = rows.filter((row) =>
    isTechnicalIdLike(row.title, {
      tmdbId: row.tmdbId,
      imdbId: row.imdbId,
      traktId: row.traktId != null ? String(row.traktId) : null,
      poplogId: row.id,
      slug: row.slug,
    }),
  );

  console.log(
    `[backfill-titles] ${candidates.length} título(s) com ID técnico/vazio (de ${rows.length} varridos). Recuperando...`,
  );

  const repairs: Repair[] = [];

  for (const row of candidates) {
    const input: RecoverableTitleRow = {
      id: row.id,
      tmdbId: row.tmdbId,
      imdbId: row.imdbId,
      traktId: row.traktId,
      slug: row.slug,
      mediaType: row.mediaType as "movie" | "tv",
      title: row.title,
      originalTitle: row.originalTitle,
      tmdbPayload: row.tmdbPayload,
      sourcePayload: row.sourcePayload,
    };

    if (DEBUG_TMDB !== undefined && row.tmdbId === DEBUG_TMDB) {
      const pj = (p: unknown) => {
        if (!p) return null;
        const o = (typeof p === "string" ? JSON.parse(p) : p) as Record<string, unknown>;
        return { title: o.title, name: o.name, original_title: o.original_title, original_name: o.original_name, originalTitle: o.originalTitle, originalName: o.originalName };
      };
      console.log(`\n[DEBUG tmdb=${DEBUG_TMDB}] ───────────────────────────────`);
      console.log("  row.title        =", JSON.stringify(row.title));
      console.log("  row.originalTitle=", JSON.stringify(row.originalTitle));
      console.log("  row.imdbId       =", JSON.stringify(row.imdbId));
      console.log("  row.traktId      =", String(row.traktId));
      console.log("  row.slug         =", JSON.stringify(row.slug));
      console.log("  tmdbPayload keys =", JSON.stringify(pj(row.tmdbPayload)));
      console.log("  sourcePayload keys =", JSON.stringify(pj(row.sourcePayload)));
    }

    const result = await recoverCanonicalTitle(input, { rehydrate: !NO_REHYDRATE });

    if (DEBUG_TMDB !== undefined && row.tmdbId === DEBUG_TMDB) {
      console.log("  → recuperado     =", JSON.stringify(result.title), "| fonte:", result.source);
      console.log("[DEBUG] ───────────────────────────────\n");
    }

    repairs.push({
      id: row.id,
      tmdbId: row.tmdbId,
      mediaType: row.mediaType as "movie" | "tv",
      oldTitle: row.title,
      newTitle: result.title,
      source: result.source,
    });

    // Educado com a fonte quando há re-hidratação.
    if (!NO_REHYDRATE && (result.source === "rehydrate" || result.source === "identity")) {
      await sleep(120);
    }
  }

  const recovered = repairs.filter((r) => r.newTitle !== null);
  const stillNull = repairs.filter((r) => r.newTitle === null);

  const bySource = (s: TitleRecoverySource) => repairs.filter((r) => r.source === s).length;

  console.log(
    [
      "",
      "[backfill-titles] ANÁLISE",
      `- Títulos com ID técnico/vazio: ${repairs.length}`,
      `- Recuperáveis (nome real encontrado): ${recovered.length}`,
      `    · via payload local: ${bySource("payload") + bySource("existing") + bySource("original")}`,
      `    · via linha irmã: ${bySource("sibling")}`,
      `    · via aliases/identity: ${bySource("identity")}`,
      `    · via re-hidratação na fonte: ${bySource("rehydrate")}`,
      `- Sem nome utilizável (mantém null): ${stillNull.length}`,
    ].join("\n"),
  );

  console.log("\n[backfill-titles] PREVIEW:");
  for (const r of repairs.slice(0, 40)) {
    const arrow =
      r.newTitle === null ? "(mantém null → placeholder em runtime)" : `"${r.newTitle}"`;
    console.log(`  [${r.mediaType}] tmdb=${r.tmdbId} ${fmtOld(r.oldTitle)} → ${arrow} [${r.source}]`);
  }
  if (repairs.length > 40) console.log(`  ... +${repairs.length - 40} linhas`);

  if (!APPLY) {
    console.log(
      "\n[backfill-titles] DRY-RUN: nada gravado. Rode com --apply para persistir os títulos recuperados.",
    );
    await db.$disconnect();
    return;
  }

  // Aplica somente os títulos recuperados; não sobrescreve com null.
  let updated = 0;
  for (const r of recovered) {
    await db.poplog3Title.update({
      where: { id: r.id },
      data: { title: r.newTitle },
    });
    updated++;
    if (updated % 50 === 0) console.log(`  - aplicado ${updated}/${recovered.length}`);
  }

  console.log(
    [
      "",
      "[backfill-titles] CONCLUÍDO",
      `✓ Títulos recuperados e persistidos: ${updated}`,
      stillNull.length > 0
        ? `⚠ ${stillNull.length} linha(s) sem nome recuperável — mantidas como null (placeholder amigável + alvo de hidratação futura).`
        : "✓ Todas as linhas recuperadas",
    ].join("\n"),
  );

  await db.$disconnect();
}

main().catch((err) => {
  console.error("[backfill-titles] erro fatal", err);
  process.exitCode = 1;
});
