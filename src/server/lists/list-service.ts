import type { MediaType, UserList, UserListItem } from "@prisma/client";

import { ensureUserUsername } from "@/server/auth/username";
import { getUserTitleStatus, upsertUserTitleStatus } from "@/server/library/library-service";
import { resolveDisplayTitle } from "@/lib/titles/display-title";
import type {
  UserListDetail,
  UserListRecord,
  UserListSummary,
  UserListTitleItem,
} from "@/types/lists";
import {
  addItem,
  createList,
  deleteList,
  getListForUser,
  getListByShortIdWithUser,
  getListItems,
  getListMembershipForTitles,
  listListsForUser,
  listListsWithPreviewForUser,
  removeItem,
  reorderItems,
  reorderLists,
  updateList,
} from "@/server/repositories/user-list.repository";
import { getManyTitleCacheRows } from "@/server/repositories/title-cache.repository";

export class ListServiceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 404 | 409 | 500,
  ) {
    super(message);
    this.name = "ListServiceError";
  }
}

function repositoryError(message: string): never {
  if (message === "List not found" || message === "Item not found in list") {
    throw new ListServiceError(message, 404);
  }
  if (message.includes("already exists")) {
    throw new ListServiceError(message, 409);
  }
  if (message.includes("required") || message.includes("cannot be empty") || message.includes("at most")) {
    throw new ListServiceError(message, 400);
  }
  throw new ListServiceError(message, 500);
}

function assertTitleIdentity(tmdbId: number, mediaType: MediaType): void {
  if (!Number.isInteger(tmdbId) || tmdbId === 0) {
    throw new ListServiceError("tmdbId must be a non-zero integer", 400);
  }
  if (mediaType !== "movie" && mediaType !== "tv") {
    throw new ListServiceError("mediaType must be movie or tv", 400);
  }
}

function uniqueIds(ids: string[], label: string): string[] {
  const normalized = ids.map((id) => id.trim()).filter(Boolean);
  if (normalized.length !== ids.length || new Set(normalized).size !== normalized.length) {
    throw new ListServiceError(`${label} must contain unique, non-empty IDs`, 400);
  }
  return normalized;
}

async function requireOwnedList(userId: string, listId: string): Promise<UserList> {
  const list = await getListForUser({ userId, listId });
  if (!list) throw new ListServiceError("List not found", 404);
  return list;
}

function serializeList(list: UserList, ownerUsername: string): UserListSummary {
  return {
    id: list.id,
    shortId: list.shortId,
    name: list.name,
    slug: list.slug,
    description: list.description,
    position: list.position,
    itemCount: list.itemCount,
    isPublic: false,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
    ownerUsername,
    covers: [],
  };
}

export function serializeUserListRecord(list: UserList): UserListRecord {
  const { ownerUsername: _ownerUsername, covers: _covers, ...record } = serializeList(list, "");
  return record;
}

function resolveItemRuntime(row: { runtime?: number | null; episodeRunTime?: unknown } | undefined): number | null {
  if (!row) return null;
  if (typeof row.runtime === "number" && row.runtime > 0) return row.runtime;
  // Séries: episodeRunTime costuma ser um array de minutos por episódio. Usa o primeiro valor válido.
  const episodeRunTime = row.episodeRunTime;
  if (Array.isArray(episodeRunTime)) {
    const first = episodeRunTime.find((value) => typeof value === "number" && value > 0);
    if (typeof first === "number") return first;
  }
  return null;
}

function resolveItemReleaseDate(row: { releaseDate?: Date | null; firstAirDate?: Date | null } | undefined): string | null {
  const date = row?.releaseDate ?? row?.firstAirDate ?? null;
  if (!date) return null;
  // Mantém apenas a parte de data (YYYY-MM-DD) para filtros/ordenação no cliente.
  return date.toISOString().slice(0, 10);
}

async function hydrateListItems(items: UserListItem[]): Promise<UserListTitleItem[]> {
  const cache = await getManyTitleCacheRows(
    items.map((item) => ({ mediaType: item.mediaType, tmdbId: item.tmdbId })),
  );

  return items.map((item) => {
    const row = cache.get(`${item.mediaType}:${item.tmdbId}`);
    const title = resolveDisplayTitle({
      title: row?.title,
      originalTitle: row?.originalTitle,
      tmdbId: item.tmdbId,
      poplogId: row?.id,
      slug: row?.slug,
      mediaType: item.mediaType,
      year: row?.year,
    });
    const linkId = row?.id ?? item.tmdbId;

    return {
      id: item.id,
      listId: item.listId,
      tmdbId: item.tmdbId,
      mediaType: item.mediaType,
      position: item.position,
      addedAt: item.addedAt.toISOString(),
      title,
      originalTitle: row?.originalTitle ?? null,
      posterPath: row?.posterPath ?? null,
      backdropPath: row?.backdropPath ?? null,
      year: row?.year ?? null,
      runtime: resolveItemRuntime(row),
      releaseDate: resolveItemReleaseDate(row),
      href: `/title/${item.mediaType}/${linkId}`,
    };
  });
}

export async function createUserList(input: {
  userId: string;
  name: string;
  description?: string | null;
}): Promise<UserList> {
  const result = await createList(input);
  if (!result.ok) repositoryError(result.error);
  return result.data;
}

export async function listUserLists(userId: string): Promise<UserList[]> {
  return listListsForUser({ userId });
}

export async function getUserListSummaries(userId: string): Promise<UserListSummary[]> {
  const rows = await listListsWithPreviewForUser({ userId });
  if (rows.length === 0) return [];

  const username = rows[0]?.user.username ?? await ensureUserUsername({ userId });
  if (!username) throw new ListServiceError("User does not have a username", 500);

  const covers = await hydrateListItems(rows.flatMap((row) => row.items));
  const coversByList = new Map<string, UserListTitleItem[]>();
  for (const cover of covers) {
    const current = coversByList.get(cover.listId) ?? [];
    current.push(cover);
    coversByList.set(cover.listId, current);
  }

  return rows.map((row) => ({
    ...serializeList(row, username),
    covers: coversByList.get(row.id) ?? [],
  }));
}

export async function updateUserList(input: {
  userId: string;
  listId: string;
  name?: string;
  description?: string | null;
}): Promise<UserList> {
  const result = await updateList(input);
  if (!result.ok) repositoryError(result.error);
  return result.data;
}

export async function deleteUserList(input: {
  userId: string;
  listId: string;
}): Promise<void> {
  const result = await deleteList(input);
  if (!result.ok) repositoryError(result.error);
}

export async function reorderUserLists(input: {
  userId: string;
  orderedIds: string[];
}): Promise<void> {
  const orderedIds = uniqueIds(input.orderedIds, "orderedIds");
  const current = await listListsForUser({ userId: input.userId });
  const currentIds = new Set(current.map((list) => list.id));
  if (orderedIds.length !== currentIds.size || orderedIds.some((id) => !currentIds.has(id))) {
    throw new ListServiceError("orderedIds must contain every list owned by the user", 400);
  }

  const result = await reorderLists({ userId: input.userId, orderedIds });
  if (!result.ok) repositoryError(result.error);
}

export async function getUserListItems(input: {
  userId: string;
  listId: string;
}): Promise<{ list: UserList; items: UserListItem[] }> {
  const list = await requireOwnedList(input.userId, input.listId);
  const items = await getListItems({ listId: input.listId });
  return { list, items };
}

export async function getUserListDetail(input: {
  userId: string;
  listId: string;
}): Promise<UserListDetail> {
  const { list, items } = await getUserListItems(input);
  const username = await ensureUserUsername({ userId: input.userId });
  if (!username) throw new ListServiceError("User does not have a username", 500);
  const hydratedItems = await hydrateListItems(items);
  return {
    list: {
      ...serializeList(list, username),
      covers: hydratedItems.slice(0, 4),
    },
    items: hydratedItems,
  };
}

export async function getPrivateListByShortId(input: {
  userId: string;
  username: string;
  shortId: string;
}): Promise<UserListDetail | null> {
  const list = await getListByShortIdWithUser({ shortId: input.shortId });
  if (
    !list ||
    list.userId !== input.userId ||
    !list.user.username ||
    list.user.username.toLowerCase() !== input.username.toLowerCase()
  ) {
    return null;
  }
  const items = await getListItems({ listId: list.id });
  const hydratedItems = await hydrateListItems(items);
  return {
    list: {
      ...serializeList(list, list.user.username),
      covers: hydratedItems.slice(0, 4),
    },
    items: hydratedItems,
  };
}

export async function addTitleToLists(input: {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  listIds: string[];
  alsoAddToWatchlist?: boolean;
}): Promise<{
  items: UserListItem[];
  addedToWatchlist: boolean;
  existingLibraryStatus: string | null;
}> {
  assertTitleIdentity(input.tmdbId, input.mediaType);
  const listIds = uniqueIds(input.listIds, "listIds");
  if (listIds.length === 0) {
    throw new ListServiceError("listIds must contain at least one list", 400);
  }

  const ownedLists = await listListsForUser({ userId: input.userId });
  const ownedIds = new Set(ownedLists.map((list) => list.id));
  if (listIds.some((id) => !ownedIds.has(id))) {
    throw new ListServiceError("List not found", 404);
  }

  const items: UserListItem[] = [];
  for (const listId of listIds) {
    const result = await addItem({
      listId,
      tmdbId: input.tmdbId,
      mediaType: input.mediaType,
    });
    if (!result.ok) repositoryError(result.error);
    items.push(result.data);
  }

  let addedToWatchlist = false;
  let existingLibraryStatus: string | null = null;
  if (input.alsoAddToWatchlist !== false) {
    const existing = await getUserTitleStatus(input.userId, input.tmdbId, input.mediaType);
    existingLibraryStatus = existing?.status ?? null;
    if (!existing) {
      await upsertUserTitleStatus({
        userId: input.userId,
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        status: "watchlist",
      });
      addedToWatchlist = true;
    }
  }

  return { items, addedToWatchlist, existingLibraryStatus };
}

export async function removeTitleFromList(input: {
  userId: string;
  listId: string;
  tmdbId: number;
  mediaType: MediaType;
}): Promise<void> {
  assertTitleIdentity(input.tmdbId, input.mediaType);
  await requireOwnedList(input.userId, input.listId);
  const result = await removeItem(input);
  if (!result.ok) repositoryError(result.error);
}

export async function reorderUserListItems(input: {
  userId: string;
  listId: string;
  orderedItemIds: string[];
}): Promise<void> {
  await requireOwnedList(input.userId, input.listId);
  const orderedItemIds = uniqueIds(input.orderedItemIds, "orderedItemIds");
  const current = await getListItems({ listId: input.listId });
  const currentIds = new Set(current.map((item) => item.id));
  if (
    orderedItemIds.length !== currentIds.size ||
    orderedItemIds.some((id) => !currentIds.has(id))
  ) {
    throw new ListServiceError("orderedItemIds must contain every item in the list", 400);
  }

  const result = await reorderItems({ listId: input.listId, orderedItemIds });
  if (!result.ok) repositoryError(result.error);
}

export async function getUserListMembership(input: {
  userId: string;
  titles: { tmdbId: number; mediaType: MediaType }[];
}): Promise<Map<string, string[]>> {
  if (input.titles.length > 100) {
    throw new ListServiceError("At most 100 titles can be queried at once", 400);
  }
  for (const title of input.titles) assertTitleIdentity(title.tmdbId, title.mediaType);
  return getListMembershipForTitles(input);
}
