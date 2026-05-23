import { NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";
import {
  formatEpisodeRuntimeLabel,
  formatRuntimeLabel,
  translateGenreName,
} from "@/lib/domain-labels";
import { resolveRuntimeByMediaType } from "@/lib/runtime";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getSeriesEpisodeRuntimesMap } from "@/server/runtime/series-episode-runtimes";
import { getAvailabilityForDisplay } from "@/server/streaming/title-availability";
import { getUserProviderPreferences } from "@/server/streaming/user-provider-preferences";

// ─── Types ────────────────────────────────────────────────────────────────────

type MediaType = "movie" | "tv";

type WatchlistRow = {
  id: string;
  tmdb_id: number;
  media_type: MediaType;
  title: string | null;
  release_year: number | null;
  created_at: string;
  fridge?: boolean | null;
  stream_status?: string | null;
  stream_status_checked_at?: string | null;
};

type TMDBDetails = {
  id?: number;
  title?: string;
  name?: string;
  original_title?: string | null;
  original_name?: string | null;
  poster_path?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  runtime?: number | null;
  episode_run_time?: number[] | null;
  number_of_seasons?: number | null;
  genres?: Array<{ id: number; name: string }>;
};

type EnrichedTitle = {
  id: string;
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  original_title_label: string | null;
  poster_path: string | null;
  year: string | null;
  genre: string | null;
  runtime: number | null;
  runtime_label: string | null;
  seasons: number | null;
  origin: "cinema" | "streaming";
  release_date: string;
  created_at: string;
  stream_status: "streaming" | "chegando" | "cinemas" | "confirmado" | "unavailable";
  providers: { name: string; logo: string; type: "flatrate" | "rent" | "buy" }[];
  estimated_platform: string | null;
  estimated_month: string | null;
  context_pool: string[];
  fridge: boolean;
  stream_status_updated: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferStreamStatus(
  releaseDate: string | null,
  row: WatchlistRow,
  availabilityStatus?: string,
): EnrichedTitle["stream_status"] {
  if (availabilityStatus === "streaming_confirmed_br") return "streaming";
  if (availabilityStatus === "vod_available_br") return "confirmado";
  if (
    availabilityStatus === "vod_available_us" ||
    availabilityStatus === "pvod_available_us" ||
    availabilityStatus === "streaming_confirmed_us" ||
    availabilityStatus === "digital_prediction"
  ) {
    return "chegando";
  }
  if (availabilityStatus === "cinema") return "cinemas";
  if (row.stream_status === "streaming" || row.stream_status === "confirmado") return "streaming";
  if (row.stream_status === "chegando") return "chegando";
  // Bug fix: não classificar séries como "cinemas" — séries vão direto para streaming
  // "cinemas" só se aplica a filmes com lançamento em sala confirmado
  if (row.stream_status === "cinemas" && row.media_type === "movie") return "cinemas";
  if (!releaseDate) return "unavailable";
  const released = new Date(releaseDate) <= new Date();
  if (!released) {
    // Título ainda não lançado: filmes podem estar em cartaz, séries vão para streaming
    return row.media_type === "movie" ? "cinemas" : "chegando";
  }
  return "streaming";
}

function buildContextPool(title: string, mediaType: MediaType): string[] {
  if (mediaType === "movie") {
    return [
      `${title} está na sua lista`,
      "Salvo para assistir depois",
      "Na sua watchlist",
    ];
  }
  return [
    `${title} está na sua lista`,
    "Série salva para acompanhar",
    "Na sua watchlist",
  ];
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const { titles } = await request.json();

    if (!Array.isArray(titles) || titles.length === 0) {
      return NextResponse.json({ titles: [] });
    }

    const rows = titles as WatchlistRow[];
    const currentUser = await getCurrentUser();
    const preferences = currentUser ? await getUserProviderPreferences().catch(() => null) : null;
    const tvIds = rows
      .filter((row) => row.media_type === "tv")
      .map((row) => row.tmdb_id);
    const episodeRuntimesBySeries =
      tvIds.length > 0 ? await getSeriesEpisodeRuntimesMap(tvIds) : new Map();

    const enriched = await Promise.all(
      rows.map(async (row): Promise<EnrichedTitle | null> => {
        try {
          const details = await tmdbFetch<TMDBDetails>(`/${row.media_type}/${row.tmdb_id}`);

          const releaseDate =
            details.release_date ?? details.first_air_date ??
            (row.release_year ? `${row.release_year}-01-01` : null);
          const availabilityResult = await getAvailabilityForDisplay({
            tmdbId: row.tmdb_id,
            mediaType: row.media_type,
            releaseDate: details.release_date ?? null,
            firstAirDate: details.first_air_date ?? null,
            preferences,
            contexts: ["watchlist", "home"],
            endpoint: "/api/watchlist/live",
          }).catch(() => null);

          const genre = translateGenreName(details.genres?.[0]?.name) ?? null;
          const seasons = row.media_type === "tv" ? (details.number_of_seasons ?? null) : null;
          const runtimeResolution = resolveRuntimeByMediaType({
            mediaType: row.media_type,
            runtimeMinutes: details.runtime ?? null,
            episodeRunTime: details.episode_run_time ?? null,
            episodes: episodeRuntimesBySeries.get(row.tmdb_id) ?? null,
          });
          const runtimeLabel =
            row.media_type === "tv"
              ? formatEpisodeRuntimeLabel(runtimeResolution.minutes, {
                  estimated: runtimeResolution.estimated,
                })
              : formatRuntimeLabel(runtimeResolution.minutes, {
                  estimated: runtimeResolution.estimated,
                });
          const streamStatus = inferStreamStatus(
            releaseDate,
            row,
            availabilityResult?.availability.status,
          );
          const providers: EnrichedTitle["providers"] =
            availabilityResult?.providers.map((provider) => ({
              name: provider.name,
              logo: provider.logoPath ?? provider.logoUrl ?? "",
              type:
                provider.normalizedType === "subscription"
                  ? "flatrate"
                  : provider.normalizedType === "buy"
                    ? "buy"
                    : "rent",
            })) ?? [];

          return {
            id:                    row.id,
            tmdb_id:               row.tmdb_id,
            media_type:            row.media_type,
            title:                 details.title ?? details.name ?? row.title ?? "Sem título",
            original_title_label:  details.original_title ?? details.original_name ?? null,
            poster_path:           details.poster_path ?? null,
            year:                  releaseDate ? String(new Date(releaseDate).getFullYear()) : null,
            genre,
            runtime:               runtimeResolution.minutes,
            runtime_label:         runtimeLabel,
            seasons,
            origin:                "streaming",
            release_date:          releaseDate ?? `${row.release_year ?? new Date().getFullYear()}-01-01`,
            created_at:            row.created_at,
            stream_status:         streamStatus,
            providers,
            estimated_platform:    null,
            estimated_month:       null,
            context_pool:          buildContextPool(
              details.title ?? details.name ?? row.title ?? "Este título",
              row.media_type,
            ),
            fridge:                row.fridge ?? false,
            stream_status_updated: false,
          };
        } catch {
          return null;
        }
      }),
    );

    return NextResponse.json({ titles: enriched.filter(Boolean) as EnrichedTitle[] });
  } catch {
    return NextResponse.json({ titles: [] }, { status: 200 });
  }
}
