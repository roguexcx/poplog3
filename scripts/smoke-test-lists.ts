import { db } from "@/server/db/client";

import { removeUserTitle, upsertUserTitleStatus } from "@/server/library/library-service";
import { ensureUserUsername } from "@/server/auth/username";
import {
  ListServiceError,
  addTitleToLists,
  createUserList,
  deleteUserList,
  getPrivateListByShortId,
  getUserListDetail,
  getUserListItems,
  getUserListMembership,
  getUserListSummaries,
  listUserLists,
  removeTitleFromList,
  reorderUserListItems,
  reorderUserLists,
  updateUserList,
} from "@/server/lists/list-service";
import { upsertCachedTitleRow } from "@/server/repositories/title-cache.repository";

function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`${label}: assertion failed`);
  console.log(`[smoke:lists] ${label}: ok`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
  console.log(`[smoke:lists] ${label}: ok`);
}

async function assertServiceStatus(
  action: () => Promise<unknown>,
  expectedStatus: number,
  label: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof ListServiceError && error.status === expectedStatus) {
      console.log(`[smoke:lists] ${label}: ok`);
      return;
    }
    throw error;
  }
  throw new Error(`${label}: expected ListServiceError ${expectedStatus}`);
}

const ownerId = "lists-smoke-owner";
const otherUserId = "lists-smoke-other";
const watchlistMovieId = 987_659_101;
const listOnlyMovieId = 987_659_102;
const watchedMovieId = 987_659_103;

async function cleanup(): Promise<void> {
  const userIds = [ownerId, otherUserId];
  await db.userList.deleteMany({ where: { userId: { in: userIds } } });
  await db.userTitleState.deleteMany({ where: { userId: { in: userIds } } });
  await db.userTitle.deleteMany({ where: { userId: { in: userIds } } });
  await db.userEvent.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.poplog3Title.deleteMany({
    where: { tmdbId: { in: [watchlistMovieId, listOnlyMovieId, watchedMovieId] } },
  });
}

async function main() {
  process.env.POPLOG_DISABLE_BACKGROUND_REFRESH = "true";
  await cleanup();
  await db.user.createMany({
    data: [
      {
        id: ownerId,
        email: "lists-smoke-owner@poplog.dev",
        name: "Lists Smoke Owner",
        username: "lists-smoke-owner",
      },
      {
        id: otherUserId,
        email: "lists-smoke-other@poplog.dev",
        name: "Lists Smoke Other",
        username: null,
      },
    ],
  });

  try {
    assertEqual(
      await ensureUserUsername({ userId: otherUserId }),
      "lists-smoke-other",
      "username gerado para usuário novo",
    );
    await Promise.all([
      upsertCachedTitleRow({
        tmdbId: watchlistMovieId,
        mediaType: "movie",
        title: "Smoke Watchlist Movie",
        posterPath: "/smoke-watchlist.jpg",
        year: 2026,
      }),
      upsertCachedTitleRow({
        tmdbId: listOnlyMovieId,
        mediaType: "movie",
        title: "Smoke List Only Movie",
        posterPath: "/smoke-list-only.jpg",
        year: 2025,
      }),
      upsertCachedTitleRow({
        tmdbId: watchedMovieId,
        mediaType: "movie",
        title: "Smoke Watched Movie",
        posterPath: "/smoke-watched.jpg",
        year: 2024,
      }),
    ]);
    const first = await createUserList({
      userId: ownerId,
      name: "Ficção Científica",
      description: "Filmes para rever",
    });
    const second = await createUserList({ userId: ownerId, name: "Domingo" });
    assert(/^[A-Za-z0-9]{7}$/.test(first.shortId), "shortId de 7 caracteres");
    assertEqual(first.slug, "ficcao-cientifica", "slug normalizado");
    assertEqual(first.isPublic, false, "lista privada por padrão");
    assertEqual(first.shareToken, null, "sem token público na v1");
    assert(first.shortId !== second.shortId, "shortIds únicos");

    await assertServiceStatus(
      () => createUserList({ userId: ownerId, name: "Ficção Científica" }),
      409,
      "nome único por usuário",
    );

    await reorderUserLists({ userId: ownerId, orderedIds: [second.id, first.id] });
    const reorderedLists = await listUserLists(ownerId);
    assertEqual(reorderedLists[0]?.id, second.id, "ordenação manual de listas");

    const watchlistAdd = await addTitleToLists({
      userId: ownerId,
      tmdbId: watchlistMovieId,
      mediaType: "movie",
      listIds: [first.id, second.id],
    });
    assertEqual(watchlistAdd.items.length, 2, "mesmo título em múltiplas listas");
    assertEqual(watchlistAdd.addedToWatchlist, true, "Watchlist aplicada por padrão");
    const summaries = await getUserListSummaries(ownerId);
    assertEqual(summaries[0]?.ownerUsername, "lists-smoke-owner", "summary expõe username da rota");
    assertEqual(summaries.find((list) => list.id === first.id)?.covers[0]?.title, "Smoke Watchlist Movie", "mosaico hidratado");
    const detail = await getUserListDetail({ userId: ownerId, listId: first.id });
    assertEqual(detail.items[0]?.posterPath, "/smoke-watchlist.jpg", "grid da lista hidratado");
    assert(
      await getPrivateListByShortId({
        userId: ownerId,
        username: "lists-smoke-owner",
        shortId: first.shortId,
      }),
      "lista privada resolve por shortId",
    );
    assertEqual(
      await getPrivateListByShortId({
        userId: otherUserId,
        username: "lists-smoke-owner",
        shortId: first.shortId,
      }),
      null,
      "lista privada bloqueia não proprietário",
    );
    const watchlistRow = await db.userTitle.findUnique({
      where: {
        userId_tmdbId_mediaType: {
          userId: ownerId,
          tmdbId: watchlistMovieId,
          mediaType: "movie",
        },
      },
    });
    assertEqual(watchlistRow?.status, "watchlist", "estado único de Watchlist");

    await addTitleToLists({
      userId: ownerId,
      tmdbId: watchlistMovieId,
      mediaType: "movie",
      listIds: [first.id],
      alsoAddToWatchlist: false,
    });
    const firstAfterIdempotentAdd = await db.userList.findUniqueOrThrow({ where: { id: first.id } });
    assertEqual(firstAfterIdempotentAdd.itemCount, 1, "adição idempotente não altera itemCount");

    const listOnlyAdd = await addTitleToLists({
      userId: ownerId,
      tmdbId: listOnlyMovieId,
      mediaType: "movie",
      listIds: [first.id],
      alsoAddToWatchlist: false,
    });
    assertEqual(listOnlyAdd.addedToWatchlist, false, "checkbox desmarcado não cria Watchlist");
    const [listOnlyTitle, listOnlyState] = await Promise.all([
      db.userTitle.findUnique({
        where: {
          userId_tmdbId_mediaType: {
            userId: ownerId,
            tmdbId: listOnlyMovieId,
            mediaType: "movie",
          },
        },
      }),
      db.userTitleState.findUnique({
        where: {
          userId_tmdbId_mediaType: {
            userId: ownerId,
            tmdbId: listOnlyMovieId,
            mediaType: "movie",
          },
        },
      }),
    ]);
    assertEqual(listOnlyTitle, null, "título só na lista não cria UserTitle");
    assertEqual(listOnlyState, null, "título só na lista não cria UserTitleState");

    await upsertUserTitleStatus({
      userId: ownerId,
      tmdbId: watchedMovieId,
      mediaType: "movie",
      status: "watched",
      favorite: true,
    });
    const watchedAdd = await addTitleToLists({
      userId: ownerId,
      tmdbId: watchedMovieId,
      mediaType: "movie",
      listIds: [first.id],
    });
    assertEqual(watchedAdd.addedToWatchlist, false, "status existente não é promovido");
    assertEqual(watchedAdd.existingLibraryStatus, "watched", "status existente identificado");
    const watchedAfterAdd = await db.userTitle.findUniqueOrThrow({
      where: {
        userId_tmdbId_mediaType: {
          userId: ownerId,
          tmdbId: watchedMovieId,
          mediaType: "movie",
        },
      },
    });
    assertEqual(watchedAfterAdd.status, "watched", "watched nunca é rebaixado");
    assertEqual(watchedAfterAdd.favorite, true, "favorito preservado");

    const membership = await getUserListMembership({
      userId: ownerId,
      titles: [
        { tmdbId: watchlistMovieId, mediaType: "movie" },
        { tmdbId: listOnlyMovieId, mediaType: "movie" },
      ],
    });
    assertEqual(membership.get(`${watchlistMovieId}:movie`)?.length, 2, "membership em N listas");

    await removeUserTitle(ownerId, watchlistMovieId, "movie");
    const itemsAfterWatchlistRemoval = await db.userListItem.count({
      where: { tmdbId: watchlistMovieId, mediaType: "movie", list: { userId: ownerId } },
    });
    assertEqual(itemsAfterWatchlistRemoval, 2, "remover da Watchlist mantém listas");

    await removeTitleFromList({
      userId: ownerId,
      listId: first.id,
      tmdbId: watchlistMovieId,
      mediaType: "movie",
    });
    const remainingInSecond = await db.userListItem.count({
      where: { listId: second.id, tmdbId: watchlistMovieId, mediaType: "movie" },
    });
    assertEqual(remainingInSecond, 1, "remover de uma lista mantém as outras");
    assertEqual(
      await db.userTitle.count({ where: { userId: ownerId, tmdbId: watchlistMovieId, mediaType: "movie" } }),
      0,
      "remover de lista não recria estado",
    );

    const firstItems = (await getUserListItems({ userId: ownerId, listId: first.id })).items;
    await reorderUserListItems({
      userId: ownerId,
      listId: first.id,
      orderedItemIds: [...firstItems].reverse().map((item) => item.id),
    });
    const reorderedItems = (await getUserListItems({ userId: ownerId, listId: first.id })).items;
    assertEqual(reorderedItems[0]?.id, firstItems.at(-1)?.id, "ordenação manual de itens");

    const renamed = await updateUserList({
      userId: ownerId,
      listId: second.id,
      name: "Sábado",
    });
    assertEqual(renamed.shortId, second.shortId, "renomear preserva shortId");
    assertEqual(renamed.slug, "sabado", "renomear atualiza slug");

    await assertServiceStatus(
      () => getUserListItems({ userId: otherUserId, listId: second.id }),
      404,
      "leitura por outro usuário bloqueada",
    );
    await assertServiceStatus(
      () => updateUserList({ userId: otherUserId, listId: second.id, name: "Invadida" }),
      404,
      "edição por outro usuário bloqueada",
    );

    await deleteUserList({ userId: ownerId, listId: first.id });
    assertEqual(
      await db.userListItem.count({ where: { listId: first.id } }),
      0,
      "excluir lista remove apenas seus itens por cascade",
    );
    const watchedAfterListDelete = await db.userTitle.findUniqueOrThrow({
      where: {
        userId_tmdbId_mediaType: {
          userId: ownerId,
          tmdbId: watchedMovieId,
          mediaType: "movie",
        },
      },
    });
    assertEqual(watchedAfterListDelete.status, "watched", "excluir lista preserva Biblioteca");
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await cleanup();
    await db.$disconnect();
    console.log("[smoke:lists] cleanup: ok");
  }

  console.log("[smoke:lists] completed");
}

main().catch((error) => {
  console.error("[smoke:lists] failed", error);
  process.exitCode = 1;
});
