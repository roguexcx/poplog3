import {
  getUserLibraryIdentityIndex,
  hasTitleIdentity,
} from "@/server/library/library-identity-index";
import type { TitleIdentityInput } from "@/lib/user-title-identity";

type FilterableItem = {
  externalIds?: {
    tmdbId?: number | null;
    imdbId?: string | null;
    traktId?: string | number | null;
    slug?: string | null;
  };
  poplogId?: string | number | null;
  imdb_id?: string | null;
  tmdb_id?: number | null;
  id?: number | null;
  media_type?: string | null;
  mediaType?: string | null;
};

/** Normaliza todos os aliases disponíveis para a identidade compartilhada. */
function itemIdentity(item: FilterableItem): TitleIdentityInput | null {
  const mediaType = item.media_type ?? item.mediaType;
  if (mediaType !== "movie" && mediaType !== "tv") return null;
  return {
    mediaType,
    tmdbId: item.externalIds?.tmdbId ?? item.tmdb_id ?? item.id,
    poplogId: item.poplogId,
    imdbId: item.externalIds?.imdbId ?? item.imdb_id,
    traktId: item.externalIds?.traktId,
    slug: item.externalIds?.slug,
  };
}

/**
 * Filtra itens de descoberta que já estão na biblioteca do usuário.
 *
 * Itens com qualquer status (watchlist, watched, watching, abandoned, fridge,
 * favorite) são removidos dos blocos de descoberta:
 * - Para Você
 * - Sorteio (modo discovery)
 * - Recomendações / Mais como este
 * - Em Alta
 *
 * Se `userId` for null/undefined, retorna a lista original inalterada.
 *
 * @param userId  ID do usuário autenticado
 * @param items   Array de itens a filtrar
 */
export async function filterOutLibraryItems<T extends FilterableItem>(
  userId: string | null | undefined,
  items: T[],
): Promise<T[]> {
  if (!userId || items.length === 0) return items;

  try {
    const known = await getUserLibraryIdentityIndex(userId);
    return items.filter((item) => {
      const identity = itemIdentity(item);
      return !identity || !hasTitleIdentity(known, identity);
    });
  } catch {
    // Discovery is fail-closed: leaking a saved title is worse than temporarily
    // hiding a recommendation rail while the authoritative state is unavailable.
    return [];
  }
}

/**
 * Versão síncrona para uso quando o Set já foi carregado previamente.
 */
export function filterOutLibraryItemsSync<T extends FilterableItem>(
  knownIds: Set<string>,
  items: T[],
): T[] {
  if (knownIds.size === 0) return items;

  return items.filter((item) => {
    const identity = itemIdentity(item);
    return !identity || !hasTitleIdentity(knownIds, identity);
  });
}
