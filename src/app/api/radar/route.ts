// -- /api/radar ─────────────────────────────────────────────────────────────────
// Endpoint unificado do Radar:
//
//   GET /api/radar?mode=general  -> Radar Geral: feed ICS + TMDB completo.
//   GET /api/radar?mode=personal -> Radar Personalizado: mesmo feed, filtrado
//                                   pelos tmdb_ids que o usuario tem na biblioteca
//                                   (watching, watchlist, watched).
//
// Modo personal sem usuario autenticado retorna o feed geral sem filtro.
// ──────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/server/supabase/admin";
import type { IcsAgendaResponse, RadarSections } from "@/app/api/ics/agenda/route";
import type { IcsSeriesGroup } from "@/lib/ics-engine";
import { getCurrentUser } from "@/server/auth/get-current-user";
import {
  readContinuitySectionCache,
  writeContinuitySectionCache,
} from "@/server/continuity/continuity-section-cache";

// Nao usar cache do Next.js -- gerenciamos o cache manualmente no Supabase
export const revalidate = 0;

export type RadarMode = "general" | "personal";

export interface RadarResponse {
  mode: RadarMode;
  /** Presente em ambos os modos -- payload ICS (completo ou filtrado) */
  general?: IcsAgendaResponse;
  generatedAt: string;
  /** Espelha general.cacheVersion para inspecao rapida */
  cacheVersion?: number;
  /** Espelha general.fromCache para inspecao rapida */
  fromCache?: boolean;
  /** Sempre false -- RAW_BDS_MODE removido, pipeline e unico */
  rawBdsMode?: boolean;
  /** Espelha general.sections para acesso direto */
  sections?: RadarSections;
  /** true quando o filtro de biblioteca foi aplicado */
  libraryFiltered?: boolean;
  /** Quantidade de titulos na biblioteca do usuario */
  librarySize?: number;
  /** tmdb_ids dos filmes na biblioteca (modo personal) */
  libraryMovieIds?: number[];
  /** Debug info para diagnosticar filtro personalizado */
  _debug?: {
    userId: string | null;
    libraryIdsCount: number;
    sampleLibraryIds: number[];
    feedTotal: number;
    feedWithTmdb: number;
    sampleFeedIds: (number | string)[];
    matchCount: number;
  };
}

const CACHE_ID = "main";
const CACHE_TTL_H = 24;
const CACHE_SCHEMA_VERSION = 10; // deve ser igual ao de agenda/route.ts
const RADAR_CACHE_TTL_MS = 10 * 60_000;
const DEFAULT_REGION = "BR";
const DEFAULT_LANGUAGE = "pt-BR";
const RADAR_MEMORY_CACHE_TTL_MS = 5 * 60_000;

// Statuses que definem "esta na minha biblioteca"
// "fridge" excluido — itens pausados nao aparecem no Personalizado
const LIBRARY_STATUSES = ["watching", "watchlist", "watched"] as const;
const refreshes = new Map<string, Promise<void>>();
const generalMemoryCache = new Map<string, { payload: RadarResponse; expiresAt: number }>();

function markStage(perf: Record<string, number>, stageRef: { value: number }, stage: string) {
  perf[stage] = Date.now() - stageRef.value;
  stageRef.value = Date.now();
}

// ── Le cache Supabase do pipeline ICS ────────────────────────────────────────

async function readIcsCache(): Promise<IcsAgendaResponse | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("ics_agenda_cache")
      .select("payload, cached_at")
      .eq("id", CACHE_ID)
      .single();

    if (error || !data) return null;

    const cachedAt = new Date(data.cached_at as string);
    const ageHours = (Date.now() - cachedAt.getTime()) / 3_600_000;
    if (ageHours >= CACHE_TTL_H) return null;

    const payload = data.payload as unknown as IcsAgendaResponse;
    if (payload.cacheVersion !== CACHE_SCHEMA_VERSION) return null;

    return payload;
  } catch {
    return null;
  }
}

// ── Modo Geral: cache ICS ou rebuild ─────────────────────────────────────────

async function buildGeneralPayload(): Promise<IcsAgendaResponse> {
  const cached = await readIcsCache();
  if (cached) return { ...cached, fromCache: true };

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const res = await fetch(`${origin}/api/ics/agenda`, {
    cache: "no-store",
    headers: { "x-internal-request": "1" },
  });

  if (!res.ok) throw new Error(`ICS agenda pipeline returned ${res.status}`);

  const fresh = await res.json() as IcsAgendaResponse;
  return { ...fresh, fromCache: false };
}

// ── Busca os tmdb_ids da biblioteca do usuario ────────────────────────────────

interface LibraryIds {
  tvIds: Set<number>;
  movieIds: Set<number>;
}

async function fetchUserLibraryTmdbIds(userId: string): Promise<LibraryIds> {
  // user_title_state é a fonte primária (materializada, sempre atualizada)
  const { data: stateData, error: stateError } = await supabaseAdmin
    .from("user_title_state")
    .select("tmdb_id, media_type")
    .eq("user_id", userId)
    .in("status", LIBRARY_STATUSES);

  if (stateError) {
    console.error(`[radar/personal] user_title_state error for userId=${userId}:`, stateError);
  }

  const tvIds = new Set<number>();
  const movieIds = new Set<number>();

  if (stateData && stateData.length > 0) {
    for (const row of stateData as Array<{ tmdb_id: number; media_type: string }>) {
      if (row.media_type === "tv") tvIds.add(row.tmdb_id);
      else if (row.media_type === "movie") movieIds.add(row.tmdb_id);
    }
    console.log(`[radar/personal] library via user_title_state: ${tvIds.size} series, ${movieIds.size} movies (userId=${userId})`);
    return { tvIds, movieIds };
  }

  console.log(`[radar/personal] user_title_state vazia/erro para userId=${userId}, tentando user_titles`);

  // Fallback: user_titles
  const { data: legacyData, error: legacyError } = await supabaseAdmin
    .from("user_titles")
    .select("tmdb_id, media_type")
    .eq("user_id", userId)
    .in("status", LIBRARY_STATUSES);

  if (legacyError) {
    console.error(`[radar/personal] user_titles error for userId=${userId}:`, legacyError);
  }

  for (const row of (legacyData ?? []) as Array<{ tmdb_id: number; media_type: string }>) {
    if (row.media_type === "tv") tvIds.add(row.tmdb_id);
    else if (row.media_type === "movie") movieIds.add(row.tmdb_id);
  }
  console.log(`[radar/personal] library via user_titles (fallback): ${tvIds.size} series, ${movieIds.size} movies (userId=${userId})`);
  return { tvIds, movieIds };
}

// ── Filtra um payload ICS pelos tmdb_ids da biblioteca ───────────────────────

interface FilterDebug {
  feedTotal: number;
  feedWithTmdb: number;
  sampleFeedIds: (number | string)[];
  matchCount: number;
}

function filterPayloadByLibrary(
  payload: IcsAgendaResponse,
  libraryIds: Set<number>,
): { filtered: IcsAgendaResponse; debug: FilterDebug } {
  const allGroups = payload.groups ?? [];
  const withTmdb    = allGroups.filter((g) => g.tmdb?.tmdb_id != null).length;
  const withoutTmdb = allGroups.length - withTmdb;

  // Sample dos primeiros IDs do feed para debug
  const sampleFeedIds = allGroups
    .slice(0, 10)
    .map((g) => g.tmdb?.tmdb_id ?? `no-tmdb(${g.rawTitle?.slice(0, 20)})`);

  // Interseção entre feed e biblioteca
  const intersection = allGroups.filter((g) => {
    const id = g.tmdb?.tmdb_id;
    return id != null && libraryIds.has(id);
  });

  // Log especifico para series que sabemos que deveriam bater (debug)
  const WATCH_IDS = [85552, 4588, 271053, 224372]; // Euphoria, Drag Race, Half Man
  for (const watchId of WATCH_IDS) {
    const inFeed = allGroups.some((g) => g.tmdb?.tmdb_id === watchId);
    const inLib  = libraryIds.has(watchId);
    if (inFeed || inLib) {
      console.log(`[radar/personal/watch] tmdb_id=${watchId} inFeed=${inFeed} inLib=${inLib} typeof_lib_id=${typeof watchId}`);
    }
  }

  console.log(
    `[radar/personal/filter]` +
    ` feed_total=${allGroups.length}` +
    ` feed_com_tmdb=${withTmdb}` +
    ` feed_sem_tmdb=${withoutTmdb}` +
    ` library_ids=${libraryIds.size}` +
    ` match=${intersection.length}` +
    ` sample_feed_ids=${JSON.stringify(sampleFeedIds)}` +
    ` sample_lib_ids=${JSON.stringify([...libraryIds].slice(0, 10))}`,
  );

  function filterGroups(groups: IcsSeriesGroup[]): IcsSeriesGroup[] {
    return groups.filter((g) => {
      const tmdbId = g.tmdb?.tmdb_id;
      return tmdbId != null && libraryIds.has(tmdbId);
    });
  }

  const filteredGroups   = filterGroups(payload.groups ?? []);
  const filteredFeatured = filterGroups(payload.featuredGroups ?? []);

  // Filtra tambem as secoes (today/thisWeek/next30Days)
  const filteredSections = payload.sections
    ? {
        ...payload.sections,
        today:      filterGroups(payload.sections.today      ?? []),
        thisWeek:   filterGroups(payload.sections.thisWeek   ?? []),
        next30Days: filterGroups(payload.sections.next30Days ?? []),
      }
    : payload.sections;

  return {
    filtered: {
      ...payload,
      groups:         filteredGroups,
      featuredGroups: filteredFeatured,
      sections:       filteredSections,
    },
    debug: {
      feedTotal:    allGroups.length,
      feedWithTmdb: withTmdb,
      sampleFeedIds,
      matchCount:   intersection.length,
    },
  };
}

// ── Modo Personalizado: payload ICS filtrado pela biblioteca do usuario ───────

async function buildPersonalFilteredPayload(userId: string | null): Promise<{
  payload: IcsAgendaResponse;
  libraryFiltered: boolean;
  librarySize: number;
  libraryMovieIds: number[];
  debug: {
    userId: string | null;
    libraryIdsCount: number;
    sampleLibraryIds: number[];
    feedTotal: number;
    feedWithTmdb: number;
    sampleFeedIds: (number | string)[];
    matchCount: number;
  };
}> {
  const [general, library] = await Promise.all([
    buildGeneralPayload(),
    userId ? fetchUserLibraryTmdbIds(userId) : Promise.resolve({ tvIds: new Set<number>(), movieIds: new Set<number>() }),
  ]);

  const { tvIds, movieIds } = library;
  const sampleLibraryIds = [...tvIds].slice(0, 20);

  if (tvIds.size === 0 && movieIds.size === 0) {
    return {
      payload: general,
      libraryFiltered: false,
      librarySize: 0,
      libraryMovieIds: [],
      debug: {
        userId,
        libraryIdsCount: 0,
        sampleLibraryIds: [],
        feedTotal: general.groups?.length ?? 0,
        feedWithTmdb: (general.groups ?? []).filter((g) => g.tmdb?.tmdb_id != null).length,
        sampleFeedIds: (general.groups ?? []).slice(0, 5).map((g) => g.tmdb?.tmdb_id ?? `no-tmdb`),
        matchCount: 0,
      },
    };
  }

  const { filtered, debug: filterDebug } = filterPayloadByLibrary(general, tvIds);
  return {
    payload: filtered,
    libraryFiltered: true,
    librarySize: tvIds.size + movieIds.size,
    libraryMovieIds: [...movieIds],
    debug: {
      userId,
      libraryIdsCount: tvIds.size,
      sampleLibraryIds,
      ...filterDebug,
    },
  };
}

// ── Handler GET ───────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const totalStartedAt = Date.now();
  const perf: Record<string, number> = {};
  const stageRef = { value: totalStartedAt };

  try {
    const { searchParams } = new URL(req.url);
    const rawMode = searchParams.get("mode") ?? "general";
    const mode: RadarMode = rawMode === "personal" ? "personal" : "general";
    const region = searchParams.get("region") ?? DEFAULT_REGION;
    const language = searchParams.get("language") ?? DEFAULT_LANGUAGE;
    markStage(perf, stageRef, "request_parse");

    if (mode === "personal") {
      const user = await getCurrentUser().catch(() => null);
      markStage(perf, stageRef, "auth");
      const { payload, libraryFiltered, librarySize, libraryMovieIds, debug } =
        await buildPersonalFilteredPayload(user?.id ?? null);
      markStage(perf, stageRef, "payload_build");

      console.log(
        `[radar/personal] user=${user?.id ?? "anon"}` +
        ` libraryFiltered=${libraryFiltered}` +
        ` librarySize=${librarySize}` +
        ` groups=${payload.groups?.length ?? 0}` +
        ` featured=${payload.featuredGroups?.length ?? 0}`,
      );

      return NextResponse.json({
        mode:            "personal" as const,
        libraryFiltered,
        librarySize,
        libraryMovieIds,
        cacheVersion:    payload.cacheVersion ?? undefined,
        fromCache:       payload.fromCache ?? false,
        rawBdsMode:      false,
        sections:        payload.sections ?? undefined,
        generatedAt:     new Date().toISOString(),
        general:         payload,
        _debug:          debug,
      } satisfies RadarResponse, {
        headers: {
          "Cache-Control": user
            ? "no-store"  // was: private, max-age=300 — desabilitado para debug
            : "public, max-age=60",
        },
      });
    }

    // Modo geral (padrao)
    const sectionKey = "radar_general";
    const memoryKey = `${sectionKey}:${region}:${language}`;
    const memoryCached = generalMemoryCache.get(memoryKey);
    if (memoryCached && memoryCached.expiresAt > Date.now()) {
      markStage(perf, stageRef, "memory_cache_read");
      console.log("[radar/general/perf]", {
        cacheStatus: "memory_hit",
        ...perf,
        total: Date.now() - totalStartedAt,
      });
      return NextResponse.json(
        { ...memoryCached.payload, generatedAt: new Date().toISOString() },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const cached = await readContinuitySectionCache<RadarResponse>(sectionKey, {
      region,
      language,
    });
    markStage(perf, stageRef, "cache_read");

    if (cached?.status === "hit") {
      generalMemoryCache.set(memoryKey, {
        payload: cached.payload,
        expiresAt: Date.now() + RADAR_MEMORY_CACHE_TTL_MS,
      });
      console.log("[radar/general/perf]", {
        cacheStatus: "persistent_hit",
        ...perf,
        total: Date.now() - totalStartedAt,
      });
      return NextResponse.json(
        { ...cached.payload, generatedAt: new Date().toISOString() },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (cached?.status === "stale") {
      const refreshKey = `${sectionKey}:${region}:${language}`;
      if (!refreshes.has(refreshKey)) {
        const promise = (async () => {
          try {
            const general = await buildGeneralPayload();
            await writeContinuitySectionCache({
              sectionKey,
              region,
              language,
              ttlMs: RADAR_CACHE_TTL_MS,
              payload: {
                mode: "general" as const,
                cacheVersion: general.cacheVersion ?? undefined,
                fromCache: general.fromCache ?? false,
                rawBdsMode: false,
                sections: general.sections ?? undefined,
                generatedAt: new Date().toISOString(),
                general,
              } satisfies RadarResponse,
            });
          } finally {
            refreshes.delete(refreshKey);
          }
        })();
        refreshes.set(refreshKey, promise);
      }
      console.log("[radar/general/perf]", {
        cacheStatus: "persistent_stale",
        ...perf,
        total: Date.now() - totalStartedAt,
      });
      return NextResponse.json(
        { ...cached.payload, generatedAt: new Date().toISOString() },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const general = await buildGeneralPayload();
    markStage(perf, stageRef, "payload_build");

    const response = {
      mode:          "general" as const,
      cacheVersion:  general.cacheVersion  ?? undefined,
      fromCache:     general.fromCache     ?? false,
      rawBdsMode:    false,
      sections:      general.sections      ?? undefined,
      generatedAt:   new Date().toISOString(),
      general,
    } satisfies RadarResponse;

    await writeContinuitySectionCache({
      sectionKey,
      region,
      language,
      ttlMs: RADAR_CACHE_TTL_MS,
      payload: response,
    });
    generalMemoryCache.set(memoryKey, {
      payload: response,
      expiresAt: Date.now() + RADAR_MEMORY_CACHE_TTL_MS,
    });
    markStage(perf, stageRef, "cache_write");

    console.log("[radar/general/perf]", {
      cacheStatus: "persistent_miss",
      ...perf,
      total: Date.now() - totalStartedAt,
    });

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/radar] error:", err);
    return NextResponse.json(
      { error: "Radar engine error", detail: String(err) },
      { status: 500 },
    );
  }
}
