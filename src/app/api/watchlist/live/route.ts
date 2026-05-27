import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  formatEpisodeRuntimeLabel,
  formatRuntimeLabel,
  translateGenreName,
} from "@/lib/domain-labels";
import { resolveRuntimeByMediaType } from "@/lib/runtime";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { supabaseAdmin } from "@/server/supabase/admin";
import {
  readContinuitySectionCache,
  writeContinuitySectionCache,
} from "@/server/continuity/continuity-section-cache";

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

type TitleRow = {
  tmdb_id: number;
  media_type: MediaType;
  title: string | null;
  original_title: string | null;
  poster_path: string | null;
  release_date: string | null;
  first_air_date: string | null;
  runtime: number | null;
  episode_run_time: number[] | null;
  number_of_seasons: number | null;
  genres: Array<{ id: number; name: string }> | string[] | null;
};

type AvailabilityRow = {
  tmdb_id: number;
  media_type: MediaType;
  provider_name: string;
  provider_logo_path: string | null;
  availability_type: string;
  country: string;
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

type WatchlistLiveCachePayload = {
  inputKey: string;
  titles: EnrichedTitle[];
  generatedAt: string;
};

const WATCHLIST_LIVE_CACHE_TTL_MS = 30 * 60_000;

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

function buildInputKey(rows: WatchlistRow[]) {
  const normalized = rows
    .map((row) => ({
      id: row.id,
      tmdb_id: row.tmdb_id,
      media_type: row.media_type,
      created_at: row.created_at,
      fridge: Boolean(row.fridge),
      stream_status: row.stream_status ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return createHash("sha1").update(JSON.stringify(normalized)).digest("hex");
}

function normalizeGenres(genres: TitleRow["genres"]): string | null {
  if (!Array.isArray(genres)) return null;
  const first = genres[0];
  if (typeof first === "string") return translateGenreName(first) ?? first;
  return translateGenreName(first?.name) ?? first?.name ?? null;
}

function providerType(type: string): "flatrate" | "rent" | "buy" {
  if (type === "buy") return "buy";
  if (type === "rent") return "rent";
  return "flatrate";
}

function markStage(perf: Record<string, number>, stageRef: { value: number }, stage: string) {
  perf[stage] = Date.now() - stageRef.value;
  stageRef.value = Date.now();
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const totalStartedAt = Date.now();
  const perf: Record<string, number> = {};
  const stageRef = { value: totalStartedAt };

  try {
    const { titles } = await request.json();
    markStage(perf, stageRef, "request_parse");

    if (!Array.isArray(titles) || titles.length === 0) {
      return NextResponse.json({ titles: [] });
    }

    const rows = titles as WatchlistRow[];
    const currentUser = await getCurrentUser();
    markStage(perf, stageRef, "auth");

    const inputKey = buildInputKey(rows);
    const sectionKey = "home_watchlist_live";

    if (currentUser) {
      const cached = await readContinuitySectionCache<WatchlistLiveCachePayload>(sectionKey, {
        userId: currentUser.id,
        region: "BR",
        language: "pt-BR",
      });
      markStage(perf, stageRef, "cache_read");

      if (cached?.status === "hit" && cached.payload.inputKey === inputKey) {
        console.log("[watchlist/live/perf]", {
          cacheStatus: "persistent_hit",
          returned: cached.payload.titles.length,
          ...perf,
          total: Date.now() - totalStartedAt,
        });
        return NextResponse.json({ titles: cached.payload.titles });
      }
    }

    const ids = Array.from(new Set(rows.map((row) => row.tmdb_id)));
    const [titlesResult, availabilityResult] = await Promise.all([
      supabaseAdmin
        .from("poplog3_titles")
        .select("tmdb_id, media_type, title, original_title, poster_path, release_date, first_air_date, runtime, episode_run_time, number_of_seasons, genres")
        .in("tmdb_id", ids),
      supabaseAdmin
        .from("poplog3_title_availability")
        .select("tmdb_id, media_type, provider_name, provider_logo_path, availability_type, country")
        .in("tmdb_id", ids)
        .eq("country", "BR"),
    ]);
    markStage(perf, stageRef, "cache_tables_read");

    const titleMap = new Map<string, TitleRow>(
      ((titlesResult.data ?? []) as TitleRow[]).map((title) => [
        `${title.media_type}:${title.tmdb_id}`,
        title,
      ]),
    );
    const providersByKey = new Map<string, AvailabilityRow[]>();
    for (const row of (availabilityResult.data ?? []) as AvailabilityRow[]) {
      const key = `${row.media_type}:${row.tmdb_id}`;
      const list = providersByKey.get(key) ?? [];
      list.push(row);
      providersByKey.set(key, list);
    }

    const enriched: EnrichedTitle[] = rows
      .map((row): EnrichedTitle | null => {
        const details = titleMap.get(`${row.media_type}:${row.tmdb_id}`);
        if (!details) return null;
        const releaseDate =
          details.release_date ?? details.first_air_date ??
          (row.release_year ? `${row.release_year}-01-01` : null);
        const providerRows = providersByKey.get(`${row.media_type}:${row.tmdb_id}`) ?? [];
        const providers: EnrichedTitle["providers"] = providerRows.map((provider) => ({
          name: provider.provider_name,
          logo: provider.provider_logo_path ?? "",
          type: providerType(provider.availability_type),
        }));
        const hasSubscription = providerRows.some((provider) =>
          ["streaming", "free", "ads"].includes(provider.availability_type),
        );
        const hasVod = providerRows.some((provider) =>
          ["rent", "buy"].includes(provider.availability_type),
        );
        const availabilityStatus = hasSubscription
          ? "streaming_confirmed_br"
          : hasVod
            ? "vod_available_br"
            : undefined;
        const seasons = row.media_type === "tv" ? (details.number_of_seasons ?? null) : null;
        const runtimeResolution = resolveRuntimeByMediaType({
          mediaType: row.media_type,
          runtimeMinutes: details.runtime ?? null,
          episodeRunTime: details.episode_run_time ?? null,
        });
        const runtimeLabel =
          row.media_type === "tv"
            ? formatEpisodeRuntimeLabel(runtimeResolution.minutes, {
                estimated: runtimeResolution.estimated,
              })
            : formatRuntimeLabel(runtimeResolution.minutes, {
                estimated: runtimeResolution.estimated,
              });
        const streamStatus = inferStreamStatus(releaseDate, row, availabilityStatus);
        const title = details.title ?? row.title ?? "Sem título";

        return {
          id: row.id,
          tmdb_id: row.tmdb_id,
          media_type: row.media_type,
          title,
          original_title_label: details.original_title ?? null,
          poster_path: details.poster_path ?? null,
          year: releaseDate ? String(new Date(releaseDate).getFullYear()) : null,
          genre: normalizeGenres(details.genres),
          runtime: runtimeResolution.minutes,
          runtime_label: runtimeLabel,
          seasons,
          origin: "streaming",
          release_date: releaseDate ?? `${row.release_year ?? new Date().getFullYear()}-01-01`,
          created_at: row.created_at,
          stream_status: streamStatus,
          providers,
          estimated_platform: null,
          estimated_month: null,
          context_pool: buildContextPool(title, row.media_type),
          fridge: row.fridge ?? false,
          stream_status_updated: false,
        };
      })
      .filter((title): title is EnrichedTitle => Boolean(title));
    markStage(perf, stageRef, "response_build");

    if (currentUser) {
      await writeContinuitySectionCache({
        sectionKey,
        userId: currentUser.id,
        region: "BR",
        language: "pt-BR",
        ttlMs: WATCHLIST_LIVE_CACHE_TTL_MS,
        payload: {
          inputKey,
          titles: enriched,
          generatedAt: new Date().toISOString(),
        } satisfies WatchlistLiveCachePayload,
      });
      markStage(perf, stageRef, "cache_write");
    }

    console.log("[watchlist/live/perf]", {
      cacheStatus: "persistent_miss",
      input: rows.length,
      returned: enriched.length,
      external_sync: 0,
      ...perf,
      total: Date.now() - totalStartedAt,
    });

    return NextResponse.json({ titles: enriched });
  } catch (error) {
    console.error("[watchlist/live] unhandled error", error);
    return NextResponse.json({ titles: [] }, { status: 200 });
  }
}
