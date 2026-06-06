/**
 * /api/user/for-you
 *
 * Engine de recomendações personalizada baseada na biblioteca do usuário.
 * Fonte de relacionados: Trakt Related (primary).
 * Resolução de imagens + pt-BR: local DB (canonical) → Trakt images (VIP fallback).
 * Fallback final de pool: poplog3Title popular quando Trakt não retorna suficientes.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { db } from "@/server/db/client";
import { traktGet, isTraktActive } from "@/server/api-clients/trakt/client";
import type { TraktTranslation } from "@/server/api-clients/trakt/types"; // used in TraktRelatedItem.translations
import {
  isSyntheticTmdbId,
  imdbIdFromSyntheticTmdbId,
} from "@/lib/ids/synthetic-tmdb-id";
import type { UserTitle } from "@/types/user";

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_SEEDS           = 10;
const DEFAULT_FINAL_COUNT = 5;
const MAX_FINAL_COUNT     = 30;
const SESSION_EXCLUDE_CAP = 60;

// ─── Genre map (TMDB IDs → pt-BR) ─────────────────────────────────────────────

const GENRE_MAP: Record<number, string> = {
  28: "Ação", 12: "Aventura", 16: "Animação", 35: "Comédia",
  80: "Crime", 99: "Documentário", 18: "Drama", 10751: "Família",
  14: "Fantasia", 36: "História", 27: "Terror", 10402: "Música",
  9648: "Mistério", 10749: "Romance", 878: "Ficção Científica",
  53: "Thriller", 10752: "Guerra", 37: "Faroeste",
  10759: "Ação & Aventura", 10762: "Infantil", 10763: "Notícias",
  10764: "Reality", 10765: "Sci-Fi & Fantasia", 10768: "Guerra & Política",
};

// ─── pt-BR heuristic (mirrors poplog-title-details.ts) ───────────────────────
// Returns true only when text has strong Portuguese signals unlikely in English:
// accented chars (ã,õ,â,ê,ô,ç) or common Portuguese prepositions.

function looksPortuguese(text: string | null | undefined): boolean {
  if (!text) return false;
  if (/[ãõâêôç]/i.test(text)) return true;
  const t = ` ${text.toLowerCase()} `;
  return [" de ", " da ", " do ", " dos ", " das ", " em ", " uma ", " para "].some((s) => t.includes(s));
}

// ─── Safe string extraction ────────────────────────────────────────────────────
// The library API returns Poplog3UserLibraryItem where .title is a nested object
// ({ tmdb_id, title, poster_path, ... }), not a plain string. UserTitle types
// say string | null — but at runtime it is the nested object.
// This guard extracts the actual string from both shapes.

function safeStr(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim() || null;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.title === "string") return obj.title.trim() || null;
  }
  return null;
}

// ─── Weight system ─────────────────────────────────────────────────────────────
//
// Base weights (highest wins when item is in multiple categories):
//   Favoritos = 100  |  Em andamento = 85  |  Assistidos = 70
//   Watchlist = 45   |  Em breve = 35      |  Geladeira = 20
//
// Abandonados: completamente ignorados — sem semente, sem penalidade.
//
// Bônus de recência (sobre o peso base, nunca como filtro):
//   ≤ 7 dias = +25  |  ≤ 30 dias = +15  |  ≤ 90 dias = +8  |  mais antigo = +0

function categoryWeight(t: UserTitle): number {
  if (t.status === "abandoned") return -1;

  const w: number[] = [];
  if (t.favorite) w.push(100);

  switch (t.status) {
    case "watching":  w.push(85); break;
    case "watched":   w.push(70); break;
    case "watchlist": w.push(45); break;
    case "fridge":    w.push(20); break;
  }

  if (t.stream_status && /soon|coming|anticipated/i.test(t.stream_status)) {
    w.push(35);
  }

  return w.length > 0 ? Math.max(...w) : 0;
}

function recencyBonus(t: UserTitle): number {
  const ts = [t.created_at, t.watched_at]
    .filter((d): d is string => Boolean(d))
    .map((d) => new Date(d).getTime())
    .filter(Number.isFinite);

  if (!ts.length) return 0;
  const days = (Date.now() - Math.max(...ts)) / 86_400_000;

  if (days <= 7)  return 25;
  if (days <= 30) return 15;
  if (days <= 90) return 8;
  return 0;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type WeightedSeed = {
  title: UserTitle;
  baseWeight: number;
  bonus: number;
  effectiveWeight: number;
  label: string; // resolved pt-BR label (step 2)
};

type RecCandidate = {
  tmdbId: number;
  imdbId?: string | null;
  traktSlug?: string | null;
  // Pre-enrichment (Trakt): English, no images
  // Post-enrichment (local DB): pt-BR, TMDB image paths or Trakt image URLs
  title: string;
  originalTitle?: string | null;
  overview?: string | null;
  posterUrl?: string | null;   // relative TMDB path OR full Trakt CDN URL
  backdropUrl?: string | null; // relative TMDB path OR full Trakt CDN URL
  voteAverage?: number | null;
  voteCount?: number | null;
  year?: string | null;
  genreIds?: number[];
  mediaType: "movie" | "tv";
  seedEffectiveWeight: number;
  relationStrength: number; // 0–100 (index 0 in Trakt list = 100)
  reason: string;
  // debug
  _imageSource: string;  // "db:poster" | "db:backdrop" | "trakt:poster" | "trakt:fanart" | "none"
  _langSource: string;   // "pt-BR" | "en" | "trakt-en"
  _discardReason?: string;
  // true quando o título foi encontrado em poplog3_titles sob o tmdbId do Trakt.
  // Determina qual ID usar no link: tmdbId (in DB) ou imdbId (Balloonerismm-only).
  _inLocalDb?: boolean;
};

// Trakt Related response (extended=full,images,translations)
type TraktRelatedItem = {
  title: string;
  year?: number | null;
  ids: {
    trakt?: number | null;
    slug?: string | null;
    imdb?: string | null;
    tmdb?: number | null;
    tvdb?: number | null;
  };
  overview?: string | null;
  released?: string | null;
  first_aired?: string | null;
  runtime?: number | null;
  rating?: number | null;
  votes?: number | null;
  genres?: string[] | null;
  language?: string | null;
  available_translations?: string[] | null;
  certification?: string | null;
  status?: string | null;
  // Returned with extended=full,translations
  translations?: TraktTranslation[] | null;
  // Returned only with extended=full,images (Trakt VIP)
  images?: {
    poster?: string[] | null;   // full CDN URLs — poster[0] is best quality
    fanart?: string[] | null;   // full CDN URLs — fanart[0] is backdrop
    logo?: string[] | null;
    thumb?: string[] | null;
    clearart?: string[] | null;
    banner?: string[] | null;
  } | null;
};

// The canonical payload item returned to the client
export type ForYouApiItem = {
  id: number;
  /** ID canônico para uso em links: imdbId (e.g. "tt6264654") quando o título não está
   *  cacheado localmente sob o tmdbId, ou String(tmdbId) quando está. Garante que a
   *  página de títulos sempre consiga carregar o conteúdo independente do estado do cache. */
  linkId: string;
  title: string;
  originalTitle?: string | null;
  overview?: string;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  rating?: number;
  year?: string | null;
  mediaType: "movie" | "tv";
  mediaLabel: string;
  genreLabel?: string | null;
  reason: string;
  sourceSeed?: string;
  debug?: string;
};

// ─── Seed building ─────────────────────────────────────────────────────────────

function buildWeightedSeeds(titles: UserTitle[]): WeightedSeed[] {
  const map = new Map<string, WeightedSeed>();

  for (const t of titles) {
    const base = categoryWeight(t);
    if (base < 0) continue; // abandoned → ignored
    if (base === 0) continue;

    const bonus = recencyBonus(t);
    const key   = `${t.media_type}:${t.tmdb_id}`;
    // safeStr handles the nested Poplog3UserLibraryItem.title object
    const label = safeStr(t.title) ?? "um título que você gostou";

    const existing = map.get(key);
    if (!existing || base + bonus > existing.effectiveWeight) {
      map.set(key, { title: t, baseWeight: base, bonus, effectiveWeight: base + bonus, label });
    }
  }

  return Array.from(map.values());
}

// Jitter ±20 so equal-weight seeds rotate across Sorteio rounds.
// Recency is a ranking bonus, never a filter.
function pickSeeds(seeds: WeightedSeed[]): WeightedSeed[] {
  if (!seeds.length) return [];
  if (seeds.length <= MAX_SEEDS) return seeds;

  return seeds
    .map((s) => ({ seed: s, score: s.effectiveWeight + Math.random() * 20 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SEEDS)
    .map((x) => x.seed);
}

// ─── Reason strings ───────────────────────────────────────────────────────────

function buildReason(seed: WeightedSeed): string {
  if (seed.title.favorite)               return `Porque você favoritou "${seed.label}"`;
  if (seed.title.status === "watching")  return `Porque você está assistindo "${seed.label}"`;
  if (seed.title.status === "watched")   return `Baseado em "${seed.label}"`;
  if (seed.title.status === "watchlist") return `Da sua watchlist: "${seed.label}"`;
  return `Baseado na sua biblioteca`;
}

// ─── External ID resolution ───────────────────────────────────────────────────

type ExtIds = { imdbId: string | null; traktId: string | null; traktSlug: string | null };

async function resolveExternalIds(seed: WeightedSeed): Promise<ExtIds> {
  const t = seed.title;

  // 1. Synthetic tmdbId → derive imdbId directly (no DB needed)
  if (isSyntheticTmdbId(t.tmdb_id)) {
    const derived = imdbIdFromSyntheticTmdbId(t.tmdb_id);
    return { imdbId: derived, traktId: null, traktSlug: null };
  }

  // 2. Fast path — already in UserTitle (flat fields)
  const quickImdb  = safeStr(t.imdb_id) ?? safeStr(t.externalIds?.imdbId) ?? null;
  const quickTrakt = t.externalIds?.traktId ? String(t.externalIds.traktId) : null;

  if (quickImdb || quickTrakt) {
    return { imdbId: quickImdb, traktId: quickTrakt, traktSlug: null };
  }

  // 3. DB lookup
  try {
    const row = await db.titleExternalId.findFirst({
      where:  { tmdbId: t.tmdb_id, mediaType: t.media_type },
      select: { imdbId: true, traktId: true },
    });
    return {
      imdbId:    row?.imdbId  ?? null,
      traktId:   row?.traktId ?? null,
      traktSlug: null,
    };
  } catch {
    return { imdbId: null, traktId: null, traktSlug: null };
  }
}

// ─── Trakt Related ─────────────────────────────────────────────────────────────
// Uses extended=full,images to get images if the account has VIP access.
// Falls back gracefully when images are absent (free tier).
// Accepts: imdbId (preferred), traktId (numeric or slug).

async function fetchTraktRelated(
  mediaType: "movie" | "tv",
  id: string | null,
): Promise<TraktRelatedItem[]> {
  if (!isTraktActive() || !id) return [];

  const endpoint =
    mediaType === "movie"
      ? `/movies/${encodeURIComponent(id)}/related`
      : `/shows/${encodeURIComponent(id)}/related`;

  // translations: inline pt-BR per item — no separate API calls needed
  // images: VIP-only, free tier returns null (handled gracefully)
  const result = await traktGet<TraktRelatedItem[]>(endpoint, {
    params:     { extended: "full,images,translations" },
    ttlSeconds: 86_400,
  });

  return Array.isArray(result) ? result : [];
}

// ─── Local DB pool (fallback when not enough Trakt candidates) ─────────────────

async function fetchLocalDbPool(
  mediaType: "movie" | "tv",
  excludeTmdbIds: Set<number>,
): Promise<RecCandidate[]> {
  try {
    const rows = await db.poplog3Title.findMany({
      where:   { mediaType, voteAverage: { gte: 5 } },
      orderBy: { popularity: "desc" },
      take:    60,
      select: {
        tmdbId: true, mediaType: true,
        title: true, originalTitle: true, overview: true,
        posterPath: true, backdropPath: true,
        voteAverage: true, voteCount: true,
        genres: true, releaseDate: true, firstAirDate: true,
      },
    });

    return rows
      .filter((r) => r.tmdbId > 0 && !excludeTmdbIds.has(r.tmdbId))
      .map((row): RecCandidate => {
        const date = row.releaseDate ?? row.firstAirDate;
        const hasImg = Boolean(row.posterPath || row.backdropPath);
        return {
          tmdbId:              row.tmdbId,
          title:               row.title ?? "Título",
          originalTitle:       row.originalTitle ?? null,
          overview:            row.overview ?? null,
          posterUrl:           row.posterPath  ?? null,
          backdropUrl:         row.backdropPath ?? null,
          voteAverage:         row.voteAverage  ? Number(row.voteAverage)  : null,
          voteCount:           row.voteCount   ?? null,
          year:                date ? String(date.getFullYear()) : null,
          genreIds:            parseGenreIds(row.genres),
          mediaType:           row.mediaType as "movie" | "tv",
          seedEffectiveWeight: 0,
          relationStrength:    0,
          reason:              "Popular na plataforma",
          _imageSource:        row.posterPath ? "db:poster" : row.backdropPath ? "db:backdrop" : "none",
          _langSource:         "pt-BR",
          _inLocalDb:          true,
          ...(!hasImg && { _discardReason: "no-image-in-pool" }),
        };
      });
  } catch {
    return [];
  }
}

function parseGenreIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g: unknown) =>
      g && typeof g === "object" && "id" in g ? (g as { id: number }).id : g,
    )
    .filter((id): id is number => typeof id === "number");
}

// ─── Canonical enrichment from local DB ───────────────────────────────────────
// Runs on ALL candidates. Trakt gives: English title/overview, no images (free tier).
// Local DB gives: pt-BR title/overview, TMDB image paths (always preferred).
// Strategy: DB data OVERWRITES Trakt data when available.

async function enrichFromDb(candidates: RecCandidate[]): Promise<void> {
  if (!candidates.length) return;

  try {
    const rows = await db.poplog3Title.findMany({
      where:  { tmdbId: { in: candidates.map((c) => c.tmdbId) } },
      select: {
        tmdbId: true, mediaType: true,
        title: true, originalTitle: true, overview: true,
        posterPath: true, backdropPath: true,
        voteAverage: true, voteCount: true, genres: true,
      },
    });

    // Key includes mediaType to avoid collisions (TMDB uses separate ID spaces)
    const byKey = new Map(rows.map((r) => [`${r.mediaType}:${r.tmdbId}`, r]));

    for (const c of candidates) {
      const row = byKey.get(`${c.mediaType}:${c.tmdbId}`);

      if (!row) {
        // Not in local DB → keep Trakt data (English, possibly with Trakt image)
        if (c._imageSource === "pending") c._imageSource = "none";
        if (c._langSource === "pending")  c._langSource  = "trakt-en";
        continue;
      }

      c._inLocalDb = true;

      // Title: only apply DB title when Trakt didn't already provide pt-BR inline.
      // "pt-BR:trakt" = title came from extended=full,translations — authoritative.
      // IMPORTANT: row.title is the ORIGINAL (usually English) title from Balloonerismm/IMDb.
      // Only mark as "pt-BR:db" when looksPortuguese() confirms it. Otherwise "en:db".
      if (!c._langSource.startsWith("pt-BR")) {
        if (row.title) {
          c.originalTitle = row.originalTitle ?? c.originalTitle ?? c.title;
          c.title         = row.title;
          c._langSource   = looksPortuguese(row.title) ? "pt-BR:db" : "en:db";
        } else {
          if (!c.originalTitle) c.originalTitle = c.title;
          c._langSource = "en";
        }
      }
      if (row.originalTitle && !c.originalTitle) c.originalTitle = row.originalTitle;

      // Overview: DB overview is also in the original language (English for most titles).
      // Apply it to fill empty slots — a separate Trakt translation pass will overwrite with pt-BR.
      if (!c._langSource.startsWith("pt-BR") && row.overview) c.overview = row.overview;

      // Images: DB TMDB paths overwrite Trakt CDN URLs
      // (both work with TmdbImage which handles relative paths and full URLs)
      if (row.posterPath) {
        c.posterUrl    = row.posterPath;
        c._imageSource = "db:poster";
      } else if (row.backdropPath) {
        c.backdropUrl  = row.backdropPath;
        if (c._imageSource !== "trakt:poster") c._imageSource = "db:backdrop";
      } else {
        // DB has no image — keep Trakt image if we got one from extended=full,images
        if (c._imageSource === "pending") c._imageSource = "none";
      }
      if (row.backdropPath && !c.backdropUrl) {
        c.backdropUrl = row.backdropPath;
      }

      // Ratings: DB TMDB community ratings preferred
      if (row.voteAverage) c.voteAverage = Number(row.voteAverage);
      if (row.voteCount)   c.voteCount   = row.voteCount;

      // Genres
      if (!c.genreIds?.length) c.genreIds = parseGenreIds(row.genres);
    }
  } catch (err) {
    console.error("[for-you] enrichFromDb error:", err);
  }
}

// ─── pt-BR enrichment via Trakt dedicated translations endpoint ───────────────
// Runs on candidates that still don't have a pt-BR title after inline translations
// and DB enrichment. Calls /movies/{id}/translations/pt or /shows/{id}/translations/pt.
// These responses are cached with TTL=86400. NOT a VIP-only feature (unlike images).
//
// Log schema per candidate:
//   titleOriginal : title before localization (English)
//   titlePtBr     : pt-BR title if found, else "n/a"
//   overviewPtBr  : "yes" | "no"
//   source        : where pt-BR came from ("trakt-inline" | "trakt-trans" | "db" | "none")
//   fallbackReason: why pt-BR was not available, when applicable

async function enrichWithTraktTranslations(candidates: RecCandidate[]): Promise<void> {
  if (!isTraktActive()) return;

  const needsTranslation = candidates.filter(
    (c) => !c._langSource.startsWith("pt-BR") && c.imdbId,
  );
  if (!needsTranslation.length) return;

  await Promise.allSettled(
    needsTranslation.map(async (c) => {
      const imdbId = c.imdbId!;
      const path =
        c.mediaType === "movie"
          ? `/movies/${encodeURIComponent(imdbId)}/translations/pt`
          : `/shows/${encodeURIComponent(imdbId)}/translations/pt`;

      try {
        const translations = await traktGet<TraktTranslation[]>(path, {
          ttlSeconds: 86_400,
        });
        if (!Array.isArray(translations)) return;

        const ptBr = translations.find((t) => t.language === "pt" && t.country === "br" && t.title);
        const pt   = translations.find((t) => t.language === "pt" && t.title);
        const best = ptBr ?? pt;
        if (!best?.title) return;

        const titleOriginal = c.title; // save English title before overwriting
        c.originalTitle = c.originalTitle ?? titleOriginal;
        c.title         = best.title;
        c._langSource   = "pt-BR:trakt-trans";
        if (best.overview) c.overview = best.overview;
      } catch {
        // non-fatal — candidate keeps its current (English) title
      }
    }),
  );
}

// ─── Deduplication ────────────────────────────────────────────────────────────

function normTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

class Deduper {
  private tmdb  = new Set<string>();
  private imdb  = new Set<string>();
  private title = new Set<string>();

  seen(c: RecCandidate): boolean {
    const k1 = `${c.mediaType}:${c.tmdbId}`;
    const k2 = c.imdbId ? `${c.mediaType}:${c.imdbId}` : null;
    const k3 = `${c.mediaType}:${normTitle(c.title)}:${c.year ?? ""}`;

    if (this.tmdb.has(k1))             return true;
    if (k2 && this.imdb.has(k2))       return true;
    if (this.title.has(k3))            return true;

    this.tmdb.add(k1);
    if (k2) this.imdb.add(k2);
    this.title.add(k3);
    return false;
  }
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
// Visual quality is heavily weighted — items without images rarely win.

function score(c: RecCandidate): number {
  const pop    = Math.log10((c.voteCount ?? 0) + 1) * 10;
  const visual = (c.posterUrl ? 20 : 0) + (c.backdropUrl ? 12 : 0);
  const meta   = (c.overview ? 3 : 0) + (c.year ? 1 : 0) + ((c.genreIds?.length ?? 0) > 0 ? 1 : 0);
  const lang   = c._langSource.startsWith("pt-BR") ? 5 : 0;
  return c.seedEffectiveWeight + c.relationStrength * 0.3 + pop + visual + meta + lang;
}

// ─── Weighted sampler (roulette-wheel without replacement) ────────────────────

function weightedSample<T>(items: T[], getW: (i: T) => number, n: number): T[] {
  const pool = [...items];
  const out: T[] = [];

  while (out.length < n && pool.length > 0) {
    const ws    = pool.map((i) => Math.max(0.01, getW(i)));
    const total = ws.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let p = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= ws[i];
      if (r <= 0) { p = i; break; }
    }
    out.push(pool[p]);
    pool.splice(p, 1);
  }

  return out;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body     = await req.json().catch(() => null);
    const titles: UserTitle[] = Array.isArray(body?.titles) ? body.titles : [];
    const excludeKeys = new Set<string>(
      Array.isArray(body?.exclude)
        ? (body.exclude as string[]).slice(0, SESSION_EXCLUDE_CAP)
        : [],
    );
    const FINAL_COUNT = Math.min(
      typeof body?.limit === "number" && body.limit > 0 ? body.limit : DEFAULT_FINAL_COUNT,
      MAX_FINAL_COUNT,
    );

    if (!titles.length) {
      return NextResponse.json({ featured: null, items: [], recommendationSource: "empty" });
    }

    const libraryKeys = new Set(titles.map((t) => `${t.media_type}:${t.tmdb_id}`));
    const libraryTmdbIds = new Set(titles.map((t) => t.tmdb_id));

    // ── Expande exclusão para cobrir IDs reais de títulos com ID sintético na biblioteca ──
    // Cenário: usuário salvou um título via Balloonerismm (tmdb_id negativo, e.g. -5788792).
    // O Trakt retorna o mesmo título com o ID real (e.g. 257994). Sem essa expansão, o
    // filtro de biblioteca falha e o título aparece em "Para você" mesmo já estando salvo.
    const syntheticInLibrary = titles
      .filter((t) => isSyntheticTmdbId(t.tmdb_id))
      .flatMap((t) => {
        const imdbId = imdbIdFromSyntheticTmdbId(t.tmdb_id);
        return imdbId ? [{ tmdb_id: t.tmdb_id, media_type: t.media_type, imdbId }] : [];
      });

    if (syntheticInLibrary.length > 0) {
      const realIdRows = await db.titleExternalId.findMany({
        where: { imdbId: { in: syntheticInLibrary.map((x) => x.imdbId) }, tmdbId: { gt: 0 } },
        select: { tmdbId: true, mediaType: true, imdbId: true },
      }).catch(() => [] as { tmdbId: number; mediaType: string; imdbId: string | null }[]);

      // imdbId → realTmdbId (por mediaType para segurança)
      const imdbKeyToReal = new Map(
        realIdRows.map((r) => [`${r.mediaType}:${r.imdbId}`, r.tmdbId]),
      );

      for (const x of syntheticInLibrary) {
        const realTmdbId = imdbKeyToReal.get(`${x.media_type}:${x.imdbId}`);
        if (realTmdbId) {
          libraryKeys.add(`${x.media_type}:${realTmdbId}`);
          libraryTmdbIds.add(realTmdbId);
        }
      }
    }

    const user = await getCurrentUser().catch(() => null);

    // ── FASE 1 — SEMENTES ────────────────────────────────────────────────────
    const allSeeds = buildWeightedSeeds(titles);
    const picks    = pickSeeds(allSeeds);

    if (!picks.length) {
      return NextResponse.json({ featured: null, items: [], recommendationSource: "empty" });
    }

    // ── FASE 2 — LABELS pt-BR das sementes (via local DB) ─────────────────────
    // Crítico: previne [object Object] quando t.title é o objeto aninhado
    // e garante que o reason mostre sempre o título pt-BR legível.
    await Promise.all(
      picks.map(async (seed) => {
        try {
          const row = await db.poplog3Title.findFirst({
            where:  { tmdbId: seed.title.tmdb_id, mediaType: seed.title.media_type },
            select: { title: true },
          });
          if (row?.title) seed.label = row.title;
        } catch { /* keep defensively-extracted label */ }
      }),
    );

    // ── FASE 3 — IDs externos para chamadas Trakt ──────────────────────────────
    const extIds = new Map<string, ExtIds>();
    await Promise.all(
      picks.map(async (seed) => {
        const key = `${seed.title.media_type}:${seed.title.tmdb_id}`;
        extIds.set(key, await resolveExternalIds(seed));
      }),
    );

    // ── FASE 4 — Trakt Related (em paralelo para todas as sementes) ───────────
    const traktSources: string[] = [];
    const recArrays = await Promise.all(
      picks.map(async (seed): Promise<RecCandidate[]> => {
        const key      = `${seed.title.media_type}:${seed.title.tmdb_id}`;
        const ext      = extIds.get(key)!;
        const reason   = buildReason(seed);
        const lookupId = ext.imdbId ?? ext.traktId ?? ext.traktSlug;

        console.log(
          `[for-you:seed] "${seed.label}" tmdb=${seed.title.tmdb_id} ` +
          `w=${seed.baseWeight}+${seed.bonus} id_used=${lookupId ?? "none"} ` +
          `endpoint=${seed.title.media_type === "movie" ? "/movies" : "/shows"}/${lookupId ?? "?"}/related`,
        );

        const traktItems = await fetchTraktRelated(seed.title.media_type, lookupId);

        console.log(
          `[for-you:seed] "${seed.label}" → ${traktItems.length} Trakt candidates ` +
          `(${traktItems.filter((r) => r.images?.poster?.length).length} with Trakt images)`,
        );

        if (!traktItems.length) {
          traktSources.push("none");
          return [];
        }

        traktSources.push("trakt");
        return traktItems
          .filter((r) => typeof r.ids.tmdb === "number")
          .map((r, idx): RecCandidate => {
            // pt-BR from inline translations (extended=full,images,translations)
            // Prefer country=br, fallback to any pt entry
            const ptBr =
              r.translations?.find((t) => t.country === "br" && t.title) ??
              r.translations?.find((t) => t.language === "pt" && t.title) ??
              null;

            const traktPoster = r.images?.poster?.[0] ?? null;
            const traktFanart = r.images?.fanart?.[0] ?? null;

            return {
              tmdbId:              r.ids.tmdb!,
              imdbId:              r.ids.imdb  ?? null,
              traktSlug:           r.ids.slug  ?? null,
              title:               ptBr?.title ?? r.title,
              originalTitle:       ptBr ? r.title : null,
              year:                r.year != null ? String(r.year) : null,
              overview:            ptBr?.overview ?? r.overview ?? null,
              posterUrl:           traktPoster,
              backdropUrl:         traktFanart,
              voteAverage:         r.rating ?? null,
              voteCount:           r.votes  ?? null,
              mediaType:           seed.title.media_type,
              seedEffectiveWeight: seed.effectiveWeight,
              relationStrength:    Math.round(((traktItems.length - idx) / traktItems.length) * 100),
              reason,
              _imageSource:        traktPoster ? "trakt:poster" : traktFanart ? "trakt:fanart" : "pending",
              _langSource:         ptBr ? "pt-BR:trakt" : "pending",
            };
          });
      }),
    );

    // ── FASE 5 — Agregação + deduplicação ─────────────────────────────────────
    let libRemoved = 0;
    let excluded   = 0;
    let deduped    = 0;
    const deduper     = new Deduper();
    const candidates: RecCandidate[] = [];

    for (const recs of recArrays) {
      for (const rec of recs) {
        const k = `${rec.mediaType}:${rec.tmdbId}`;
        if (libraryKeys.has(k))  { libRemoved++; rec._discardReason = "in-library"; continue; }
        if (excludeKeys.has(k))  { excluded++;   rec._discardReason = "session-exclude"; continue; }
        if (deduper.seen(rec))   { deduped++;    rec._discardReason = "dedup"; continue; }
        candidates.push(rec);
      }
    }

    const hadTraktCandidates = candidates.length > 0;

    // ── FASE 6 — Enriquecimento canônico com local DB ─────────────────────────
    // Aplica: imagens TMDB (sobre Trakt se necessário), ratings, gêneros.
    // NOTA: row.title da DB é o título original (inglês). Não é pt-BR.
    // Fase 6b busca pt-BR via endpoint dedicado do Trakt.
    await enrichFromDb(candidates);

    // ── FASE 6b — Localização pt-BR via endpoint dedicado Trakt ───────────────
    // Para candidatos ainda sem pt-BR (inline Trakt não retornou ou DB não tinha),
    // busca /translations/pt separadamente. Resposta em cache TTL=86400.
    await enrichWithTraktTranslations(candidates);

    // ── FASE 7 — Filtro not_interested ────────────────────────────────────────
    const notIntSet = new Set<string>();
    if (user && candidates.length > 0) {
      try {
        const rows = await db.userTitleFeedback.findMany({
          where: {
            userId:       user.id,
            feedbackType: "not_interested",
            active:       true,
            tmdbId:       { in: candidates.map((c) => c.tmdbId) },
          },
          select: { tmdbId: true, mediaType: true },
        });
        for (const r of rows) notIntSet.add(`${r.mediaType}:${r.tmdbId}`);
      } catch { /* non-fatal */ }
    }

    const eligible = candidates.filter(
      (c) => !notIntSet.has(`${c.mediaType}:${c.tmdbId}`),
    );

    // ── FASE 8 — Pool com preferência por imagens ─────────────────────────────
    const withImages = eligible.filter((c) => c.posterUrl || c.backdropUrl);

    let pool = withImages.length >= FINAL_COUNT ? withImages : eligible;

    // ── FASE 9 — Suplementação com local DB se não temos suficientes ──────────
    // Garante que sempre tenhamos FINAL_COUNT candidatos com imagem.
    if (withImages.length < FINAL_COUNT) {
      const allExcludedTmdbIds = new Set([
        ...libraryTmdbIds,
        ...candidates.map((c) => c.tmdbId),
      ]);

      const [moviePool, tvPool] = await Promise.all([
        fetchLocalDbPool("movie", allExcludedTmdbIds),
        fetchLocalDbPool("tv", allExcludedTmdbIds),
      ]);

      // Interleave movies and tv for variety, filter by session exclude
      const supplement: RecCandidate[] = [];
      for (const rec of [...moviePool, ...tvPool]) {
        if (excludeKeys.has(`${rec.mediaType}:${rec.tmdbId}`)) continue;
        if (deduper.seen(rec)) continue;
        if (rec.posterUrl || rec.backdropUrl) supplement.push(rec);
      }

      pool = [...withImages, ...supplement.slice(0, FINAL_COUNT - withImages.length)];
      if (!pool.length) pool = eligible; // ultimate fallback
    }

    // ── LOG SUMMARY ───────────────────────────────────────────────────────────
    const source = traktSources.includes("trakt") ? "trakt_related" : "local_db";
    console.log(
      `[for-you] seeds=${picks.length} traktCandidates=${hadTraktCandidates ? candidates.length : 0} ` +
      `lib_removed=${libRemoved} excluded=${excluded} deduped=${deduped} ` +
      `with_images=${withImages.length} pool=${pool.length} source=${source}`,
    );

    if (!pool.length) {
      return NextResponse.json({ featured: null, items: [], recommendationSource: source });
    }

    // ── FASE 10 — Seleção ponderada ───────────────────────────────────────────
    const selected = weightedSample(pool, score, Math.min(FINAL_COUNT, pool.length));

    // ── FASE 11 — Payload canônico (campos finais, sem dados brutos) ──────────
    const items: ForYouApiItem[] = selected.map((c) => {
      const genreLabel = c.genreIds?.[0] ? (GENRE_MAP[c.genreIds[0]] ?? null) : null;

      const isPtBr       = c._langSource.startsWith("pt-BR");
      const titleOriginal = isPtBr ? (c.originalTitle ?? c.title) : c.title;
      const titlePtBr     = isPtBr ? c.title : "n/a";
      const overviewPtBr  = isPtBr && Boolean(c.overview) ? "yes" : "no";
      const transSource   =
        c._langSource === "pt-BR:trakt"       ? "trakt-inline" :
        c._langSource === "pt-BR:trakt-trans" ? "trakt-trans"  :
        c._langSource === "pt-BR:db"          ? "db"           : "none";
      const fallbackReason = isPtBr ? "—" : `no-pt-BR-translation (${c._langSource})`;

      console.log(
        `[for-you:item] tmdb=${c.tmdbId} ` +
        `titleOriginal="${titleOriginal}" titlePtBr="${titlePtBr}" ` +
        `overviewPtBr=${overviewPtBr} source=${transSource} ` +
        `fallbackReason=${fallbackReason} ` +
        `image=${c._imageSource} ` +
        `${!c.posterUrl && !c.backdropUrl ? "⚠ sem-imagem " : ""}` +
        `reason="${c.reason}"`,
      );

      // linkId canônico:
      // - título está no DB local sob o tmdbId do Trakt → usa tmdbId numérico (link direto, sem round-trip)
      // - título não está no DB → usa imdbId do Trakt se disponível (a página carrega via Balloonerismm)
      // - fallback final: String(tmdbId) (raro: Trakt sem imdbId + não está no DB)
      const linkId = c._inLocalDb ? String(c.tmdbId) : (c.imdbId ?? String(c.tmdbId));

      return {
        id:           c.tmdbId,
        linkId,
        title:        c.title,
        originalTitle: c.originalTitle !== c.title ? (c.originalTitle ?? null) : null,
        overview:     c.overview ?? undefined,
        posterUrl:    c.posterUrl   ?? null,
        backdropUrl:  c.backdropUrl ?? null,
        rating:       c.voteAverage ?? undefined,
        year:         c.year,
        mediaType:    c.mediaType,
        mediaLabel:   c.mediaType === "movie" ? "Filme" : "Série",
        genreLabel,
        reason:       c.reason,
        sourceSeed:   c.seedEffectiveWeight > 0 ? undefined : "popular",
        debug:        `${c._imageSource}|${c._langSource}|w=${c.seedEffectiveWeight}+${c.relationStrength}`,
      };
    });

    // Featured = highest rating with backdrop; else first item
    const withBackdrop = items.filter((it) => it.backdropUrl);
    const featured     = withBackdrop.length > 0
      ? [...withBackdrop].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0]
      : (items[0] ?? null);
    const rest = featured ? items.filter((it) => it !== featured) : items;

    console.log(`[for-you] final=${selected.length} featured="${featured?.title ?? "none"}" source=${source}`);

    return NextResponse.json({
      featured,
      items:                rest,
      recommendationSource: source,
    });

  } catch (err) {
    console.error("[for-you]", err);
    return NextResponse.json({ featured: null, items: [], recommendationSource: "error" });
  }
}
