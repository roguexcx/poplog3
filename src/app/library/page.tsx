import PageShell from "@/components/layout/PageShell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Biblioteca",
};

import LibraryPageView from "@/features/library/LibraryPage";
import { getCurrentUser } from "@/server/auth/get-current-user";
import {
  getUserLibrary,
  type Poplog3UserLibraryItem,
} from "@/server/library/library-service";
import {
  getUserListMembership,
  getUserListSummaries,
} from "@/server/lists/list-service";
import type { UserListSummary } from "@/types/lists";
import { isTraktIndexEnabled } from "@/lib/trakt-index/engine";
import { getPoplogDailyTrendingIndex } from "@/lib/trakt-index/canonical";
import {
  buildTraktScoreMapFromIndex,
  serializeTraktScoreMap,
} from "@/lib/score/library-popularity";

type LibraryPageProps = {
  searchParams?: Promise<{
    tab?: string;
  }>;
};

// Busca o mapa de scores Trakt Index para enriquecer a ordenacao "Popularidade" da Biblioteca.
// Falha silenciosamente -- a biblioteca continua funcional com fallback (vote_average / TMDB popularity).
async function getTraktScores(): Promise<Record<string, number>> {
  if (!isTraktIndexEnabled()) return {};
  try {
    const items = await getPoplogDailyTrendingIndex();
    const map = buildTraktScoreMapFromIndex(items);
    return serializeTraktScoreMap(map);
  } catch {
    return {};
  }
}

export default async function LibraryPage({
  searchParams,
}: LibraryPageProps) {
  const user = await getCurrentUser();
  const [library, traktScores, lists] = await Promise.all([
    user ? getUserLibrary(user.id) : Promise.resolve([] as Poplog3UserLibraryItem[]),
    getTraktScores(),
    user ? getUserListSummaries(user.id) : Promise.resolve([] as UserListSummary[]),
  ]);

  const membership: Record<string, string[]> = {};
  if (user) {
    for (let offset = 0; offset < library.length; offset += 100) {
      const titles = library.slice(offset, offset + 100).map((item) => ({
        tmdbId: item.tmdb_id,
        mediaType: item.media_type,
      }));
      const chunk = await getUserListMembership({ userId: user.id, titles });
      for (const [key, listIds] of chunk) membership[key] = listIds;
    }
  }

  const resolvedSearchParams = await searchParams;

  const initialTab =
    typeof resolvedSearchParams?.tab === "string"
      ? resolvedSearchParams.tab
      : undefined;

  return (
    <PageShell variant="wide">
      <LibraryPageView
        key={initialTab ?? "all"}
        library={library}
        initialTab={initialTab}
        traktScores={traktScores}
        initialLists={lists}
        listMembership={membership}
        isAuthenticated={Boolean(user)}
      />
    </PageShell>
  );
}
