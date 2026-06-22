import { db } from "@/server/db/client";
import {
  titleIdentityKeys,
  type TitleIdentityInput,
} from "@/lib/user-title-identity";

export type LibraryIdentityIndex = Set<string>;

export function addTitleIdentity(
  index: LibraryIdentityIndex,
  identity: TitleIdentityInput,
): boolean {
  const before = index.size;
  for (const key of titleIdentityKeys(identity)) index.add(key);
  return index.size !== before;
}

export function hasTitleIdentity(
  index: LibraryIdentityIndex,
  identity: TitleIdentityInput,
): boolean {
  return titleIdentityKeys(identity).some((key) => index.has(key));
}

function valuesFor(index: LibraryIdentityIndex, kind: string): string[] {
  const marker = `:${kind}:`;
  const values = new Set<string>();
  for (const key of index) {
    const offset = key.indexOf(marker);
    if (offset >= 0) values.add(key.slice(offset + marker.length));
  }
  return [...values];
}

function integerValues(values: string[], positiveOnly = false): number[] {
  return values
    .map(Number)
    .filter((value) => Number.isInteger(value) && (!positiveOnly || value > 0));
}

function bigintValues(values: string[]): bigint[] {
  const result: bigint[] = [];
  for (const value of values) {
    try {
      result.push(BigInt(value));
    } catch {
      // Ignore malformed external aliases; the other identifiers still participate.
    }
  }
  return result;
}

/**
 * Builds the authoritative exclusion index for discovery surfaces.
 *
 * Both persisted state tables are read without a status filter: watchlist, watched,
 * watching, completed, fridge, abandoned, favorites and progress-only states all
 * block discovery. Local catalog tables are then followed as an alias graph so a
 * title saved under one source ID also matches recommendations from another source.
 */
export async function getUserLibraryIdentityIndex(
  userId: string,
  supplied: TitleIdentityInput[] = [],
): Promise<LibraryIdentityIndex> {
  const index: LibraryIdentityIndex = new Set();
  for (const identity of supplied) addTitleIdentity(index, identity);

  const [libraryRows, stateRows] = await Promise.all([
    db.userTitle.findMany({
      where: { userId },
      select: { tmdbId: true, mediaType: true },
    }),
    db.userTitleState.findMany({
      where: { userId },
      select: { tmdbId: true, mediaType: true },
    }),
  ]);

  for (const row of [...libraryRows, ...stateRows]) {
    addTitleIdentity(index, {
      mediaType: row.mediaType,
      tmdbId: row.tmdbId,
    });
  }

  // Resolve the alias graph to a fixed point. Two passes usually suffice
  // (TMDB -> IMDb -> canonical title), while four protects bridged legacy rows.
  const seenCatalogRows = new Set<string>();
  const seenExternalRows = new Set<string>();
  for (let pass = 0; pass < 4; pass++) {
    const tmdbIds = integerValues(valuesFor(index, "tmdb"), true);
    const imdbIds = valuesFor(index, "imdb");
    const traktStrings = valuesFor(index, "trakt");
    const traktIds = bigintValues(traktStrings);
    const slugs = valuesFor(index, "slug");
    const poplogIds = valuesFor(index, "poplog");

    const catalogOr = [
      ...(tmdbIds.length ? [{ tmdbId: { in: tmdbIds } }] : []),
      ...(imdbIds.length ? [{ imdbId: { in: imdbIds } }] : []),
      ...(traktIds.length ? [{ traktId: { in: traktIds } }] : []),
      ...(slugs.length ? [{ slug: { in: slugs } }] : []),
      ...(poplogIds.length ? [{ id: { in: poplogIds } }] : []),
    ];
    const externalOr = [
      ...(tmdbIds.length ? [{ tmdbId: { in: tmdbIds } }] : []),
      ...(imdbIds.length ? [{ imdbId: { in: imdbIds } }] : []),
      ...(traktStrings.length ? [{ traktId: { in: traktStrings } }] : []),
    ];

    if (catalogOr.length === 0 && externalOr.length === 0) break;

    const [catalogRows, externalRows] = await Promise.all([
      catalogOr.length
        ? db.poplog3Title.findMany({
            where: { OR: catalogOr },
            select: { id: true, tmdbId: true, mediaType: true, imdbId: true, traktId: true, slug: true },
          })
        : Promise.resolve([]),
      externalOr.length
        ? db.titleExternalId.findMany({
            where: { OR: externalOr },
            select: { id: true, tmdbId: true, mediaType: true, imdbId: true, traktId: true },
          })
        : Promise.resolve([]),
    ]);

    let changed = false;
    for (const row of catalogRows) {
      if (seenCatalogRows.has(row.id)) continue;
      const identity = {
        mediaType: row.mediaType,
        poplogId: row.id,
        tmdbId: row.tmdbId,
        imdbId: row.imdbId,
        traktId: row.traktId,
        slug: row.slug,
      } satisfies TitleIdentityInput;
      // A query can match an ID belonging to the other media namespace. Only
      // traverse rows connected to this user's graph with the same media type.
      if (!hasTitleIdentity(index, identity)) continue;
      seenCatalogRows.add(row.id);
      changed = addTitleIdentity(index, identity) || changed;
    }
    for (const row of externalRows) {
      if (seenExternalRows.has(row.id)) continue;
      const identity = {
        mediaType: row.mediaType,
        tmdbId: row.tmdbId,
        imdbId: row.imdbId,
        traktId: row.traktId,
      } satisfies TitleIdentityInput;
      if (!hasTitleIdentity(index, identity)) continue;
      seenExternalRows.add(row.id);
      changed = addTitleIdentity(index, identity) || changed;
    }
    if (!changed) break;
  }

  return index;
}
