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
import { isTraktIndexEnabled } from "@/lib/trakt-index/engine";
import { getPoplogDailyTrendingIndex } from "@/lib/trakt-index/canonical";
import {
  buildTraktScoreMapFromIndex,
  serializeTraktScoreMap,
} from "@/lib/score/library-popularity";

async function getLibrary(): Promise<Poplog3UserLibraryItem[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  return getUserLibrary(user.id);
}

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
  const [library, traktScores] = await Promise.all([
    getLibrary(),
    getTraktScores(),
  ]);

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
      />
    </PageShell>
  );
}
