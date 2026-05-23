import { NextRequest, NextResponse } from "next/server";

import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { normalizeTmdbTitle } from "@/server/normalizers/tmdb-title";
import { upsertCachedTitle } from "@/server/cache/title-cache";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import type { TmdbTitleSummary } from "@/server/api-clients/tmdb/types";

type TmdbListResponse = {
  page: number;
  total_pages: number;
  total_results: number;
  results: TmdbTitleSummary[];
};

// ── Anime ─────────────────────────────────────────────────────────────────────

async function getAnimeResults() {
  const [animeTv, animeMovie] = await Promise.all([
    tmdbFetch<TmdbListResponse>("/discover/tv", {
      params: {
        with_genres: "16",
        with_origin_country: "JP",
        sort_by: "popularity.desc",
        page: 1,
        include_adult: false,
      },
    }),
    tmdbFetch<TmdbListResponse>("/discover/movie", {
      params: {
        with_genres: "16",
        with_origin_country: "JP",
        sort_by: "popularity.desc",
        page: 1,
        include_adult: false,
      },
    }),
  ]);

  const tvNorm = (animeTv.results ?? []).map((item) =>
    normalizeTmdbTitle({ ...item, media_type: "tv" })
  );
  const movieNorm = (animeMovie.results ?? []).map((item) =>
    normalizeTmdbTitle({ ...item, media_type: "movie" })
  );

  // Intercalar TV e filmes, dar preferência a TV
  const merged: ReturnType<typeof normalizeTmdbTitle>[] = [];
  const maxTv = Math.min(tvNorm.length, 12);
  const maxMovie = Math.min(movieNorm.length, 8);
  for (let i = 0; i < Math.max(maxTv, maxMovie); i++) {
    if (i < maxTv) merged.push(tvNorm[i]);
    if (i < maxMovie) merged.push(movieNorm[i]);
  }

  const titles = filterValidTitles(merged).slice(0, 18);

  // Cache titles
  await Promise.allSettled(
    titles.map(async (title) => {
      const raw = [...(animeTv.results ?? []), ...(animeMovie.results ?? [])].find(
        (r) => r.id === title.tmdb_id
      );
      if (!raw) return;
      try {
        await upsertCachedTitle(title, {
          ...raw,
          media_type: title.media_type,
        });
      } catch {}
    })
  );

  return {
    ok: true,
    special: "anime",
    label: "Animes",
    popular: tvNorm.slice(0, 12),
    topRated: movieNorm.slice(0, 8),
    popularSeries: filterValidTitles(tvNorm).slice(0, 12),
    popularMovies: filterValidTitles(movieNorm).slice(0, 8),
    results: titles,
  };
}

// ── Plot Twist ────────────────────────────────────────────────────────────────

const PLOT_TWIST_IDS: Array<{ tmdb_id: number; media_type: "movie" | "tv" }> = [
  { tmdb_id: 539, media_type: "movie" },       // Psycho
  { tmdb_id: 807, media_type: "movie" },       // Se7en
  { tmdb_id: 550, media_type: "movie" },       // Fight Club
  { tmdb_id: 862, media_type: "movie" },       // The Usual Suspects
  { tmdb_id: 1573, media_type: "movie" },      // The Prestige
  { tmdb_id: 37165, media_type: "movie" },     // The Truman Show
  { tmdb_id: 11036, media_type: "movie" },     // The Shawshank Redemption
  { tmdb_id: 1422, media_type: "movie" },      // The Departed
  { tmdb_id: 27205, media_type: "movie" },     // Inception
  { tmdb_id: 438631, media_type: "movie" },    // Dune
  { tmdb_id: 346, media_type: "movie" },       // Seven Samurai
  { tmdb_id: 4148, media_type: "movie" },      // Gone Baby Gone
  { tmdb_id: 274, media_type: "movie" },       // The Silence of the Lambs
  { tmdb_id: 1124, media_type: "movie" },      // The Sixth Sense
  { tmdb_id: 475557, media_type: "movie" },    // Joker
  { tmdb_id: 60625, media_type: "tv" },        // Rick and Morty
  { tmdb_id: 1396, media_type: "tv" },         // Breaking Bad
  { tmdb_id: 1399, media_type: "tv" },         // Game of Thrones
  { tmdb_id: 66732, media_type: "tv" },        // Stranger Things
  { tmdb_id: 87108, media_type: "tv" },        // Chernobyl
  { tmdb_id: 79744, media_type: "tv" },        // The Leftovers
  { tmdb_id: 73586, media_type: "tv" },        // Mindhunter
];

async function getPlotTwistResults() {
  const settled = await Promise.allSettled(
    PLOT_TWIST_IDS.map(async ({ tmdb_id, media_type }) => {
      try {
        const data = await tmdbFetch<TmdbTitleSummary & { id: number }>(
          `/${media_type}/${tmdb_id}`,
          { params: { language: "pt-BR" } }
        );
        return normalizeTmdbTitle({ ...data, media_type, id: tmdb_id });
      } catch {
        return null;
      }
    })
  );

  const titles = settled
    .filter(
      (r): r is PromiseFulfilledResult<ReturnType<typeof normalizeTmdbTitle> | null> =>
        r.status === "fulfilled"
    )
    .map((r) => r.value)
    .filter((t): t is ReturnType<typeof normalizeTmdbTitle> => t !== null);

  const valid = filterValidTitles(titles).slice(0, 16);

  return {
    ok: true,
    special: "plot-twist",
    label: "Plot Twist",
    popular: valid,
    results: valid,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const special = searchParams.get("special");

  try {
    if (special === "anime") {
      return NextResponse.json(await getAnimeResults());
    }

    if (special === "plot-twist") {
      return NextResponse.json(await getPlotTwistResults());
    }

    return NextResponse.json(
      { ok: false, error: "Unknown special filter. Use ?special=anime or ?special=plot-twist" },
      { status: 400 }
    );
  } catch (error) {
    console.error("[poplog3/discover/special]", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to load special discover data",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
