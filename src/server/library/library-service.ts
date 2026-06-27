import {
  refreshTitleStateAvailability,
} from "@/server/state/user-title-state";
import { getTitleAvailability, type TitleAvailabilitySummary } from "@/server/availability";
import {
  isSyntheticTmdbId,
  imdbIdFromSyntheticTmdbId,
} from "@/lib/ids/synthetic-tmdb-id";

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
  /** Disponibilidade normalizada (camada global) — providers + status temporal. */
  availability?: TitleAvailabilitySummary | null;
  /** Disponibilidade US usada exclusivamente pela regra editorial de "Em breve". */
  availability_us?: TitleAvailabilitySummary | null;
  /** IMDb ID derivado quando tmdb_id é sintético negativo — usado para links e display. */
  imdb_id?: string | null;
  /** IDs externos do título — incluindo slug para gerar links diretos sem redirect. */
  externalIds?: {
    tmdbId?: number;
    imdbId?: string;
    tvdbId?: number;
    traktId?: number | string;
    balloonerismmId?: string;
    slug?: string | null;
  };
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
 * Resolve a disponibilidade de um título via camada global e persiste o melhor
 * provider no estado materializado (user_title_state). POPLOG-first: usa imdbId
 * (sintético ou via external-ids cache) → Balloonerismm/cache; nunca chama TMDB.
 */
async function persistBestProviderFromGlobalLayer(
  input: UpsertUserTitleInput,
): Promise<void> {
  let imdbId: string | null = null;
  if (isSyntheticTmdbId(input.tmdbId)) {
    imdbId = imdbIdFromSyntheticTmdbId(input.tmdbId);
  } else if (input.tmdbId > 0) {
    const { getExternalIds } = await import("@/server/cache/external-ids-cache");
    const externalIds = await getExternalIds(input.mediaType, input.tmdbId).catch(() => null);
    imdbId = externalIds?.imdb_id ?? null;
  }

  const summary = await getTitleAvailability({
    mediaType: input.mediaType,
    imdbId,
    tmdbId: input.tmdbId > 0 ? input.tmdbId : null,
    region: "BR",
  });

  const best = summary.bestProvider;
  await refreshTitleStateAvailability(
    input.userId,
    input.tmdbId,
    input.mediaType,
    best
      ? {
          providerName: best.name,
          providerType: best.type === "streaming" ? "subscription" : best.type,
          providerLogo: best.logoUrl ?? null,
        }
      : null,
  );
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

export type UserLibraryIdentifiers = {
  tmdbKeys: Set<string>;
  imdbKeys: Set<string>;
};

/**
 * Identificadores da biblioteca (IDs apenas, sem disponibilidade). Leitura barata
 * para filtros de descoberta — ver getUserLibraryIdentifiers no local service.
 */
export async function getUserLibraryIdentifiers(
  userId: string,
): Promise<UserLibraryIdentifiers> {
  const local = await getLocalLibraryService();
  return local.getUserLibraryIdentifiers(userId);
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

  // Disponibilidade POPLOG-first via camada global (substitui o sync TMDB legado).
  // Fire-and-forget: persiste best_provider no user_title_state para consumidores
  // que leem o estado materializado (continuidade, acompanhando, etc.).
  void persistBestProviderFromGlobalLayer(input).catch((err) =>
    console.error("[availability] global layer refresh failed", err),
  );

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
