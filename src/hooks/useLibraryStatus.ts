"use client";

import { useOptionalUserData } from "@/context/UserDataContext";
import { findUserTitleByIdentity } from "@/lib/user-title-identity";
import type { TitleIdentityInput } from "@/lib/user-title-identity";

export type LibraryStatusResult = {
  status: string | null;
  isFavorite: boolean;
  inLibrary: boolean;
};

/**
 * Retorna o estado da biblioteca para um título específico.
 * Leitura pura — sem lógica de toggle. Use nos cards para exibir badges.
 *
 * Reativo: atualiza automaticamente quando UserDataContext recarrega
 * após `poplog:user-titles-updated`.
 */
export function useLibraryStatus(identity: TitleIdentityInput): LibraryStatusResult {
  const userData = useOptionalUserData();

  if (!userData || userData.loading) {
    return { status: null, isFavorite: false, inLibrary: false };
  }

  const title = findUserTitleByIdentity(userData.titles, identity);
  if (!title) {
    return { status: null, isFavorite: false, inLibrary: false };
  }

  return {
    status: title.status ?? null,
    isFavorite: Boolean(title.favorite),
    inLibrary: true,
  };
}
