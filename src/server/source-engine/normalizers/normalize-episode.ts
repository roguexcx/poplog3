import type { CatalogIds, CatalogEpisode } from "../types/catalog.types";
import type { SourceMeta } from "../types/source.types";

type NormalizeEpisodeInput = {
  ids: CatalogIds;
  season: number;
  number: number;
  title?: string;
  overview?: string;
  firstAired?: string;
  runtime?: number;
  stillRemoteUrl?: string;
};

export function normalizeEpisode(input: NormalizeEpisodeInput, meta: SourceMeta): CatalogEpisode {
  return {
    ids: input.ids,
    season: input.season,
    number: input.number,
    title: input.title,
    overview: input.overview,
    firstAired: input.firstAired,
    runtime: input.runtime,
    stillPath: input.stillRemoteUrl,
    source: { ...meta, fetchedAt: meta.fetchedAt ?? new Date().toISOString() },
  };
}
