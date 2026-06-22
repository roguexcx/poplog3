/**
 * /api/admin/availability-reset
 *
 * Ferramenta de manutencao: invalida registros stale de catalog_availability
 * para titulos especificos, forcando nova hidratacao via Balloonerismm na proxima
 * carga da biblioteca.
 *
 * Casos de uso:
 *   - Titulos com imdbId recem-resolvido que tinham sentinela __none__ no cache
 *   - Registros vazios/incorretos gravados antes de correcoes no pipeline
 *
 * NAO apaga: biblioteca do usuario, estados pessoais, poplog3_titles, title_external_ids.
 * Apaga APENAS: linhas em catalog_availability (cache global de disponibilidade).
 *
 * Auth: header x-admin-secret = env ADMIN_SECRET
 *
 * GET  /api/admin/availability-reset   -> apenas mostra o estado atual
 * POST /api/admin/availability-reset   -> body { imdbIds?: string[], titles?: string[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { getTitleAvailability } from "@/server/availability";

function isAuthorized(req: Request): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return process.env.NODE_ENV === "development";
  return req.headers.get("x-admin-secret") === secret;
}

// Resolve imdbIds:
//   - Se imdbIdsDirect tiver entradas, usa APENAS eles (busca textual desabilitada).
//     Evita falsos positivos ao buscar por "House" (inclui Housemaid, Hack House, etc.)
//   - Se imdbIdsDirect estiver vazio, busca por titleKeywords em poplog3_titles.
async function resolveImdbIds(
  imdbIdsDirect: string[],
  titleKeywords: string[],
): Promise<{ imdbId: string; title: string | null; source: string }[]> {
  const results: { imdbId: string; title: string | null; source: string }[] = [];

  // Modo ID direto: sem busca textual (evita falsos positivos)
  if (imdbIdsDirect.length > 0) {
    for (const id of imdbIdsDirect) {
      if (/^tt\d+$/.test(id)) {
        results.push({ imdbId: id, title: null, source: "direct" });
      }
    }
    return results;
  }

  // Modo busca por nome: apenas quando imdbIds nao foi fornecido
  for (const keyword of titleKeywords) {
    const rows = await db.poplog3Title.findMany({
      where: { title: { contains: keyword } },
      select: { tmdbId: true, mediaType: true, title: true, imdbId: true },
      take: 5,
    });
    for (const row of rows) {
      let imdbId = row.imdbId ?? null;
      // Fallback: title_external_ids
      if (!imdbId) {
        const ext = await db.titleExternalId.findUnique({
          where: { tmdbId_mediaType: { tmdbId: row.tmdbId, mediaType: row.mediaType } },
          select: { imdbId: true },
        });
        imdbId = ext?.imdbId ?? null;
      }
      if (imdbId) {
        results.push({ imdbId, title: row.title, source: `db:tmdb=${row.tmdbId}` });
      } else {
        results.push({ imdbId: `UNRESOLVED:tmdb=${row.tmdbId}`, title: row.title, source: "no-imdbid" });
      }
    }
  }

  return results;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Por padrao, inspeciona os 3 titulos problematicos conhecidos
  const defaultTitles = ["Flight Attendant", "Ghosts", "House"];
  const resolved = await resolveImdbIds([], defaultTitles);

  const inspection = await Promise.all(
    resolved.map(async ({ imdbId, title, source }) => {
      if (imdbId.startsWith("UNRESOLVED")) {
        return { imdbId, title, source, catalogRows: [], status: "imdbId-missing" };
      }
      const rows = await db.catalogAvailability.findMany({
        where: { imdbId },
        select: {
          providerName: true, providerRegion: true, providerType: true,
          source: true, sourceConfidence: true, checkedAt: true, expiresAt: true,
        },
        orderBy: { checkedAt: "desc" },
        take: 10,
      });
      const now = new Date();
      const freshRows = rows.filter((r) => r.expiresAt > now);
      const isNegativeSentinel = freshRows.length === 1 && freshRows[0].providerName === "__none__";
      const hasFreshProviders = freshRows.some((r) => r.providerName !== "__none__");
      let status: string;
      if (hasFreshProviders) {
        status = "ok";
      } else if (isNegativeSentinel) {
        status = "negative-sentinel";
      } else if (freshRows.length === 0) {
        status = "cache-miss";
      } else {
        status = "unknown";
      }
      return {
        imdbId, title, source,
        totalRows: rows.length,
        freshRows: freshRows.length,
        status,
        rows: rows.slice(0, 5).map((r) => ({
          provider: r.providerName,
          region: r.providerRegion,
          type: r.providerType,
          fresh: r.expiresAt > now,
          expiresAt: r.expiresAt.toISOString(),
        })),
      };
    }),
  );

  return NextResponse.json({ inspection, message: "POST to reset cache for these titles" });
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { imdbIds?: unknown; titles?: unknown; warm?: unknown };
  const imdbIdsDirect: string[] = Array.isArray(body.imdbIds) ? (body.imdbIds as string[]) : [];
  // Quando imdbIds for fornecido, nao usa busca textual (evita falsos positivos).
  // Quando apenas titles for fornecido, busca por nome.
  // Padrao (nenhum dos dois): usa os 3 titulos problematicos por nome.
  const titleKeywords: string[] =
    imdbIdsDirect.length > 0 ? [] :
    Array.isArray(body.titles) ? (body.titles as string[]) :
    ["Flight Attendant", "Ghosts", "House"];

  const resolved = await resolveImdbIds(imdbIdsDirect, titleKeywords);
  const actionable = resolved.filter((r) => !r.imdbId.startsWith("UNRESOLVED"));

  // Re-warm (fire getTitleAvailability) RECRIA o cache — inclusive a sentinela __none__
  // quando o Balloonerismm vem vazio. Para depurar o fallback live precisamos deixar o
  // cache LIMPO. Por isso: com imdbIds explícitos, NÃO re-aquece por padrão (assim o
  // próximo teste com force_live bate em cache-miss e aciona Balloonerismm + JustWatch).
  // Use body.warm === true para forçar o re-aquecimento (comportamento legado).
  const shouldWarm = body.warm === true ? true : imdbIdsDirect.length === 0;

  const deleted: {
    imdbId: string;
    title: string | null;
    deletedRows: number;
    negativeSentinelsRemoved: number;
  }[] = [];
  const errors: { imdbId: string; error: string }[] = [];

  for (const { imdbId, title } of actionable) {
    try {
      // Conta as sentinelas negativas antes de apagar (para o relatório do reset).
      const negativeSentinelsRemoved = await db.catalogAvailability.count({
        where: { imdbId, providerName: "__none__" },
      });
      // Apaga APENAS linhas de catalog_availability (todas as regiões/sources, inclusive
      // __none__) — nao toca em biblioteca, usuarios, poplog3_titles ou external_ids.
      const result = await db.catalogAvailability.deleteMany({ where: { imdbId } });
      deleted.push({ imdbId, title, deletedRows: result.count, negativeSentinelsRemoved });
    } catch (err) {
      errors.push({ imdbId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Re-aquecimento opcional (NÃO ocorre com imdbIds explícitos por padrão — ver acima).
  if (shouldWarm) {
    for (const { imdbId } of actionable) {
      void getTitleAvailability({
        mediaType: "tv",
        imdbId,
        region: "BR",
        cacheOnly: false,
        skipReleaseDates: true,
        bypassNegativeCache: true,
      }).catch(() => undefined);
    }
  }

  return NextResponse.json({
    deleted,
    errors,
    unresolved: resolved.filter((r) => r.imdbId.startsWith("UNRESOLVED")),
    warmTriggered: shouldWarm ? actionable.length : 0,
    rewarmed: shouldWarm,
    message: shouldWarm
      ? "Cache invalidado. Warm background disparado. Recarregue a biblioteca em ~5s."
      : "Cache invalidado (sentinelas __none__ removidas). SEM re-warm — teste agora com ?debug=1&force_live=1 para acionar Balloonerismm + JustWatch.",
  });
}
