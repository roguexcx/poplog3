import { getUserKnownTitleIds } from "@/server/state/user-title-state";

type FilterableItem = {
  externalIds?: {
    tmdbId?: number | null;
  };
  tmdb_id?: number | null;
  id?: number | null;
  media_type?: string | null;
  mediaType?: string | null;
};

/**
 * Cria uma chave de lookup para o Set de títulos conhecidos.
 * Formato: "{tmdbId}:{mediaType}"
 */
function itemKey(item: FilterableItem): string | null {
  const tmdbId =
    item.externalIds?.tmdbId ??
    item.tmdb_id ??
    item.id;
  const mediaType =
    item.media_type ??
    item.mediaType;

  if (!tmdbId || !mediaType) return null;
  return `${tmdbId}:${mediaType}`;
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

  let known: Set<string>;
  try {
    known = await getUserKnownTitleIds(userId);
  } catch {
    return items;
  }

  if (known.size === 0) return items;

  return items.filter((item) => {
    const key = itemKey(item);
    return !key || !known.has(key);
  });
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
    const key = itemKey(item);
    return !key || !knownIds.has(key);
  });
}
