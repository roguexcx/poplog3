/**
 * Dev-only probe: raw PT-BR episode data from Trakt + TVDB for a given series.
 * GET /api/dev/pt-br-probe?imdbId=ttXXXX&season=1
 */
import { NextRequest, NextResponse } from "next/server";
import { traktGet } from "@/server/api-clients/trakt/client";
import { tvdbGet, isTvdbActive } from "@/server/api-clients/tvdb/client";
import type { TraktEpisodeFull, TraktTranslation } from "@/server/api-clients/trakt/types";
import type { TvdbEpisode } from "@/server/api-clients/tvdb/types";

export const dynamic = "force-dynamic";

type EpisodeProbe = {
  number: number;
  trakt_title_en?: string | null;
  trakt_title_pt?: string | null;
  trakt_overview_en?: string | null;
  trakt_overview_pt?: string | null;
  trakt_has_translations: boolean;
  tvdb_title_en?: string | null;
  tvdb_title_pt?: string | null;
  tvdb_overview_en?: string | null;
  tvdb_overview_pt?: string | null;
};

export async function GET(request: NextRequest) {
  const imdbId = request.nextUrl.searchParams.get("imdbId");
  const season = Number(request.nextUrl.searchParams.get("season") ?? "1");

  if (!imdbId) {
    return NextResponse.json({ error: "imdbId required" }, { status: 400 });
  }

  const results: {
    imdbId: string;
    season: number;
    tvdbId: number | null;
    tvdbFound: boolean;
    tvdb_remoteid_raw: unknown;
    traktEpisodeCount: number;
    traktTranslationFound: boolean;
    trakt_ep1_translations_raw: unknown;
    episodes: EpisodeProbe[];
    raw_trakt_translations_sample: TraktTranslation[] | null;
    tvdb_por_sample: TvdbEpisode[] | null;
  } = {
    imdbId,
    season,
    tvdbId: null,
    tvdbFound: false,
    tvdb_remoteid_raw: null,
    traktEpisodeCount: 0,
    traktTranslationFound: false,
    trakt_ep1_translations_raw: null,
    episodes: [],
    raw_trakt_translations_sample: null,
    tvdb_por_sample: null,
  };

  // ── 1. TVDB: find series ID via remoteid ──────────────────────────────────
  if (isTvdbActive()) {
    // Fetch raw remoteid response with short TTL to bypass cache
    const rawRemote = await tvdbGet<unknown>(
      `/search/remoteid/${encodeURIComponent(imdbId)}`,
      { ttlSeconds: 60 },
    ).catch((e: Error) => ({ error: e.message }));
    results.tvdb_remoteid_raw = rawRemote;

    // Parse inline using same logic as fixed findTvdbSeriesByRemoteId
    let tvdbId: number | null = null;
    if (Array.isArray(rawRemote)) {
      for (const item of rawRemote as Array<Record<string, unknown>>) {
        if (!item || typeof item !== "object") continue;
        if (item.series && typeof item.series === "object") {
          const s = item.series as Record<string, unknown>;
          const id = typeof s.id === "number" ? s.id : Number(s.id);
          if (Number.isFinite(id) && id > 0) { tvdbId = id; break; }
        }
        if (item.type === "series" || item.type === "show") {
          const n = Number(item.tvdb_id ?? item.objectID);
          if (Number.isFinite(n) && n > 0) { tvdbId = n; break; }
        }
      }
    }

    results.tvdb_remoteid_raw = Array.isArray(rawRemote)
      ? { format: "array", len: (rawRemote as unknown[]).length, item0_keys: Object.keys(((rawRemote as unknown[])[0] as object) ?? {}) }
      : rawRemote;
    results.tvdbId = tvdbId;
    results.tvdbFound = tvdbId !== null;

    if (tvdbId) {
      // Fetch structural episodes
      type EpisodePageData = { series?: unknown; episodes?: TvdbEpisode[] };
      const structural = await tvdbGet<EpisodePageData>(
        `/series/${tvdbId}/episodes/default`,
        { params: { season, page: 0 }, ttlSeconds: 300 },
      ).catch(() => null);

      const structuralEps = structural?.episodes ?? [];

      // Fetch PT-BR translations
      const por = await tvdbGet<EpisodePageData>(
        `/series/${tvdbId}/episodes/default/por`,
        { params: { page: 0 }, ttlSeconds: 300 },
      ).catch(() => null);

      const porEps = por?.episodes ?? [];
      results.tvdb_por_sample = porEps.slice(0, 3);

      const porMap = new Map<number, { name?: string | null; overview?: string | null }>();
      for (const ep of porEps) {
        if (ep.id) porMap.set(ep.id, { name: ep.name, overview: ep.overview });
      }

      for (const ep of structuralEps.filter((e) => e.seasonNumber === season)) {
        const pt = porMap.get(ep.id);
        const existing = results.episodes.find((e) => e.number === (ep.number ?? 0));
        if (existing) {
          existing.tvdb_title_en = ep.name ?? null;
          existing.tvdb_title_pt = pt?.name ?? null;
          existing.tvdb_overview_en = ep.overview ?? null;
          existing.tvdb_overview_pt = pt?.overview ?? null;
        } else {
          results.episodes.push({
            number: ep.number ?? 0,
            tvdb_title_en: ep.name ?? null,
            tvdb_title_pt: pt?.name ?? null,
            tvdb_overview_en: ep.overview ?? null,
            tvdb_overview_pt: pt?.overview ?? null,
            trakt_has_translations: false,
          });
        }
      }
    }
  }

  // ── 2. Trakt: episodes with translations ─────────────────────────────────
  const traktEps = await traktGet<TraktEpisodeFull[]>(
    `/shows/${imdbId}/seasons/${season}/episodes`,
    { params: { extended: "full,translations" }, ttlSeconds: 300 },
  ).catch(() => null);

  if (traktEps) {
    results.traktEpisodeCount = traktEps.length;

    // Also fetch the show-level PT translation as a reference
    const showTranslations = await traktGet<TraktTranslation[]>(
      `/shows/${imdbId}/translations/pt`,
      { ttlSeconds: 300 },
    ).catch(() => null);
    results.raw_trakt_translations_sample = showTranslations?.slice(0, 2) ?? null;

    for (const ep of traktEps.filter((e) => e.number > 0)) {
      const ptBr = ep.translations?.find((t) => t.language === "pt" && t.country === "br");
      const pt = ep.translations?.find((t) => t.language === "pt");
      const best = ptBr ?? pt;

      results.traktTranslationFound = results.traktTranslationFound || Boolean(best?.title || best?.overview);

      // Capture raw translations for ep1 for debugging
      if (ep.number === 1 && ep.translations) {
        results.trakt_ep1_translations_raw = ep.translations.slice(0, 3);
      }

      const existing = results.episodes.find((e) => e.number === ep.number);
      if (existing) {
        existing.trakt_title_en = ep.title ?? null;
        existing.trakt_title_pt = best?.title ?? null;
        existing.trakt_overview_en = ep.overview ?? null;
        existing.trakt_overview_pt = best?.overview ?? null;
        existing.trakt_has_translations = Boolean(ep.translations?.length);
      } else {
        results.episodes.push({
          number: ep.number,
          trakt_title_en: ep.title ?? null,
          trakt_title_pt: best?.title ?? null,
          trakt_overview_en: ep.overview ?? null,
          trakt_overview_pt: best?.overview ?? null,
          trakt_has_translations: Boolean(ep.translations?.length),
        });
      }
    }
  }

  results.episodes.sort((a, b) => a.number - b.number);

  return NextResponse.json(results, { headers: { "x-no-cache": "1" } });
}
