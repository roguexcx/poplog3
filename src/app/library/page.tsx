import PageShell from "@/components/layout/PageShell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Biblioteca",
};

import LibraryPageView from "@/features/library/LibraryPage";
import { getCurrentUser } from "@/server/auth/get-current-user";
import {
  getUserLibrary,
  getUserLibraryState,
  type Poplog3UserLibraryItem,
} from "@/server/library/library-service";

async function getLibrary(): Promise<Poplog3UserLibraryItem[]> {
  const user = await getCurrentUser();

  if (!user) {
    return [];
  }

  // Fast path: lê do estado materializado (status, progresso, computed_state, best_provider).
  // Fallback para getUserLibrary apenas se o state ainda não tiver dados para este usuário.
  const stateItems = await getUserLibraryState(user.id);
  if (stateItems !== null) return stateItems;

  return getUserLibrary(user.id);
}

type LibraryPageProps = {
  searchParams?: Promise<{
    tab?: string;
  }>;
};

export default async function LibraryPage({
  searchParams,
}: LibraryPageProps) {
  const library = await getLibrary();

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
      />
    </PageShell>
  );
}
