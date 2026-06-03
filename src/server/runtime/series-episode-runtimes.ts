import type { EpisodeRuntimeInput } from "@/lib/runtime";
import { db } from "@/server/db/client";

export async function getSeriesEpisodeRuntimes(
  seriesTmdbId: number,
  options?: { includeUnaired?: boolean },
): Promise<EpisodeRuntimeInput[]> {
  const map = await getSeriesEpisodeRuntimesMap([seriesTmdbId], options);

  return map.get(seriesTmdbId) ?? [];
}

export async function getSeriesEpisodeRuntimesMap(
  seriesTmdbIds: number[],
  options?: { includeUnaired?: boolean },
): Promise<Map<number, EpisodeRuntimeInput[]>> {
  const ids = Array.from(
    new Set(
      seriesTmdbIds.filter((id) => Number.isFinite(id) && id > 0)
    )
  );

  const map = new Map<number, EpisodeRuntimeInput[]>();

  if (ids.length === 0) return map;

  const rows = await db.poplog3Episode.findMany({
    where: {
      seriesTmdbId: { in: ids },
      runtime: { not: null },
    },
    select: {
      seriesTmdbId: true,
      seasonNumber: true,
      episodeNumber: true,
      runtime: true,
      airDate: true,
    },
  });

  for (const row of rows) {
    const list = map.get(row.seriesTmdbId) ?? [];

    list.push({
      seasonNumber: row.seasonNumber,
      episodeNumber: row.episodeNumber,
      runtimeMinutes: row.runtime,
      aired: options?.includeUnaired ? true : undefined,
      airDate: row.airDate?.toISOString().slice(0, 10) ?? null,
    });

    map.set(row.seriesTmdbId, list);
  }

  return map;
}
