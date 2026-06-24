import { randomInt } from "node:crypto";

import { db } from "@/server/db/client";
import { Prisma } from "@prisma/client";
import type { MediaType, UserList, UserListItem } from "@prisma/client";

import type { RepositoryResult, RepositoryVoidResult } from "./types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Alfabeto base62 sem caracteres ambíguos. shortId estável para a URL. */
const SHORT_ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const SHORT_ID_LENGTH = 7;
const SHORT_ID_CREATE_ATTEMPTS = 8;

function generateShortId(): string {
  let out = "";
  for (let i = 0; i < SHORT_ID_LENGTH; i += 1) {
    out += SHORT_ID_ALPHABET[randomInt(SHORT_ID_ALPHABET.length)];
  }
  return out;
}

/** Deriva um slug amigável a partir do nome da lista. */
export function slugifyListName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 160);
  return slug || "lista";
}

export type CreateListInput = {
  userId: string;
  name: string;
  description?: string | null;
};

export type UpdateListInput = {
  listId: string;
  userId: string;
  name?: string;
  description?: string | null;
};

export type UserListWithUser = UserList & {
  user: { username: string | null };
};

export type UserListWithPreviewItems = UserListWithUser & {
  items: UserListItem[];
};

// ── List CRUD ────────────────────────────────────────────────────────────────

export async function createList(
  input: CreateListInput,
): Promise<RepositoryResult<UserList>> {
  try {
    const name = input.name.trim();
    if (!name) return { ok: false, error: "List name is required" };
    if (name.length > 120) {
      return { ok: false, error: "List name must be at most 120 characters" };
    }

    const agg = await db.userList.aggregate({
      where: { userId: input.userId },
      _max: { position: true },
    });
    const position = (agg._max.position ?? -1) + 1;

    for (let attempt = 0; attempt < SHORT_ID_CREATE_ATTEMPTS; attempt += 1) {
      try {
        const list = await db.userList.create({
          data: {
            userId: input.userId,
            shortId: generateShortId(),
            name,
            slug: slugifyListName(name),
            description: input.description?.trim() || null,
            position,
          },
        });

        return { ok: true, data: list };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }

        const nameConflict = await db.userList.findFirst({
          where: { userId: input.userId, name },
          select: { id: true },
        });
        if (nameConflict) {
          return { ok: false, error: "A list with this name already exists" };
        }
      }
    }

    return { ok: false, error: "Could not generate a unique list identifier" };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { ok: false, error: "A list with this name already exists" };
    }
    return { ok: false, error: messageFromError(error) };
  }
}

export async function updateList(
  input: UpdateListInput,
): Promise<RepositoryResult<UserList>> {
  try {
    // Garante posse antes de alterar.
    const owned = await db.userList.findFirst({
      where: { id: input.listId, userId: input.userId },
      select: { id: true },
    });
    if (!owned) return { ok: false, error: "List not found" };

    const data: Prisma.UserListUpdateInput = {};
    if (typeof input.name === "string") {
      const name = input.name.trim();
      if (!name) return { ok: false, error: "List name cannot be empty" };
      if (name.length > 120) {
        return { ok: false, error: "List name must be at most 120 characters" };
      }
      data.name = name;
      data.slug = slugifyListName(name); // renomear regenera slug; shortId permanece
    }
    if (input.description !== undefined) {
      data.description = input.description?.trim() || null;
    }

    const list = await db.userList.update({
      where: { id: input.listId },
      data,
    });

    return { ok: true, data: list };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { ok: false, error: "A list with this name already exists" };
    }
    return { ok: false, error: messageFromError(error) };
  }
}

export async function deleteList(input: {
  listId: string;
  userId: string;
}): Promise<RepositoryVoidResult> {
  try {
    const result = await db.userList.deleteMany({
      where: { id: input.listId, userId: input.userId },
    });
    if (result.count === 0) return { ok: false, error: "List not found" };
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function reorderLists(input: {
  userId: string;
  orderedIds: string[];
}): Promise<RepositoryVoidResult> {
  try {
    await db.$transaction(
      input.orderedIds.map((id, index) =>
        db.userList.updateMany({
          where: { id, userId: input.userId },
          data: { position: index },
        }),
      ),
    );
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

// ── List reads ───────────────────────────────────────────────────────────────

export async function getListById(input: {
  listId: string;
}): Promise<UserList | null> {
  return db.userList.findUnique({ where: { id: input.listId } });
}

export async function getListForUser(input: {
  listId: string;
  userId: string;
}): Promise<UserList | null> {
  return db.userList.findFirst({
    where: { id: input.listId, userId: input.userId },
  });
}

export async function getListByShortId(input: {
  shortId: string;
}): Promise<UserList | null> {
  return db.userList.findUnique({ where: { shortId: input.shortId } });
}

export async function getListByShortIdWithUser(input: {
  shortId: string;
}): Promise<UserListWithUser | null> {
  return db.userList.findUnique({
    where: { shortId: input.shortId },
    include: { user: { select: { username: true } } },
  });
}

export async function listListsForUser(input: {
  userId: string;
}): Promise<UserList[]> {
  return db.userList.findMany({
    where: { userId: input.userId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

export async function listListsWithPreviewForUser(input: {
  userId: string;
}): Promise<UserListWithPreviewItems[]> {
  return db.userList.findMany({
    where: { userId: input.userId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: {
      user: { select: { username: true } },
      items: {
        orderBy: [{ position: "asc" }, { addedAt: "asc" }],
        take: 8,
      },
    },
  });
}

// ── Item operations ──────────────────────────────────────────────────────────

export async function addItem(input: {
  listId: string;
  tmdbId: number;
  mediaType: MediaType;
}): Promise<RepositoryResult<UserListItem>> {
  try {
    // Idempotente: se já existe, retorna o item atual sem duplicar nem mover.
    const existing = await db.userListItem.findUnique({
      where: {
        listId_tmdbId_mediaType: {
          listId: input.listId,
          tmdbId: input.tmdbId,
          mediaType: input.mediaType,
        },
      },
    });
    if (existing) return { ok: true, data: existing };

    const item = await db.$transaction(async (tx) => {
      const agg = await tx.userListItem.aggregate({
        where: { listId: input.listId },
        _max: { position: true },
      });
      const position = (agg._max.position ?? -1) + 1;

      const created = await tx.userListItem.create({
        data: {
          listId: input.listId,
          tmdbId: input.tmdbId,
          mediaType: input.mediaType,
          position,
        },
      });

      await tx.userList.update({
        where: { id: input.listId },
        data: { itemCount: { increment: 1 } },
      });

      return created;
    });

    return { ok: true, data: item };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await db.userListItem.findUnique({
        where: {
          listId_tmdbId_mediaType: {
            listId: input.listId,
            tmdbId: input.tmdbId,
            mediaType: input.mediaType,
          },
        },
      });
      if (existing) return { ok: true, data: existing };
    }
    return { ok: false, error: messageFromError(error) };
  }
}

export async function removeItem(input: {
  listId: string;
  tmdbId: number;
  mediaType: MediaType;
}): Promise<RepositoryVoidResult> {
  try {
    const removed = await db.$transaction(async (tx) => {
      const result = await tx.userListItem.deleteMany({
        where: {
          listId: input.listId,
          tmdbId: input.tmdbId,
          mediaType: input.mediaType,
        },
      });
      if (result.count > 0) {
        await tx.userList.update({
          where: { id: input.listId },
          data: { itemCount: { decrement: result.count } },
        });
      }
      return result.count;
    });

    if (removed === 0) return { ok: false, error: "Item not found in list" };
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function reorderItems(input: {
  listId: string;
  orderedItemIds: string[];
}): Promise<RepositoryVoidResult> {
  try {
    await db.$transaction(
      input.orderedItemIds.map((id, index) =>
        db.userListItem.updateMany({
          where: { id, listId: input.listId },
          data: { position: index },
        }),
      ),
    );
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function getListItems(input: {
  listId: string;
}): Promise<UserListItem[]> {
  return db.userListItem.findMany({
    where: { listId: input.listId },
    orderBy: [{ position: "asc" }, { addedAt: "asc" }],
  });
}

/**
 * Mapa de pertencimento: para um conjunto de títulos do usuário, retorna em
 * quais listas cada um aparece. Usado pelo indicador discreto da Biblioteca.
 * Chave do mapa: `${tmdbId}:${mediaType}` → listId[].
 */
export async function getListMembershipForTitles(input: {
  userId: string;
  titles: { tmdbId: number; mediaType: MediaType }[];
}): Promise<Map<string, string[]>> {
  const membership = new Map<string, string[]>();
  if (input.titles.length === 0) return membership;

  const orFilters = input.titles.map((t) => ({
    tmdbId: t.tmdbId,
    mediaType: t.mediaType,
  }));

  const rows = await db.userListItem.findMany({
    where: {
      OR: orFilters,
      list: { userId: input.userId },
    },
    select: { tmdbId: true, mediaType: true, listId: true },
  });

  for (const row of rows) {
    const key = `${row.tmdbId}:${row.mediaType}`;
    const arr = membership.get(key);
    if (arr) arr.push(row.listId);
    else membership.set(key, [row.listId]);
  }

  return membership;
}
