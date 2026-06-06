import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  formatEpisodeRuntimeLabel,
  formatRuntimeLabel,
  translateGenreName,
} from "@/lib/domain-labels";
import { resolveRuntimeByMediaType } from "@/lib/runtime";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { db } from "@/server/db/client";
import {
  readContinuitySectionCache,
  writeContinuitySectionCache,
} from "@/server/continuity/continuity-section-cache";

// ─── Types ────────────────────────────────────────────────────────────────────

type MediaType = "movie" | "tv";

type WatchlistRow = {
  id: string;
  poplogId?: string | number | null;
  tmdb_id: number;
  media_type: MediaType;
  externalIds?: TitleIdentityFields["externalIds"];
  imdb_id?: string | null;
  slug?: string | null;
  title: string | null;
  release_year: number | null;
  created_at: string;
  fridge?: boolean | null;
  stream_status?: string | null;
  stream_status_checked_at?: string | null;
};

type TitleRow = {
  poplogId?: string | number | null;
  tmdb_id: number;
  media_type: MediaType;
  externalIds?: TitleIdentityFields["externalIds"];
  identityUsed?: string;
  linkIdUsed?: string | number;
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
  poplogId?: string | number | null;
  tmdb_id: number;
  media_type: MediaType;
  externalIds?: TitleIdentityFields["externalIds"];
  identityUsed?: string;
  linkIdUsed?: string | number;
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

type TitleIdentityFields = {
  externalIds?: {
    tmdbId?: number;
    imdbId?: string;
    tvdbId?: string;
    traktId?: string;
    balloonerismmId?: string;
    slug?: string;
  };
};

type WatchlistLiveCachePayload = {
  inputKey: string;
  titles: EnrichedTitle[];
  generatedAt: string;
};

type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

const WATCHLIST_LIVE_CACHE_TTL_MS = 30 * 60_000;
const AUTH_TIMEOUT_MS = 900;
const TABLE_READ_TIMEOUT_MS = 2_500;

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

function extractTitleStr(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim() || null;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.title === "string") return obj.title.trim() || null;
  }
  return null;
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
  if (type === "subscription" || type === "streaming") return "flatrate";
  if (type === "buy") return "buy";
  if (type === "rent") return "rent";
  return "flatrate";
}

function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function numericJsonArray(value: unknown): number[] | null {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : null;
}

function externalKey(mediaType: string, tmdbId: number) {
  return `${mediaType}:${tmdbId}`;
}

function mapExternalIds(row: {
  tmdbId: number;
  imdbId: string | null;
  tvdbId: string | null;
  traktId: string | null;
} | null): TitleIdentityFields["externalIds"] {
  if (!row) return undefined;
  return {
    tmdbId: row.tmdbId,
    ...(row.imdbId ? { imdbId: row.imdbId, balloonerismmId: row.imdbId } : {}),
    ...(row.tvdbId ? { tvdbId: row.tvdbId } : {}),
    ...(row.traktId ? { traktId: row.traktId } : {}),
  };
}

function mapTitleRow(
  row: Awaited<ReturnType<typeof db.poplog3Title.findMany>>[number],
  external?: {
    tmdbId: number;
    imdbId: string | null;
    tvdbId: string | null;
    traktId: string | null;
  } | null,
): TitleRow {
  const externalIds = mapExternalIds(external ?? null);
  return {
    poplogId: row.id,
    tmdb_id: row.tmdbId,
    media_type: row.mediaType,
    externalIds,
    identityUsed: external?.imdbId ? "imdb_id" : "poplog_id",
    linkIdUsed: external?.imdbId ?? row.id,
    title: row.title,
    original_title: row.originalTitle,
    poster_path: row.posterPath,
    release_date: dateOnly(row.releaseDate),
    first_air_date: dateOnly(row.firstAirDate),
    runtime: row.runtime,
    episode_run_time: numericJsonArray(row.episodeRunTime),
    number_of_seasons: row.numberOfSeasons,
    genres: Array.isArray(row.genres) ? row.genres as Array<{ id: number; name: string }> | string[] : null,
  };
}

function mapAvailabilityRow(row: Awaited<ReturnType<typeof db.catalogAvailability.findMany>>[number]): AvailabilityRow | null {
  if (row.tmdbId === null) return null;
  return {
    tmdb_id: Number(row.tmdbId),
    media_type: row.mediaType,
    provider_name: row.providerName,
    provider_logo_path: row.providerLogoUrl,
    availability_type: row.providerType,
    country: row.providerRegion,
  };
}

function markStage(perf: Record<string, number>, stageRef: { value: number }, stage: string) {
  perf[stage] = Date.now() - stageRef.value;
  stageRef.value = Date.now();
}

function markLocalStage(perf: Record<string, number>, stageRef: { value: number }, stage: string) {
  markStage(perf, stageRef, stage);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

async function resolveCurrentUserWithPerf(): Promise<{
  user: CurrentUser | null;
  timedOut: boolean;
  perf: Record<string, number>;
}> {
  const perf: Record<string, number> = {};
  const stageRef = { value: Date.now() };

  const authPromise = (async () => {
    const user = await getCurrentUser();
    markLocalStage(perf, stageRef, "resolve_user");
    perf.read_cookies = 0;

    if (!user) {
      perf.get_session = 0;
      perf.get_user = 0;
      perf.profile_lookup = 0;
      perf.fallback_user_resolution = 0;
      return { user: null, timedOut: false, perf };
    }

    perf.get_session = 0;
    perf.get_user = 0;
    perf.profile_lookup = 0;
    perf.fallback_user_resolution = 0;

    return { user, timedOut: false, perf };
  })();

  return withTimeout(authPromise, AUTH_TIMEOUT_MS, {
    user: null,
    timedOut: true,
    perf: {
      ...perf,
      fallback_user_resolution: Date.now() - stageRef.value,
    },
  });
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
    const authResolution = await resolveCurrentUserWithPerf();
    const currentUser = authResolution.user;
    Object.entries(authResolution.perf).forEach(([key, value]) => {
      perf[`auth_${key}`] = value;
    });
    perf.auth_timed_out = authResolution.timedOut ? 1 : 0;
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

      if ((cached?.status === "hit" || cached?.status === "stale") && cached.payload.inputKey === inputKey) {
        console.log("[watchlist/live/perf]", {
          cacheStatus: cached.status === "hit" ? "persistent_hit" : "persistent_stale",
          returned: cached.payload.titles.length,
          external_sync: 0,
          ...perf,
          total: Date.now() - totalStartedAt,
        });
        // Sanitize: stale cache may have nested title objects from pre-fix data
        const sanitized = cached.payload.titles.map((t) => ({
          ...t,
          title: extractTitleStr(t.title) ?? "Sem título",
        }));
        return NextResponse.json({ titles: sanitized });
      }
    } else {
      perf.cache_read = 0;
    }

    const ids = Array.from(new Set(rows.map((row) => row.tmdb_id)));
    const [titlesResult, availabilityResult] = await withTimeout(
      (async (): Promise<[TitleRow[], AvailabilityRow[]]> => {
        const [titleRows, externalRows, availabilityRows] = await Promise.all([
          db.poplog3Title.findMany({
            where: { tmdbId: { in: ids } },
          }),
          db.titleExternalId.findMany({
            where: { tmdbId: { in: ids } },
            select: {
              tmdbId: true,
              mediaType: true,
              imdbId: true,
              tvdbId: true,
              traktId: true,
            },
          }),
          db.catalogAvailability.findMany({
            where: {
              tmdbId: { in: ids.map((id) => BigInt(id)) },
              providerRegion: "BR",
              expiresAt: { gt: new Date() },
            },
          }),
        ]);
        const externalByKey = new Map(
          externalRows.map((row) => [externalKey(row.mediaType, row.tmdbId), row]),
        );
        return [
          titleRows.map((row) =>
            mapTitleRow(row, externalByKey.get(externalKey(row.mediaType, row.tmdbId))),
          ),
          availabilityRows.map(mapAvailabilityRow).filter((row): row is AvailabilityRow => row !== null),
        ];
      })(),
      TABLE_READ_TIMEOUT_MS,
      [[], []],
    );
    markStage(perf, stageRef, "cache_tables_read");

    const titleMap = new Map<string, TitleRow>(
      titlesResult.map((title) => [
        `${title.media_type}:${title.tmdb_id}`,
        title,
      ]),
    );

    const providersByKey = new Map<string, AvailabilityRow[]>();
    for (const row of availabilityResult) {
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
        const title = details.title ?? extractTitleStr(row.title) ?? "Sem título";

        return {
          id: row.id,
          poplogId: row.poplogId ?? details.poplogId ?? null,
          tmdb_id: row.tmdb_id,
          media_type: row.media_type,
          externalIds: {
            ...(details.externalIds ?? {}),
            ...(row.externalIds ?? {}),
            tmdbId: row.tmdb_id,
            ...(row.imdb_id ? { imdbId: row.imdb_id, balloonerismmId: row.imdb_id } : {}),
            ...(row.slug ? { slug: row.slug } : {}),
          },
          identityUsed: row.externalIds?.imdbId ?? row.imdb_id ? "imdb_id" : details.identityUsed,
          linkIdUsed: row.externalIds?.imdbId ?? row.imdb_id ?? row.poplogId ?? details.linkIdUsed,
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
      void writeContinuitySectionCache({
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
      perf.cache_write = 0;
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
