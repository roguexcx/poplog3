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
 *   - Escrita é sempre via supabaseAdmin (service_role) — RLS só permite leitura
 *     pública, nunca escrita pelo cliente.
 */

import { supabaseAdmin } from "@/server/supabase/admin";
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

/**
 * Códigos Postgres que indicam tabela inexistente (migration não aplicada).
 * Silencia o erro — a página renderiza sem dados de rating.
 */
function isTableMissingError(err: unknown): boolean {
  const e = err as Record<string, unknown> | null;
  if (!e) return false;
  if (e["code"] === "42P01") return true;
  const msg = String(e["message"] ?? "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation");
}

type AggregateInput = {
  mediaType: RatingMediaType;
  tmdbId: number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

type RatingRow = {
  rating: unknown;
  rating_source: unknown;
  user_id?: unknown;
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
  await supabaseAdmin
    .from("rating_aggregates")
    .delete()
    .eq("item_key", itemKey);
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
  const now = new Date().toISOString();

  const { error: upsertError } = await supabaseAdmin
    .from("rating_aggregates")
    .upsert(
      {
        media_type: mediaType,
        tmdb_id: tmdbId,
        season_number: seasonNumber,
        episode_number: episodeNumber,
        average_rating: avg(allRows),
        explicit_avg_rating: avg(explicitRows),
        rating_count: allRows.length,
        explicit_rating_count: explicitRows.length,
        inferred_rating_count: inferredRows.length,
        confidence_level: confidenceLevel(allRows.length),
        updated_at: now,
      },
      { onConflict: "item_key" }
    );

  if (upsertError) {
    console.error(
      "[rating-aggregate-service/upsertAggregateRow] upsert error",
      serializeError(upsertError)
    );
  }
}

async function recalculateTvAggregateWithEpisodeInferences(
  tmdbId: number
): Promise<void> {
  const itemKey = buildItemKey("tv", tmdbId, null, null);

  const [titleRatingsResult, episodeRatingsResult] = await Promise.all([
    supabaseAdmin
      .from("user_ratings")
      .select("user_id, rating, rating_source")
      .eq("media_type", "tv")
      .eq("tmdb_id", tmdbId)
      .is("season_number", null)
      .is("episode_number", null)
      .eq("is_public", true),
    supabaseAdmin
      .from("user_ratings")
      .select("user_id, rating")
      .eq("media_type", "episode")
      .eq("tmdb_id", tmdbId)
      .eq("is_public", true),
  ]);

  if (titleRatingsResult.error || episodeRatingsResult.error) {
    const error = titleRatingsResult.error ?? episodeRatingsResult.error;
    if (!isTableMissingError(error)) {
      console.error(
        "[rating-aggregate-service/recalculateTvAggregateWithEpisodeInferences] fetch error",
        serializeError(error)
      );
    }
    return;
  }

  const titleRows = (titleRatingsResult.data ?? []) as RatingRow[];
  const explicitTitleRows = titleRows.filter((r) =>
    explicitSources.has(r.rating_source as string)
  );
  const directTitleUserIds = new Set(
    titleRows.map((r) => String(r.user_id)).filter(Boolean)
  );

  const episodeRatingsByUser = new Map<string, number[]>();

  for (const row of episodeRatingsResult.data ?? []) {
    const userId = String(row.user_id ?? "");
    if (!userId || directTitleUserIds.has(userId)) continue;

    const rating = Number(row.rating);
    if (!Number.isFinite(rating)) continue;

    const ratings = episodeRatingsByUser.get(userId) ?? [];
    ratings.push(rating);
    episodeRatingsByUser.set(userId, ratings);
  }

  const inferredTitleRows = titleRows.filter(
    (r) => !explicitSources.has(r.rating_source as string)
  );
  const episodeInferredRows: RatingRow[] = Array.from(
    episodeRatingsByUser.values()
  ).map((ratings) => ({
      rating: ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length,
      rating_source: "inferred",
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

  const { data, error } = await supabaseAdmin
    .from("rating_aggregates")
    .select(
      "average_rating, explicit_avg_rating, rating_count, explicit_rating_count, inferred_rating_count, confidence_level"
    )
    .eq("item_key", itemKey)
    .maybeSingle();

  if (error) {
    if (!isTableMissingError(error)) {
      console.error(
        "[rating-aggregate-service/getPublicRating]",
        serializeError(error)
      );
    }
    return null;
  }

  if (!data) return null;

  return {
    averageRating:
      data.average_rating !== null ? Number(data.average_rating) : null,
    explicitAvgRating:
      data.explicit_avg_rating !== null
        ? Number(data.explicit_avg_rating)
        : null,
    ratingCount: Number(data.rating_count),
    explicitRatingCount: Number(data.explicit_rating_count),
    inferredRatingCount: Number(data.inferred_rating_count),
    confidenceLevel: (data.confidence_level as "low" | "medium" | "high") ?? "low",
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

  const { data, error } = await supabaseAdmin
    .from("rating_aggregates")
    .select(
      "item_key, average_rating, explicit_avg_rating, rating_count, explicit_rating_count, inferred_rating_count, confidence_level"
    )
    .in("item_key", keys);

  if (error) {
    if (!isTableMissingError(error)) {
      console.error(
        "[rating-aggregate-service/getPublicRatingsBatch]",
        serializeError(error)
      );
    }
    return new Map();
  }

  const result = new Map<string, CommunityRatingData>();

  for (const row of data ?? []) {
    result.set(String(row.item_key), {
      averageRating:
        row.average_rating !== null ? Number(row.average_rating) : null,
      explicitAvgRating:
        row.explicit_avg_rating !== null
          ? Number(row.explicit_avg_rating)
          : null,
      ratingCount: Number(row.rating_count),
      explicitRatingCount: Number(row.explicit_rating_count),
      inferredRatingCount: Number(row.inferred_rating_count),
      confidenceLevel:
        (row.confidence_level as "low" | "medium" | "high") ?? "low",
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

  // Busca todas as notas públicas do item — uma única query com filtros corretos
  let query = supabaseAdmin
    .from("user_ratings")
    .select("rating, rating_source")
    .eq("media_type", mediaType)
    .eq("tmdb_id", tmdbId)
    .eq("is_public", true);

  if (seasonNumber !== null) {
    query = query.eq("season_number", seasonNumber);
  } else {
    query = query.is("season_number", null);
  }

  if (episodeNumber !== null) {
    query = query.eq("episode_number", episodeNumber);
  } else {
    query = query.is("episode_number", null);
  }

  const { data, error: fetchError } = await query;

  if (fetchError) {
    if (!isTableMissingError(fetchError)) {
      console.error(
        "[rating-aggregate-service/recalculateAggregate] fetch error",
        serializeError(fetchError)
      );
    }
    return;
  }

  const allRows = data ?? [];
  const totalCount = allRows.length;

  if (totalCount === 0) {
    // Sem notas — limpa o agregado se existir
    await deleteAggregate(itemKey);
    return;
  }

  // Separa explícitas vs inferidas
  const explicitRows = allRows.filter((r) =>
    explicitSources.has(r.rating_source as string)
  );
  const inferredRows = allRows.filter(
    (r) => !explicitSources.has(r.rating_source as string)
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
