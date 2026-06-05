import {
  refreshTitleStateAvailability,
} from "@/server/state/user-title-state";

import {
  Poplog3UserTitle,
  UpsertUserTitleInput,
} from "./types";

export type Poplog3UserLibraryItem = Poplog3UserTitle & {
  /** Campos do estado global (preenchidos por getUserLibraryState) */
  computed_state?: string | null;
  watched_episodes?: number;
  aired_episodes?: number;
  total_episodes?: number | null;
  progress_pct?: number;
  duration_sort_minutes?: number | null;
  duration_sort_unavailable?: boolean | null;
  runtime_label?: string | null;
  remaining_runtime_minutes?: number | null;
  remaining_runtime_label?: string | null;
  remaining_runtime_estimated?: boolean;
  average_episode_runtime_minutes?: number | null;
  average_episode_runtime_label?: string | null;
  total_runtime_minutes?: number | null;
  total_runtime_label?: string | null;
  total_runtime_estimated?: boolean;
  best_provider_name?: string | null;
  best_provider_type?: string | null;
  best_provider_logo?: string | null;
  /** IMDb ID derivado quando tmdb_id é sintético negativo — usado para links e display. */
  imdb_id?: string | null;
  title: {
    tmdb_id: number;
    media_type: "movie" | "tv";
    title: string | null;
    original_title: string | null;
    poster_path: string | null;
    backdrop_path: string | null;
    year: number | null;
    release_date: string | null;
    first_air_date: string | null;
    last_air_date: string | null;
    runtime: number | null;
    episode_run_time: number[] | null;
    runtime_minutes: number | null;
    runtime_estimated: boolean;
    total_runtime_minutes: number | null;
    total_runtime_estimated: boolean;
    vote_average: number | null;
    popularity: number | null;
    number_of_episodes: number | null;
    number_of_seasons: number | null;
  } | null;
};

async function getLocalLibraryService() {
  return import("@/server/local-services/library-local.service");
}

/**
 * Lê a biblioteca do usuário a partir de user_title_state (estado materializado).
 * Retorna null se o usuário não tiver linhas no state — o caller faz fallback para getUserLibrary.
 */
export async function getUserLibraryState(
  userId: string,
  status?: string,
): Promise<Poplog3UserLibraryItem[] | null> {
  const local = await getLocalLibraryService();
  return local.getUserLibraryState(userId, status);
}

export async function getUserLibrary(
  userId: string,
  status?: string
): Promise<Poplog3UserLibraryItem[]> {
  const local = await getLocalLibraryService();
  return local.getUserLibrary(userId, status);
}

export async function getUserTitleStatus(
  userId: string,
  tmdbId: number,
  mediaType: "movie" | "tv"
): Promise<Poplog3UserTitle | null> {
  const local = await getLocalLibraryService();
  return local.getUserTitleStatus(userId, tmdbId, mediaType);
}

export async function upsertUserTitleStatus(
  input: UpsertUserTitleInput
): Promise<Poplog3UserTitle> {
  const local = await getLocalLibraryService();
  const result = await local.upsertUserTitleStatus(input);

  import("@/server/streaming/title-availability")
    .then(({ refreshAvailabilityForUserTitle }) =>
      refreshAvailabilityForUserTitle({
        userId: input.userId,
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        action: `library_status:${result.status}`,
        endpoint: "/api/library/title",
        contexts: ["library"],
      }),
    )
    .then((availabilityResult) => {
      const best = availabilityResult.availability.primaryProvider;
      const providerType: string | null =
        best && "normalizedType" in best
          ? best.normalizedType ?? null
          : best?.type === "streaming"
            ? "subscription"
            : best?.type ?? null;

      return refreshTitleStateAvailability(
        input.userId,
        input.tmdbId,
        input.mediaType,
        best
          ? {
              providerName: best.name,
              providerType,
              providerLogo: best.logoUrl ?? null,
            }
          : null,
      );
    })
    .catch((err) => console.error("[availability] refreshAvailabilityForUserTitle failed", err));

  return result;
}

export async function removeUserTitle(
  userId: string,
  tmdbId: number,
  mediaType: "movie" | "tv"
): Promise<void> {
  const local = await getLocalLibraryService();
  return local.removeUserTitle(userId, tmdbId, mediaType);
}
