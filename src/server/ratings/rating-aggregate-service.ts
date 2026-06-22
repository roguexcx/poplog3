/**
 * rating-aggregate-service.ts
 *
 * Calcula e persiste as médias públicas da comunidade POPLOG
 * na tabela rating_aggregates.
 *
 * Regras:
 *   - Apenas notas públicas (is_public = true) entram nos agregados.
 *   - explicit_avg_rating = média só das notas 'explicit' e 'imported'.
 *   - average_rating = média de todas as notas públicas (inclui inferidas).
 *   - confidence_level: low < 5 votos | medium 5-49 | high >= 50.
 *   - Escrita/leitura via Prisma local.
 */

import { db } from "@/server/db/client";
import type { RatingMediaType, CommunityRatingData } from "@/types/user";

export type { RatingMediaType, CommunityRatingData };

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Serializa um PostgrestError para string legível.
 * O spread {...error} é vazio porque PostgrestError usa getters não-enumeráveis.
 */
function serializeError(err: unknown): string {
  if (!err) return String(err);
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  const e = err as Record<string, unknown>;
  const parts: string[] = [];
  if (e["message"]) parts.push(String(e["message"]));
  if (e["code"]) parts.push(`code=${String(e["code"])}`);
  if (e["details"]) parts.push(`details=${String(e["details"])}`);
  if (e["hint"]) parts.push(`hint=${String(e["hint"])}`);
  return parts.length > 0 ? parts.join(" | ") : JSON.stringify(err);
}

type AggregateInput = {
  mediaType: RatingMediaType;
  tmdbId: number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

type RatingRow = {
  rating: unknown;
  ratingSource: unknown;
  userId?: unknown;
};

function confidenceLevel(count: number): "low" | "medium" | "high" {
  if (count >= 50) return "high";
  if (count >= 5) return "medium";
  return "low";
}

function buildItemKey(
  mediaType: RatingMediaType,
  tmdbId: number,
  seasonNumber?: number | null,
  episodeNumber?: number | null
): string {
  return (
    `${mediaType}:${tmdbId}` +
    `:${seasonNumber ?? ""}` +
    `:${episodeNumber ?? ""}`
  );
}

const explicitSources = new Set(["explicit", "imported"]);

function avg(rows: Array<{ rating: unknown }>) {
  return rows.length === 0
    ? null
    : Math.round(
        (rows.reduce((s, r) => s + Number(r.rating), 0) / rows.length) * 100
      ) / 100;
}

async function deleteAggregate(itemKey: string): Promise<void> {
  await db.ratingAggregate.deleteMany({ where: { itemKey } });
}

async function upsertAggregateRow({
  mediaType,
  tmdbId,
  seasonNumber,
  episodeNumber,
  allRows,
  explicitRows,
  inferredRows,
}: {
  mediaType: RatingMediaType;
  tmdbId: number;
  seasonNumber: number | null;
  episodeNumber: number | null;
  allRows: RatingRow[];
  explicitRows: RatingRow[];
  inferredRows: RatingRow[];
}): Promise<void> {
  try {
    const itemKey = buildItemKey(mediaType, tmdbId, seasonNumber, episodeNumber);
    await db.ratingAggregate.upsert({
      where: { itemKey },
      update: {
        mediaType,
        tmdbId,
        seasonNumber,
        episodeNumber,
        averageRating: avg(allRows),
        explicitAvgRating: avg(explicitRows),
        ratingCount: allRows.length,
        explicitRatingCount: explicitRows.length,
        inferredRatingCount: inferredRows.length,
        confidenceLevel: confidenceLevel(allRows.length),
      },
      create: {
        mediaType,
        tmdbId,
        seasonNumber,
        episodeNumber,
        itemKey,
        averageRating: avg(allRows),
        explicitAvgRating: avg(explicitRows),
        ratingCount: allRows.length,
        explicitRatingCount: explicitRows.length,
        inferredRatingCount: inferredRows.length,
        confidenceLevel: confidenceLevel(allRows.length),
      },
    });
  } catch (error) {
    console.error(
      "[rating-aggregate-service/upsertAggregateRow] upsert error",
      serializeError(error)
    );
  }
}

async function recalculateTvAggregateWithEpisodeInferences(
  tmdbId: number
): Promise<void> {
  const itemKey = buildItemKey("tv", tmdbId, null, null);

  const [titleRows, episodeRatings] = await Promise.all([
    db.userRating.findMany({
      where: {
        mediaType: "tv",
        tmdbId,
        seasonNumber: null,
        episodeNumber: null,
        isPublic: true,
      },
      select: {
        userId: true,
        rating: true,
        ratingSource: true,
      },
    }),
    db.userRating.findMany({
      where: {
        mediaType: "episode",
        tmdbId,
        isPublic: true,
      },
      select: {
        userId: true,
        rating: true,
      },
    }),
  ]);
  const explicitTitleRows = titleRows.filter((r) =>
    explicitSources.has(r.ratingSource as string)
  );
  const directTitleUserIds = new Set(
    titleRows.map((r) => String(r.userId)).filter(Boolean)
  );

  const episodeRatingsByUser = new Map<string, number[]>();

  for (const row of episodeRatings) {
    const userId = String(row.userId ?? "");
    if (!userId || directTitleUserIds.has(userId)) continue;

    const rating = Number(row.rating);
    if (!Number.isFinite(rating)) continue;

    const ratings = episodeRatingsByUser.get(userId) ?? [];
    ratings.push(rating);
    episodeRatingsByUser.set(userId, ratings);
  }

  const inferredTitleRows = titleRows.filter(
    (r) => !explicitSources.has(r.ratingSource as string)
  );
  const episodeInferredRows: RatingRow[] = Array.from(
    episodeRatingsByUser.values()
  ).map((ratings) => ({
      rating: ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length,
      ratingSource: "inferred",
    }));
  const inferredRows = [...inferredTitleRows, ...episodeInferredRows];

  const allRows = [...titleRows, ...episodeInferredRows];

  if (allRows.length === 0) {
    await deleteAggregate(itemKey);
    return;
  }

  await upsertAggregateRow({
    mediaType: "tv",
    tmdbId,
    seasonNumber: null,
    episodeNumber: null,
    allRows,
    explicitRows: explicitTitleRows,
    inferredRows,
  });
}

// ── Leitura ───────────────────────────────────────────────────────────────────

/**
 * Retorna o agregado público de um item.
 * Retorna null se ainda não existe nenhuma avaliação registrada.
 */
export async function getPublicRating(
  mediaType: RatingMediaType,
  tmdbId: number,
  seasonNumber?: number | null,
  episodeNumber?: number | null
): Promise<CommunityRatingData | null> {
  const itemKey = buildItemKey(mediaType, tmdbId, seasonNumber, episodeNumber);

  const data = await db.ratingAggregate.findUnique({ where: { itemKey } });

  if (!data) return null;

  return {
    averageRating:
      data.averageRating !== null ? Number(data.averageRating) : null,
    explicitAvgRating:
      data.explicitAvgRating !== null
        ? Number(data.explicitAvgRating)
        : null,
    ratingCount: data.ratingCount,
    explicitRatingCount: data.explicitRatingCount,
    inferredRatingCount: data.inferredRatingCount,
    confidenceLevel: data.confidenceLevel,
  };
}

/**
 * Leitura em lote de agregados — para páginas com múltiplos cards.
 * Retorna Map keyed por item_key.
 */
export async function getPublicRatingsBatch(
  items: Array<{
    mediaType: RatingMediaType;
    tmdbId: number;
    seasonNumber?: number | null;
    episodeNumber?: number | null;
  }>
): Promise<Map<string, CommunityRatingData>> {
  if (items.length === 0) return new Map();

  const keys = items.map((i) =>
    buildItemKey(i.mediaType, i.tmdbId, i.seasonNumber, i.episodeNumber)
  );

  const data = await db.ratingAggregate.findMany({
    where: {
      itemKey: { in: keys },
    },
  });

  const result = new Map<string, CommunityRatingData>();

  for (const row of data ?? []) {
    result.set(row.itemKey, {
      averageRating:
        row.averageRating !== null ? Number(row.averageRating) : null,
      explicitAvgRating:
        row.explicitAvgRating !== null
          ? Number(row.explicitAvgRating)
          : null,
      ratingCount: row.ratingCount,
      explicitRatingCount: row.explicitRatingCount,
      inferredRatingCount: row.inferredRatingCount,
      confidenceLevel: row.confidenceLevel,
    });
  }

  return result;
}

// ── Recálculo ─────────────────────────────────────────────────────────────────

/**
 * Recalcula o agregado público de um item a partir das notas individuais
 * dos usuários e persiste o resultado em rating_aggregates.
 *
 * Chamado automaticamente após cada upsert/delete em user_ratings.
 */
export async function recalculateAggregate(
  input: AggregateInput
): Promise<void> {
  const { mediaType, tmdbId, seasonNumber = null, episodeNumber = null } = input;

  const itemKey = buildItemKey(mediaType, tmdbId, seasonNumber, episodeNumber);

  if (mediaType === "tv" && seasonNumber === null && episodeNumber === null) {
    await recalculateTvAggregateWithEpisodeInferences(tmdbId);
    return;
  }

  const allRows = await db.userRating.findMany({
    where: {
      mediaType,
      tmdbId,
      seasonNumber,
      episodeNumber,
      isPublic: true,
    },
    select: {
      rating: true,
      ratingSource: true,
    },
  });
  const totalCount = allRows.length;

  if (totalCount === 0) {
    // Sem notas — limpa o agregado se existir
    await deleteAggregate(itemKey);
    return;
  }

  // Separa explícitas vs inferidas
  const explicitRows = allRows.filter((r) =>
    explicitSources.has(r.ratingSource as string)
  );
  const inferredRows = allRows.filter(
    (r) => !explicitSources.has(r.ratingSource as string)
  );

  await upsertAggregateRow({
    mediaType,
    tmdbId,
    seasonNumber,
    episodeNumber,
    allRows: allRows as RatingRow[],
    explicitRows: explicitRows as RatingRow[],
    inferredRows: inferredRows as RatingRow[],
  });
}
