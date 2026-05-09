// src/app/api/watchlist/live/route.ts

import { NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";
import { getStreamingInfo, daysBetween } from "@/lib/streaming";
import type { StreamStatus } from "@/lib/streaming";

// ─── Types ────────────────────────────────────────────────────────────────────

type RawTitle = {
  id: number;
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  release_year: number | null;
  created_at: string;
  fridge: boolean;
  stream_status: StreamStatus | null;
  stream_status_checked_at: string | null;
};

type EnrichedTitle = {
  id: number;
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  poster_path: string | null;
  year: string | null;
  genre: string | null;
  runtime: number | null;
  runtime_label: string | null;
  seasons: number | null;
  origin: "cinema" | "streaming";
  release_date: string;
  created_at: string;
  stream_status: StreamStatus;
  providers: { name: string; logo: string; type: "flatrate" | "rent" | "buy" }[];
  estimated_platform: string | null;
  estimated_month: string | null;
  context_pool: string[];
  fridge: boolean;
  stream_status_updated: boolean;
};

type TMDBDetails = Record<string, unknown> & {
  id?: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  runtime?: number | null;
  episode_run_time?: number[] | null;
  number_of_seasons?: number | null;
  genres?: Array<{ id: number; name: string }>;
  production_companies?: Array<{ id: number; name: string }>;
  revenue?: number;
  budget?: number;
};

// ─── Helpers locais (não-streaming) ───────────────────────────────────────────

const PT_MONTHS_LOCAL = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

type IdValidation =
  | { ok: true }
  | { ok: false; reason: "id_mismatch" | "upcoming" | "no_release_date" };

function validateTmdbId(
  tmdbReleaseDate: string | null,
  rowReleaseYear: number | null,
): IdValidation {
  if (!tmdbReleaseDate) return { ok: false, reason: "no_release_date" };
  const tmdbYear = new Date(tmdbReleaseDate).getFullYear();
  if (new Date(tmdbReleaseDate) > new Date()) return { ok: false, reason: "upcoming" };
  if (rowReleaseYear && Math.abs(tmdbYear - rowReleaseYear) > 3) return { ok: false, reason: "id_mismatch" };
  return { ok: true };
}

function isStale(checkedAt: string | null, releaseDate: string): boolean {
  if (!checkedAt) return true;
  const daysSinceRelease = daysBetween(releaseDate);
  const daysSinceCheck   = daysBetween(checkedAt);
  if (daysSinceRelease >= 45 && daysSinceRelease <= 90) return daysSinceCheck >= 3;
  return daysSinceCheck >= 7;
}

function formatRuntime(minutes: number | null): string | null {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}min` : `${h}h`;
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const { titles } = await request.json();

    if (!Array.isArray(titles) || titles.length === 0) {
      return NextResponse.json({ titles: [] });
    }

    const rows = titles as RawTitle[];

    const enriched = await Promise.all(
      rows.map(async (row): Promise<EnrichedTitle | null> => {
        try {
          const endpoint         = `/${row.media_type}/${row.tmdb_id}`;
          const fallbackRelease  = `${row.release_year ?? new Date().getFullYear()}-01-01`;
          const needsCheck       = isStale(row.stream_status_checked_at, fallbackRelease);

          const details = await tmdbFetch<TMDBDetails>(endpoint, {
            append_to_response: "genres,production_companies",
          });

          const tmdbReleaseDate = details.release_date ?? details.first_air_date ?? null;
          const releaseDate     = tmdbReleaseDate ?? fallbackRelease;

          const idCheck = validateTmdbId(tmdbReleaseDate, row.release_year);

          if (!idCheck.ok) {
            const genre       = details.genres?.[0]?.name ?? null;
            const releaseMonth = PT_MONTHS_LOCAL[new Date(releaseDate).getMonth()] ?? "";
            const safeContext = idCheck.reason === "id_mismatch"
              ? ["Aguardando confirmação de data", "Lançamento previsto"]
              : [`Estreia prevista para ${releaseMonth}`, "Salvo antes de estrear · ainda não lançou"];

            return {
              id:                    row.id,
              tmdb_id:               row.tmdb_id,
              media_type:            row.media_type,
              title:                 details.title ?? details.name ?? row.title,
              poster_path:           details.poster_path ?? null,
              year:                  row.release_year ? String(row.release_year) : null,
              genre,
              runtime:               null,
              runtime_label:         null,
              seasons:               null,
              origin:                "cinema",
              release_date:          releaseDate,
              created_at:            row.created_at,
              stream_status:         "cinemas",
              providers:             [],
              estimated_platform:    null,
              estimated_month:       null,
              context_pool:          safeContext,
              fridge:                row.fridge ?? false,
              stream_status_updated: false,
            };
          }

          const genre   = details.genres?.[0]?.name ?? null;
          const seasons = row.media_type === "tv" ? (details.number_of_seasons ?? null) : null;

          const streaming = await getStreamingInfo(row.tmdb_id, row.media_type, {
            releaseDate,
            createdAt:          row.created_at,
            seasons,
            genre,
            productionCompanies: details.production_companies ?? [],
            budget:             (details.budget as number) ?? 0,
            revenue:            (details.revenue as number) ?? 0,
          });

          // Flatten providers para o formato esperado pelo WatchlistVivaSection
          const seenIds  = new Set<number>();
          const providers: EnrichedTitle["providers"] = [];
          for (const [list, type] of [
            [streaming.flatrate, "flatrate"],
            [streaming.free,     "flatrate"],
            [streaming.rent,     "rent"],
            [streaming.buy,      "buy"],
          ] as const) {
            for (const p of list) {
              if (!seenIds.has(p.id)) {
                seenIds.add(p.id);
                providers.push({ name: p.name, logo: p.logo, type });
              }
            }
          }

          const rawRuntime = details.runtime ?? details.episode_run_time?.[0] ?? null;

          return {
            id:                    row.id,
            tmdb_id:               row.tmdb_id,
            media_type:            row.media_type,
            title:                 details.title ?? details.name ?? row.title,
            poster_path:           details.poster_path ?? null,
            year:                  releaseDate ? String(new Date(releaseDate).getFullYear()) : null,
            genre,
            runtime:               rawRuntime,
            runtime_label:         formatRuntime(rawRuntime),
            seasons,
            origin:                streaming.origin,
            release_date:          releaseDate,
            created_at:            row.created_at,
            stream_status:         streaming.streamStatus,
            providers,
            estimated_platform:    streaming.estimatedPlatform,
            estimated_month:       streaming.estimatedMonth,
            context_pool:          streaming.contextPool,
            fridge:                row.fridge ?? false,
            stream_status_updated: needsCheck && !streaming.inferred,
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
