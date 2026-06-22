import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  formatEpisodeRuntimeLabel,
  formatRuntimeLabel,
  translateGenreName,
} from "@/lib/domain-labels";
import { resolveRuntimeByMediaType } from "@/lib/runtime";
import { resolveDisplayTitle } from "@/lib/titles/display-title";
import { recoverTitleFromRowSync } from "@/server/titles/recover-canonical-title";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { db } from "@/server/db/client";
import {
  readContinuitySectionCache,
  writeContinuitySectionCache,
} from "@/server/continuity/continuity-section-cache";
import {
  hydrateManyTitleAvailability,
  type TitleAvailabilitySummary,
} from "@/server/availability";
import {
  isSyntheticTmdbId,
  imdbIdFromSyntheticTmdbId,
} from "@/lib/ids/synthetic-tmdb-id";

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

/**
 * Deriva o stream_status a partir do resumo CANÔNICO da camada global de
 * disponibilidade (mesma fonte da Biblioteca, Página de Título e badges).
 *
 * Prioridade: cinema > lançamento futuro > streaming > VOD (aluguel/compra).
 *
 * Fallback seguro: quando a disponibilidade é DESCONHECIDA (Balloonerismm em
 * cooldown/erro = state "provider_error", ou ID não resolvível = "unresolved",
 * ou hidratação sem resultado), NUNCA marca "Indisponível". Cai na heurística de
 * data de lançamento. Só marca "unavailable" quando o estado é genuinamente
 * "unavailable" (checado, lançado e sem providers no BR).
 */
function streamStatusFromAvailability(
  summary: TitleAvailabilitySummary | undefined,
  releaseDate: string | null,
  row: WatchlistRow,
): EnrichedTitle["stream_status"] {
  const status = summary?.status;
  if (status?.isInTheaters && row.media_type === "movie") return "cinemas";
  if (status?.isFutureRelease) return "chegando";
  if (status?.hasStreaming) return "streaming";
  if (status?.hasRent || status?.hasBuy) return "confirmado";

  const released = releaseDate ? new Date(releaseDate) <= new Date() : false;
  const knownUnavailable = summary?.state === "unavailable";

  if (!knownUnavailable) {
    // Estado desconhecido (cooldown/erro/não resolvido/sem hidratação): fallback seguro.
    if (!releaseDate) return "streaming";
    return released ? "streaming" : row.media_type === "movie" ? "cinemas" : "chegando";
  }

  // Genuinamente sem providers no BR.
  if (!releaseDate) return "unavailable";
  if (!released) return row.media_type === "movie" ? "cinemas" : "chegando";
  return "unavailable";
}

/** Converte os providers agrupados do resumo global para o formato do card. */
function providersFromSummary(
  summary: TitleAvailabilitySummary | undefined,
): EnrichedTitle["providers"] {
  if (!summary) return [];
  const g = summary.providers;
  const out: EnrichedTitle["providers"] = [];
  for (const p of [...g.flatrate, ...g.free, ...g.ads]) {
    out.push({ name: p.name, logo: p.logoUrl ?? "", type: "flatrate" });
  }
  for (const p of g.rent) out.push({ name: p.name, logo: p.logoUrl ?? "", type: "rent" });
  for (const p of g.buy) out.push({ name: p.name, logo: p.logoUrl ?? "", type: "buy" });
  return out;
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
  // Recuperação canônica LOCAL (sem rede) a partir de payload/originalTitle.
  const recovered = recoverTitleFromRowSync({
    id: row.id,
    tmdbId: row.tmdbId,
    imdbId: row.imdbId ?? external?.imdbId ?? null,
    traktId: row.traktId ?? external?.traktId ?? null,
    slug: row.slug,
    mediaType: row.mediaType,
    title: row.title,
    originalTitle: row.originalTitle,
    tmdbPayload: row.tmdbPayload,
    sourcePayload: row.sourcePayload,
  });
  return {
    poplogId: row.id,
    tmdb_id: row.tmdbId,
    media_type: row.mediaType,
    externalIds,
    identityUsed: external?.imdbId ? "imdb_id" : "poplog_id",
    linkIdUsed: external?.imdbId ?? row.id,
    title: recovered.title ?? row.title,
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

      // Só serve cache FRESCO ("hit"). Um "stale" é regenerado: a hidratação cacheOnly é
      // barata e evita servir indefinidamente um snapshot ruim congelado (ex.: lote que
      // falhou sob carga marcando tudo como "Indisponível").
      if (cached?.status === "hit" && cached.payload.inputKey === inputKey) {
        console.log("[watchlist/live/perf]", {
          cacheStatus: "persistent_hit",
          returned: cached.payload.titles.length,
          external_sync: 0,
          ...perf,
          total: Date.now() - totalStartedAt,
        });
        // Sanitize: stale cache may have nested title objects from pre-fix data
        const sanitized = cached.payload.titles.map((t) => ({
          ...t,
          title: resolveDisplayTitle({
            title: extractTitleStr(t.title),
            originalTitle: t.original_title_label,
            tmdbId: t.externalIds?.tmdbId ?? t.tmdb_id,
            imdbId: t.externalIds?.imdbId,
            poplogId: t.poplogId,
            mediaType: t.media_type,
          }),
        }));
        return NextResponse.json({ titles: sanitized });
      }
    } else {
      perf.cache_read = 0;
    }

    const ids = Array.from(new Set(rows.map((row) => row.tmdb_id)));
    const [titlesResult, imdbByTmdbKey] = await withTimeout(
      (async (): Promise<[TitleRow[], Map<string, string>]> => {
        const [titleRows, externalRows] = await Promise.all([
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
        ]);
        const externalByKey = new Map(
          externalRows.map((row) => [externalKey(row.mediaType, row.tmdbId), row]),
        );
        const imdbMap = new Map<string, string>();
        for (const ext of externalRows) {
          if (ext.imdbId) imdbMap.set(externalKey(ext.mediaType, ext.tmdbId), ext.imdbId);
        }
        return [
          titleRows.map((row) =>
            mapTitleRow(row, externalByKey.get(externalKey(row.mediaType, row.tmdbId))),
          ),
          imdbMap,
        ];
      })(),
      TABLE_READ_TIMEOUT_MS,
      [[], new Map<string, string>()],
    );
    markStage(perf, stageRef, "cache_tables_read");

    const titleMap = new Map<string, TitleRow>(
      titlesResult.map((title) => [
        `${title.media_type}:${title.tmdb_id}`,
        title,
      ]),
    );

    // ── Disponibilidade via camada GLOBAL (cache-first, fonte única) ───────────
    // Mesma fonte da Biblioteca/Página de Título/badges. Resolve imdbId por linha
    // (row.imdb_id → titleExternalId → derivação sintética) e hidrata em lote.
    // hydrateManyTitleAvailability é cache-first (catalog_availability por imdbId),
    // então recargas são baratas; cold-start é limitado por concorrência.
    function resolveRowImdbId(row: WatchlistRow): string | null {
      if (row.imdb_id) return row.imdb_id;
      if (row.externalIds?.imdbId) return row.externalIds.imdbId;
      const fromExternal = imdbByTmdbKey.get(externalKey(row.media_type, row.tmdb_id));
      if (fromExternal) return fromExternal;
      if (isSyntheticTmdbId(row.tmdb_id)) return imdbIdFromSyntheticTmdbId(row.tmdb_id);
      return null;
    }

    const hydrationInputs = rows
      .map((row) => {
        const imdbId = resolveRowImdbId(row);
        const tmdbId = row.tmdb_id > 0 ? row.tmdb_id : null;
        if (!imdbId && !tmdbId) return null;
        const details = titleMap.get(`${row.media_type}:${row.tmdb_id}`);
        return {
          key: row.id,
          input: {
            mediaType: row.media_type,
            imdbId,
            tmdbId,
            region: "BR",
            releaseDate: details?.release_date ?? null,
            firstAirDate: details?.first_air_date ?? null,
          },
        };
      })
      .filter((entry): entry is { key: string; input: NonNullable<typeof entry>["input"] } => entry !== null);

    const availabilityByRow = hydrationInputs.length
      ? await withTimeout(
          hydrateManyTitleAvailability(hydrationInputs, { cacheOnly: true, warmCold: true }),
          TABLE_READ_TIMEOUT_MS,
          new Map<string, TitleAvailabilitySummary>(),
        ).catch(() => new Map<string, TitleAvailabilitySummary>())
      : new Map<string, TitleAvailabilitySummary>();
    markStage(perf, stageRef, "availability_hydrate");

    const enriched: EnrichedTitle[] = rows
      .map((row): EnrichedTitle | null => {
        const details = titleMap.get(`${row.media_type}:${row.tmdb_id}`);
        if (!details) return null;
        const releaseDate =
          details.release_date ?? details.first_air_date ??
          (row.release_year ? `${row.release_year}-01-01` : null);
        const summary = availabilityByRow.get(row.id);
        const providers = providersFromSummary(summary);
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
        const streamStatus = streamStatusFromAvailability(summary, releaseDate, row);
        const title = resolveDisplayTitle({
          title: details.title ?? extractTitleStr(row.title),
          originalTitle: details.original_title,
          tmdbId: row.tmdb_id,
          imdbId: row.imdb_id ?? row.externalIds?.imdbId,
          poplogId: row.poplogId,
          slug: row.slug,
          mediaType: row.media_type,
        });

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
