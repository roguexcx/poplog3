/**
 * Normalização, deduplicação e agrupamento de entidades de busca.
 *
 * Converte os formatos das fontes (CatalogTitle / CatalogSearchResult do
 * source-engine e PersonSearchResult do Balloonerismm) para PoplogSearchEntity,
 * usando os helpers canônicos de link (buildTitleHref / buildPersonHref).
 */

import { buildTitleHref } from "@/lib/title-href";
import { buildPersonHref } from "@/lib/routes/person";
import type {
  CatalogTitle,
  CatalogSearchResult,
} from "@/server/source-engine/types/catalog.types";
import type { PersonSearchResult } from "@/server/source-engine/engine";
import type {
  PoplogSearchEntity,
  PoplogSearchEntityType,
} from "./types";

function mediaTypeToEntity(mediaType: "movie" | "show"): "movie" | "tv" {
  return mediaType === "show" ? "tv" : "movie";
}

function yearFromDate(date: string | null | undefined): number | null {
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) && year > 1800 ? year : null;
}

function sourceFlags(primary: string | undefined): PoplogSearchEntity["sources"] {
  if (primary === "trakt") return { trakt: true };
  if (primary === "balloonerismm") return { balloonerismm: true };
  return {};
}

function stableTitleId(input: {
  imdbId?: string | null;
  traktId?: number | string | null;
  tmdbId?: number | null;
  slug?: string | null;
  type: PoplogSearchEntityType;
  label: string;
  year?: number | null;
}): string {
  return (
    input.imdbId ??
    (input.traktId != null ? `trakt:${input.traktId}` : null) ??
    (input.tmdbId != null ? `tmdb:${input.tmdbId}` : null) ??
    input.slug ??
    `${input.type}:${input.label.toLowerCase()}:${input.year ?? ""}`
  );
}

// ─── Normalizadores ───────────────────────────────────────────────────────────

export function titleResultToEntity(item: CatalogSearchResult): PoplogSearchEntity {
  const type = mediaTypeToEntity(item.mediaType);
  const imdbId = item.ids.imdbId ?? null;
  const tmdbId = item.ids.tmdbId ?? null;
  const traktId = item.ids.traktId ?? null;
  const slug = item.ids.traktSlug ?? item.ids.slug ?? null;
  const year =
    item.year ?? yearFromDate(item.releaseDate) ?? yearFromDate(item.firstAirDate);
  const href = buildTitleHref({
    mediaType: type,
    externalIds: { imdbId, slug, traktId, tmdbId },
  });

  return {
    type,
    id: stableTitleId({ imdbId, traktId, tmdbId, slug, type, label: item.title, year }),
    title: item.title,
    originalTitle: item.originalTitle ?? null,
    year,
    overview: item.overview ?? null,
    posterUrl: item.posterPath ?? null,
    href,
    externalIds: { imdbId, tmdbId, traktId, traktSlug: item.ids.traktSlug ?? null },
    sources: sourceFlags(item.source?.primary),
  };
}

export function catalogTitleToEntity(item: CatalogTitle): PoplogSearchEntity {
  const type = mediaTypeToEntity(item.mediaType);
  const imdbId = item.ids.imdbId ?? null;
  const tmdbId = item.ids.tmdbId ?? null;
  const traktId = item.ids.traktId ?? null;
  const slug = item.ids.traktSlug ?? item.ids.slug ?? null;
  const href = buildTitleHref({
    mediaType: type,
    externalIds: { imdbId, slug, traktId, tmdbId },
  });

  return {
    type,
    id: stableTitleId({ imdbId, traktId, tmdbId, slug, type, label: item.title, year: item.year ?? null }),
    title: item.title,
    originalTitle: item.originalTitle ?? null,
    year: item.year ?? null,
    overview: item.overview ?? null,
    posterUrl: item.posterPath ?? null,
    href,
    externalIds: { imdbId, tmdbId, traktId, traktSlug: item.ids.traktSlug ?? null },
    sources: sourceFlags(item.source?.primary),
  };
}

export function personResultToEntity(item: PersonSearchResult): PoplogSearchEntity | null {
  const imdbId = item.imdbId ?? null;
  const href = buildPersonHref({ imdbId, id: imdbId });
  // Pessoa sem id confiável não vira link — e sem link a página não abre.
  if (!href) return null;
  const knownFor = (item.knownFor ?? []).map((kf) => ({
    id: kf.imdbId ?? null,
    title: kf.title ?? null,
    mediaType: kf.mediaType ?? null,
    year: kf.year ?? null,
    posterUrl: kf.posterPath ?? null,
    href: buildTitleHref({
      mediaType: kf.mediaType ?? "movie",
      externalIds: { imdbId: kf.imdbId ?? null },
    }),
  }));
  return {
    type: "person",
    id: imdbId ?? item.name,
    name: item.name,
    profileImage: item.profilePath ?? null,
    href,
    knownForDepartment: item.knownForDepartment ?? null,
    knownFor: knownFor.length > 0 ? knownFor : null,
    externalIds: { imdbId },
    sources: { balloonerismm: true },
  };
}

/** Pessoa resolvida por id direto (nm...), com perfil opcional. */
export function personByIdToEntity(input: {
  imdbId: string;
  name?: string | null;
  profileImage?: string | null;
  knownForDepartment?: string | null;
  fromBalloon: boolean;
}): PoplogSearchEntity | null {
  const href = buildPersonHref({ imdbId: input.imdbId, id: input.imdbId });
  if (!href) return null;
  return {
    type: "person",
    id: input.imdbId,
    name: input.name ?? null,
    profileImage: input.profileImage ?? null,
    href,
    knownForDepartment: input.knownForDepartment ?? null,
    knownFor: null,
    externalIds: { imdbId: input.imdbId },
    sources: input.fromBalloon ? { balloonerismm: true } : {},
  };
}

// ─── Deduplicação ─────────────────────────────────────────────────────────────

function entityKey(e: PoplogSearchEntity): string {
  const ext = e.externalIds;
  if (ext?.imdbId) return `${e.type}:imdb:${ext.imdbId}`;
  if (ext?.traktId != null) return `${e.type}:trakt:${ext.traktId}`;
  if (ext?.tmdbId != null) return `${e.type}:tmdb:${ext.tmdbId}`;
  const label = (e.title ?? e.name ?? e.originalTitle ?? e.originalName ?? "")
    .toLowerCase()
    .trim();
  return `${e.type}:label:${label}:${e.year ?? ""}`;
}

function completeness(e: PoplogSearchEntity): number {
  let s = 0;
  if (e.posterUrl || e.profileImage) s += 4;
  if (e.overview) s += 2;
  if (e.year != null) s += 1;
  const ext = e.externalIds;
  s += [ext?.imdbId, ext?.tmdbId, ext?.traktId, ext?.traktSlug].filter((v) => v != null).length;
  if (e.title || e.name) s += 1;
  if (e.href) s += 1;
  s += e.score ?? 0;
  return s;
}

/** Mescla os flags de fonte de dois itens duplicados. */
function mergeSources(
  a: PoplogSearchEntity["sources"],
  b: PoplogSearchEntity["sources"]
): PoplogSearchEntity["sources"] {
  return {
    trakt: a?.trakt || b?.trakt || undefined,
    balloonerismm: a?.balloonerismm || b?.balloonerismm || undefined,
    localCache: a?.localCache || b?.localCache || undefined,
  };
}

export function dedupeEntities(entities: PoplogSearchEntity[]): PoplogSearchEntity[] {
  const byKey = new Map<string, PoplogSearchEntity>();
  for (const entity of entities) {
    const key = entityKey(entity);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, entity);
      continue;
    }
    const winner = completeness(entity) > completeness(existing) ? entity : existing;
    winner.sources = mergeSources(existing.sources, entity.sources);
    byKey.set(key, winner);
  }
  return [...byKey.values()];
}

export function groupEntities(entities: PoplogSearchEntity[]): {
  movies: PoplogSearchEntity[];
  tv: PoplogSearchEntity[];
  people: PoplogSearchEntity[];
} {
  return {
    movies: entities.filter((e) => e.type === "movie"),
    tv: entities.filter((e) => e.type === "tv"),
    people: entities.filter((e) => e.type === "person"),
  };
}
