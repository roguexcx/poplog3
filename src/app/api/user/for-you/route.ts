/**
 * /api/user/for-you
 *
 * Engine de recomendações personalizada baseada na biblioteca do usuário.
 * Fonte de relacionados: Balloonerismm (primary) — /recommendations + /similar por seed.
 * Hidratação: Trakt por imdbId (canonical IDs, pt-BR, imagens VIP).
 * Fallback de imagens/metadata: local DB (TMDB canonical paths).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { db } from "@/server/db/client";
import { traktGet, isTraktActive } from "@/server/api-clients/trakt/client";
import type { TraktTranslation } from "@/server/api-clients/trakt/types";
import {
  isSyntheticTmdbId,
  imdbIdFromSyntheticTmdbId,
  syntheticTmdbFromImdbId,
} from "@/lib/ids/synthetic-tmdb-id";
import {
  fetchBalloonerismForSeed,
  mergeBalloonCandidates,
  hydrateCandidatesWithTrakt,
  type BalloonSeedResult,
  type ScoreBreakdown,
} from "@/server/recommendations/balloon-engine";
import { withOrigin } from "@/server/engine-logger";
import type { UserTitle } from "@/types/user";

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_SEEDS             = 12;
const DEFAULT_FINAL_COUNT   = 6;   // home desktop exibe 1 featured + 5 small = 6 slots
const MAX_FINAL_COUNT       = 30;
const SESSION_EXCLUDE_CAP   = 150;
// Balloonerismm is the primary source. All seeds with imdbId are queried.
// Concurrency cap avoids rate-limit cascades; hydration cap limits Trakt calls.
const BALLOON_CONCURRENCY   = 4;
const HYDRATION_CAP         = 40; // top-N candidates to enrich via Trakt single-item lookup
const HYDRATION_CONCURRENCY = 8;

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
  /** CUID canônico de poplog3_titles quando encontrado no DB local */
  _poplogId?: string | null;
  imdbId?: string | null;
  traktId?: number | null;
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
  // Provenance from Balloon engine
  _balloonSource?: "recommendations" | "similar" | "both";
  _hydrationSource?: "trakt" | "balloon";
  _appearedFromSeeds?: number;
  _scoreBreakdown?: ScoreBreakdown;
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

// Picks up to MAX_SEEDS seeds with guaranteed media-type diversity when possible.
// Each type gets up to half the budget; remainder filled by top-scoring from either type.
// Jitter ±20 rotates equal-weight seeds across sessions.
function pickSeeds(seeds: WeightedSeed[]): WeightedSeed[] {
  if (!seeds.length) return [];
  if (seeds.length <= MAX_SEEDS) return seeds;

  const scored = seeds
    .map((s) => ({ seed: s, score: s.effectiveWeight + Math.random() * 20 }))
    .sort((a, b) => b.score - a.score);

  const movies = scored.filter((x) => x.seed.title.media_type === "movie");
  const shows  = scored.filter((x) => x.seed.title.media_type === "tv");

  // At least 2 from each type when both are present; remaining budget fills from top scorer
  const minPerType = 2;
  const movieSlots = movies.length > 0 ? Math.max(minPerType, Math.floor(MAX_SEEDS / 2)) : 0;
  const tvSlots    = shows.length  > 0 ? Math.max(minPerType, Math.floor(MAX_SEEDS / 2)) : 0;

  const picked = new Set<WeightedSeed>();
  for (const x of movies.slice(0, movieSlots)) picked.add(x.seed);
  for (const x of shows.slice(0, tvSlots))    picked.add(x.seed);

  // Fill remaining budget with top-scoring seeds of either type
  for (const x of scored) {
    if (picked.size >= MAX_SEEDS) break;
    picked.add(x.seed);
  }

  return Array.from(picked);
}

// ─── Reason strings ───────────────────────────────────────────────────────────

function buildReason(seed: WeightedSeed): string {
  if (seed.title.favorite)               return `Porque você favoritou "${seed.label}"`;
  if (seed.title.status === "watching")  return `Porque você está assistindo "${seed.label}"`;
  if (seed.title.status === "watched")   return `Baseado em "${seed.label}"`;
  if (seed.title.status === "watchlist") return `Da sua watchlist: "${seed.label}"`;
  return `Baseado na sua biblioteca`;
}

// ─── Seed source label ────────────────────────────────────────────────────────

function seedSourceLabel(seed: WeightedSeed): string {
  if (seed.title.favorite) return "favorite";
  switch (seed.title.status) {
    case "watching":  return "watching";
    case "watched":   return "watched";
    case "watchlist": return "watchlist";
    case "fridge":    return "fridge";
  }
  if (seed.title.stream_status && /soon|coming|anticipated/i.test(seed.title.stream_status)) {
    return "upcoming";
  }
  return "manual";
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
  const quickSlug  = safeStr(t.externalIds?.slug) ?? null;

  if (quickImdb || quickTrakt || quickSlug) {
    return { imdbId: quickImdb, traktId: quickTrakt, traktSlug: quickSlug };
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
      traktSlug: null, // slug não está em titleExternalId; fast-path usa externalIds.slug
    };
  } catch {
    return { imdbId: null, traktId: null, traktSlug: null };
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
        id: true, tmdbId: true, mediaType: true,
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

      c._inLocalDb  = true;
      c._poplogId   = row.id;

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

// ─── Concurrency limiter ──────────────────────────────────────────────────────
// Runs tasks with at most `concurrency` simultaneous executions.
// Used to avoid overwhelming external APIs with large Promise.all batches.

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<void> {
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      await tasks[i]().catch(() => undefined);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );
}

// ─── pt-BR enrichment via Trakt dedicated translations endpoint ───────────────
// Runs on candidates that still don't have a pt-BR title after inline translations
// and DB enrichment. Calls /movies/{id}/translations/pt or /shows/{id}/translations/pt.
// These responses are cached with TTL=86400. NOT a VIP-only feature (unlike images).
//
// Concurrency cap: max 8 simultaneous requests to avoid Trakt rate-limit cascade.
// Candidate cap: top 60 by score — beyond this, translations rarely affect outcome.

async function enrichWithTraktTranslations(candidates: RecCandidate[]): Promise<void> {
  if (!isTraktActive()) return;

  // Prioritize candidates most likely to be selected before hitting the cap
  const sorted = [...candidates].sort((a, b) => score(b) - score(a));
  const needsTranslation = sorted
    .filter((c) => !c._langSource.startsWith("pt-BR") && c.imdbId)
    .slice(0, 60);
  if (!needsTranslation.length) return;

  await runWithConcurrency(
    needsTranslation.map((c) => async () => {
      const imdbId = c.imdbId!;
      const path =
        c.mediaType === "movie"
          ? `/movies/${encodeURIComponent(imdbId)}/translations/pt`
          : `/shows/${encodeURIComponent(imdbId)}/translations/pt`;

      const translations = await traktGet<TraktTranslation[]>(path, {
        ttlSeconds: 86_400,
      }).catch(() => null);
      if (!Array.isArray(translations)) return;

      const ptBr = translations.find((t) => t.language === "pt" && t.country === "br" && t.title);
      const pt   = translations.find((t) => t.language === "pt" && t.title);
      const best = ptBr ?? pt;
      if (!best?.title) return;

      const titleOriginal = c.title;
      c.originalTitle = c.originalTitle ?? titleOriginal;
      c.title         = best.title;
      c._langSource   = "pt-BR:trakt-trans";
      if (best.overview) c.overview = best.overview;
    }),
    8,
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
  // Apply hydration penalty for balloon-only candidates missing visual/pt-BR (light penalty only)
  const hydrationAdj = c._scoreBreakdown?.hydrationPenalty
    ? c.seedEffectiveWeight * c._scoreBreakdown.hydrationPenalty
    : 0;
  return c.seedEffectiveWeight + c.relationStrength * 0.3 + pop + visual + meta + lang + hydrationAdj;
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

// ─── Route-level in-flight dedup ─────────────────────────────────────────────
// Previne dois requests idênticos simultâneos (ex.: duplo mount da UI no mesmo ciclo).
// Key: primeiros 10 tmdbIds ordenados + limit. TTL curto (3s) para capturar bursts.

const ROUTE_IN_FLIGHT = new Map<string, Promise<unknown>>();
const ROUTE_CACHE     = new Map<string, { data: unknown; ts: number }>();
const ROUTE_DEDUP_TTL = 3_000; // ms

function buildRouteKey(titles: UserTitle[], limit: number): string {
  const ids = titles
    .slice(0, 10)
    .map((t) => `${t.media_type}:${t.tmdb_id}`)
    .sort()
    .join(",");
  return `fy:${ids}:limit=${limit}`;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────
// Separada do handler para facilitar withOrigin + route-level dedup.
// Retorna o payload JSON (não NextResponse).

async function runForYouPipeline(
  titles: UserTitle[],
  FINAL_COUNT: number,
  excludeKeys: Set<string>,
): Promise<unknown> {
    // Auth primeiro — necessário para lookup autoritativo da biblioteca no DB.
    const user = await getCurrentUser().catch(() => null);

    // ── Conjuntos de exclusão da biblioteca ─────────────────────────────────────
    // Estratégia tri-camada para cobrir diferentes mapeamentos de ID entre fontes.
    // REGRA: qualquer item na biblioteca (qualquer status) jamais aparece como recomendação.

    // Camada 1: Títulos enviados pelo cliente (rápido, inclui metadata de sementes)
    const libraryKeys    = new Set(titles.map((t) => `${t.media_type}:${t.tmdb_id}`));
    const libraryTmdbIds = new Set(titles.map((t) => t.tmdb_id));
    const libraryImdbIds = new Set<string>();
    const libraryTraktIds = new Set<string>();

    for (const t of titles) {
      const imdbId = safeStr(t.imdb_id) ?? safeStr(t.externalIds?.imdbId);
      if (imdbId) libraryImdbIds.add(`${t.media_type}:${imdbId}`);
      if (t.externalIds?.traktId) libraryTraktIds.add(`${t.media_type}:${t.externalIds.traktId}`);
    }

    // Camada 2: DB autoritativo em paralelo
    // (a) todos os tmdbIds do usuário direto do DB → captura stale no cliente
    // (b) imdbId/traktId via titleExternalId → cross-ID matching (item salvo com tmdbId real,
    //     recomendação chega com imdbId de fonte diferente)
    const positiveTmdbIds = titles.map((t) => t.tmdb_id).filter((id) => id > 0);
    const [dbLibItems, extIdRows] = await Promise.all([
      user
        ? db.userTitle.findMany({
            where: { userId: user.id },
            select: { tmdbId: true, mediaType: true },
          }).catch(() => [] as { tmdbId: number; mediaType: string }[])
        : Promise.resolve([] as { tmdbId: number; mediaType: string }[]),
      positiveTmdbIds.length > 0
        ? db.titleExternalId.findMany({
            where: { tmdbId: { in: positiveTmdbIds } },
            select: { tmdbId: true, mediaType: true, imdbId: true, traktId: true },
          }).catch(() => [] as { tmdbId: number; mediaType: string; imdbId: string | null; traktId: string | null }[])
        : Promise.resolve([] as { tmdbId: number; mediaType: string; imdbId: string | null; traktId: string | null }[]),
    ]);

    for (const row of dbLibItems) {
      libraryKeys.add(`${row.mediaType}:${row.tmdbId}`);
      libraryTmdbIds.add(row.tmdbId);
    }
    for (const row of extIdRows) {
      if (row.imdbId) libraryImdbIds.add(`${row.mediaType}:${row.imdbId}`);
      if (row.traktId) libraryTraktIds.add(`${row.mediaType}:${row.traktId}`);
    }

    // Camada 3: Expansão de IDs sintéticos → reais
    // Cenário: usuário salvou via Balloonerismm (tmdb_id negativo, e.g. -5788792).
    // O Trakt retorna o mesmo título com o ID real (e.g. 257994). Sem essa expansão o
    // filtro falha e o título aparece em "Para você" mesmo já estando na biblioteca.
    const syntheticInLibrary = titles
      .filter((t) => isSyntheticTmdbId(t.tmdb_id))
      .flatMap((t) => {
        const imdbId = imdbIdFromSyntheticTmdbId(t.tmdb_id);
        return imdbId ? [{ tmdb_id: t.tmdb_id, media_type: t.media_type, imdbId }] : [];
      });

    if (syntheticInLibrary.length > 0) {
      // Adiciona os imdbIds sintéticos diretamente — captura cross-source mesmo sem DB match
      for (const x of syntheticInLibrary) {
        libraryImdbIds.add(`${x.media_type}:${x.imdbId}`);
      }

      const realIdRows = await db.titleExternalId.findMany({
        where: { imdbId: { in: syntheticInLibrary.map((x) => x.imdbId) }, tmdbId: { gt: 0 } },
        select: { tmdbId: true, mediaType: true, imdbId: true },
      }).catch(() => [] as { tmdbId: number; mediaType: string; imdbId: string | null }[]);

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

    // ── FASE 1 — SEMENTES ────────────────────────────────────────────────────
    const allSeeds = buildWeightedSeeds(titles);
    const picks    = pickSeeds(allSeeds);

    if (!picks.length) {
      return { featured: null, items: [], recommendationSource: "empty" };
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

    // ── FASE 4 — Balloonerismm para todas as sementes com imdbId ─────────────────
    // Balloonerismm é a fonte primária de relevância. Trakt é usado apenas como
    // camada de hidratação/canonicalização depois (Fase 5b). Todas as seeds com
    // imdbId são consultadas em /recommendations + /similar com concorrência controlada.

    const seedsWithImdb = picks
      .map((s, i) => ({
        i,
        seed: s,
        imdbId: extIds.get(`${s.title.media_type}:${s.title.tmdb_id}`)?.imdbId,
      }))
      .filter((x): x is typeof x & { imdbId: string } => Boolean(x.imdbId));

    const balloonSeedResults: BalloonSeedResult[] = [];

    await runWithConcurrency(
      seedsWithImdb.map(({ seed, imdbId }) => async () => {
        const src = seedSourceLabel(seed);
        console.log(
          `[for-you:seed] title="${seed.label}" imdb=${imdbId} ` +
          `seedSource=${src} seedWeight=${seed.effectiveWeight} ` +
          `(base:${seed.baseWeight}+recency:${seed.bonus}) userLibrary=true libraryStatus=${seed.title.status ?? "?"}`,
        );
        const fetchResult = await fetchBalloonerismForSeed(imdbId, seed.title.media_type, "for-you");

        if (fetchResult.allBlocked) {
          console.log(
            `[for-you:seed] seedSkippedByCooldown=true ` +
            `cooldownKey="/tv+movie/${imdbId}/rec+sim" ` +
            `retryAfterMs=${fetchResult.retryAfterMs} staleCacheUsed=false ` +
            `title="${seed.label}" imdb=${imdbId}`,
          );
        } else if (fetchResult.partial) {
          console.log(
            `[for-you:seed] partial=true failedEndpoint=${fetchResult.failedEndpoints.join(",")} ` +
            `recs=${fetchResult.items.filter(i => i._source !== "similar").length} ` +
            `sim=${fetchResult.items.filter(i => i._source !== "recommendations").length} ` +
            `title="${seed.label}" imdb=${imdbId}`,
          );
        }

        if (fetchResult.items.length > 0) {
          balloonSeedResults.push({
            seedImdbId:    imdbId,
            seedMediaType: seed.title.media_type,
            seedWeight:    seed.effectiveWeight,
            seedTitle:     seed.label,
            seedReason:    buildReason(seed),
            items:         fetchResult.items,
          });
        }

        console.log(
          `[for-you:seed] "${seed.label}" imdb=${imdbId} ` +
          `surface=for-you.${seed.title.media_type} ` +
          `→ ${fetchResult.items.length} Balloon items ` +
          `(recs=${fetchResult.items.filter(i => i._source !== "similar").length} ` +
          `sim=${fetchResult.items.filter(i => i._source !== "recommendations").length} ` +
          `both=${fetchResult.items.filter(i => i._source === "both").length} ` +
          `partial=${fetchResult.partial} blocked=${fetchResult.allBlocked})`,
        );
      }),
      BALLOON_CONCURRENCY,
    );

    const balloonTotal = balloonSeedResults.reduce((n, r) => n + r.items.length, 0);
    console.log(
      `[for-you:phase4] balloon_seeds=${balloonSeedResults.length}/${seedsWithImdb.length} ` +
      `balloon_items=${balloonTotal} picks=${picks.length}`,
    );

    // ── FASE 4c — Merge Balloon cross-seeds + hidratação Trakt ───────────────
    // Balloon determina relevância. Trakt fornece tmdbId, slug, pt-BR, imagens.
    const mergedBalloon = mergeBalloonCandidates(balloonSeedResults);

    console.log(
      `[for-you:merge] merged_candidates=${mergedBalloon.length} ` +
      `recs_only=${mergedBalloon.filter(c => c.balloonSource === "recommendations").length} ` +
      `sim_only=${mergedBalloon.filter(c => c.balloonSource === "similar").length} ` +
      `both=${mergedBalloon.filter(c => c.balloonSource === "both").length}`,
    );

    // Empty state: all seeds failed Balloon fetch
    if (!mergedBalloon.length) {
      const cooldownActive = balloonSeedResults.length === 0 && seedsWithImdb.length > 0;
      return {
        featured:             null,
        items:                [],
        recommendationSource: "empty_balloon",
        emptyReason:          cooldownActive ? "balloon_cooldown" : "no_balloon_results",
        retryAfterMs:         cooldownActive ? 60_000 : 0,
        staleCacheUsed:       false,
        validSeeds:           seedsWithImdb.length,
        failedSeeds:          seedsWithImdb.length - balloonSeedResults.length,
        cooldownActive,
      };
    }

    // Per-candidate hydration using c.mediaType per candidate (no shared mediaType param)
    const { results: allHydrated, stats: hydrationStats } = await hydrateCandidatesWithTrakt(
      mergedBalloon,
      HYDRATION_CAP,
      HYDRATION_CONCURRENCY,
    );

    console.log(
      `[for-you:hydration] hydrated=${allHydrated.length} ` +
      `trakt=${hydrationStats.hydratedTrakt} balloon_only=${hydrationStats.balloonOnly} ` +
      `not_found=${hydrationStats.traktNotFound} ` +
      `missing_ptbr=${hydrationStats.missingPtBrTranslation} ` +
      `missing_poster=${hydrationStats.missingPoster}`,
    );

    // ── FASE 4d — Converter TraktHydratedCandidate → RecCandidate ─────────────
    const totalMerged = allHydrated.length;
    const rawCandidates: RecCandidate[] = [];

    for (let idx = 0; idx < allHydrated.length; idx++) {
      const h = allHydrated[idx];
      const relationStrength = Math.max(0, Math.round(((totalMerged - idx) / totalMerged) * 100));

      const tmdbId = h.tmdbId ?? syntheticTmdbFromImdbId(h.imdbId);
      if (!tmdbId) continue;

      const hasPoster  = Boolean(h.posterUrl);
      const hasFanart  = Boolean(h.backdropUrl);
      const imgSrc     =
        h.hydrationSource === "trakt" && hasPoster  ? "trakt:poster"  :
        h.hydrationSource === "trakt" && hasFanart  ? "trakt:fanart"  :
        hasPoster                                    ? "balloon:poster" : "pending";

      // Multi-seed reason: if appeared from multiple seeds, mention top 2
      let reason = h.seedReason;
      if (h.appearedFromSeeds > 1 && h.seedOrigins.length > 1) {
        const top  = h.seedOrigins[0];
        const rest = h.appearedFromSeeds - 1;
        reason = `${top.seedReason} e mais ${rest} título${rest > 1 ? "s" : ""} que você gostou`;
      }

      rawCandidates.push({
        tmdbId,
        imdbId:              h.imdbId,
        traktId:             h.traktId ?? null,
        traktSlug:           h.traktSlug ?? null,
        title:               h.title,
        originalTitle:       h.originalTitle ?? null,
        year:                h.year ?? null,
        overview:            h.overview ?? null,
        posterUrl:           h.posterUrl ?? null,
        backdropUrl:         h.backdropUrl ?? null,
        voteAverage:         h.voteAverage ?? null,
        voteCount:           h.voteCount ?? null,
        genreIds:            h.genreIds ?? [],
        mediaType:           h.mediaType,
        seedEffectiveWeight: h.seedBestWeight,
        relationStrength,
        reason,
        _imageSource:        imgSrc,
        _langSource:         h.langSource,
        _inLocalDb:          h.tmdbId != null ? undefined : false,
        _balloonSource:      h.balloonSource,
        _hydrationSource:    h.hydrationSource,
        _appearedFromSeeds:  h.appearedFromSeeds,
        _scoreBreakdown:     h.scoreBreakdown,
      });
    }

    // ── FASE 5 — Deduplicação + filtro biblioteca ──────────────────────────────
    let libRemoved = 0;
    let excluded   = 0;
    let deduped    = 0;
    const deduper    = new Deduper();
    const candidates: RecCandidate[] = [];

    for (const rec of rawCandidates) {
      const k          = `${rec.mediaType}:${rec.tmdbId}`;
      const imdbKey    = rec.imdbId  ? `${rec.mediaType}:${rec.imdbId}`  : null;
      const traktIdKey = rec.traktId ? `${rec.mediaType}:${rec.traktId}` : null;
      const inLibrary =
        libraryKeys.has(k) ||
        (imdbKey    && libraryImdbIds.has(imdbKey))    ||
        (traktIdKey && libraryTraktIds.has(traktIdKey));
      if (inLibrary)          {
        libRemoved++;
        console.log(`[for-you:filter] excludedReason=in-library imdb=${rec.imdbId ?? "?"} title="${rec.title}"`);
        continue;
      }
      if (excludeKeys.has(k)) { excluded++;  rec._discardReason = "session-exclude"; continue; }
      if (deduper.seen(rec))  { deduped++;   rec._discardReason = "dedup"; continue; }
      candidates.push(rec);
    }

    const hadBalloonCandidates = candidates.length > 0;

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
    // Suplementação por DB local genérico removida: não preenchemos com populares
    // sem relação semântica com os seeds do usuário.
    const pool = withImages.length >= FINAL_COUNT ? withImages : eligible;

    // ── LOG SUMMARY ───────────────────────────────────────────────────────────
    const source = hadBalloonCandidates ? "balloon_primary" : "empty";
    console.log(
      `[for-you] context=user-for-you seeds=${picks.length} ` +
      `balloon_seeds=${balloonSeedResults.length} candidates=${candidates.length} ` +
      `lib_removed=${libRemoved} excluded=${excluded} deduped=${deduped} ` +
      `with_images=${withImages.length} pool=${pool.length} source=${source} ` +
      `exclusion_keys=tmdbId(client+db)+imdbId(client+db)+traktId(client+db)+syntheticExpansion` +
      ` lib_db=${dbLibItems.length} ext_enriched=${extIdRows.length}`,
    );

    if (!pool.length) {
      return { featured: null, items: [], recommendationSource: source };
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
        `[for-you:item] tmdb=${c.tmdbId} imdb=${c.imdbId ?? "?"} ` +
        `titleOriginal="${titleOriginal}" titlePtBr="${titlePtBr}" ` +
        `overviewPtBr=${overviewPtBr} langSource=${transSource} ` +
        `fallbackReason=${fallbackReason} ` +
        `image=${c._imageSource} ` +
        `balloonSource=${c._balloonSource ?? "?"} ` +
        `hydrationSource=${c._hydrationSource ?? "?"} ` +
        `appearedFromSeeds=${c._appearedFromSeeds ?? 1} ` +
        `seedWeight=${c.seedEffectiveWeight} ` +
        `userLibrary=false ` +
        `${!c.posterUrl && !c.backdropUrl ? "⚠ sem-imagem " : ""}` +
        `reason="${c.reason}"`,
      );

      // linkId canônico:
      // - título está no DB local (enrichFromDb marcou _inLocalDb) → tmdbId (link direto)
      // - não está no DB → imdbId (página carrega via Balloonerismm)
      // - fallback: String(tmdbId) (sintético)
      const linkId = c._inLocalDb ? String(c.tmdbId) : (c.imdbId ?? String(c.tmdbId));

      return {
        id:           c.tmdbId,
        poplogId:     c._poplogId ?? null,
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
        debug:        [
          `${c._imageSource}|${c._langSource}`,
          `balloon=${c._balloonSource ?? "?"}`,
          `seeds=${c._appearedFromSeeds ?? 1}`,
          `w=${c.seedEffectiveWeight}`,
          c._scoreBreakdown
            ? `score=[final=${c._scoreBreakdown.finalScore.toFixed(3)},internalBalloon=${c._scoreBreakdown.internalScore.toFixed(3)},srcMult=${c._scoreBreakdown.sourceMultiplier},penalty=${c._scoreBreakdown.hydrationPenalty}]`
            : "",
        ].filter(Boolean).join("|"),
      };
    });

    // Featured = highest rating with backdrop; else first item
    const withBackdrop = items.filter((it) => it.backdropUrl);
    const featured     = withBackdrop.length > 0
      ? [...withBackdrop].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0]
      : (items[0] ?? null);
    const rest = featured ? items.filter((it) => it !== featured) : items;

    // Breakdown por fonte Balloon nos itens selecionados
    const recsOnly  = selected.filter((c) => c._balloonSource === "recommendations").length;
    const simOnly   = selected.filter((c) => c._balloonSource === "similar").length;
    const both      = selected.filter((c) => c._balloonSource === "both").length;
    const hydrTrkt  = selected.filter((c) => c._hydrationSource === "trakt").length;
    console.log(
      `[for-you] final=${selected.length}` +
      ` balloon_recs=${recsOnly} balloon_sim=${simOnly} balloon_both=${both}` +
      ` hydrated_trakt=${hydrTrkt}` +
      ` featured="${featured?.title ?? "none"}" source=${source}`,
    );

    return {
      featured,
      items:                rest,
      recommendationSource: source,
    };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body     = await req.json().catch(() => null);
  const titles: UserTitle[] = Array.isArray(body?.titles) ? body.titles : [];
  const excludeKeys = new Set<string>(
    Array.isArray(body?.exclude)
      ? (body.exclude as string[]).slice(-SESSION_EXCLUDE_CAP)
      : [],
  );
  const FINAL_COUNT = Math.min(
    typeof body?.limit === "number" && body.limit > 0 ? body.limit : DEFAULT_FINAL_COUNT,
    MAX_FINAL_COUNT,
  );

  if (!titles.length) {
    return NextResponse.json({ featured: null, items: [], recommendationSource: "empty" });
  }

  // ── Route-level dedup (burst protection) ─────────────────────────────────
  const routeKey    = buildRouteKey(titles, FINAL_COUNT);
  const cachedRoute = ROUTE_CACHE.get(routeKey);
  if (cachedRoute && Date.now() - cachedRoute.ts < ROUTE_DEDUP_TTL) {
    console.log(`[for-you] dedup_hit key="${routeKey}" age=${Date.now() - cachedRoute.ts}ms`);
    return NextResponse.json(cachedRoute.data);
  }
  const inflight = ROUTE_IN_FLIGHT.get(routeKey);
  if (inflight) {
    console.log(`[for-you] dedup_inflight key="${routeKey}"`);
    const data = await inflight;
    return NextResponse.json(data);
  }

  // ── Run pipeline with origin context ─────────────────────────────────────
  const pipelinePromise: Promise<unknown> = withOrigin("for-you", () =>
    runForYouPipeline(titles, FINAL_COUNT, excludeKeys)
  ).catch((err: unknown) => {
    console.error("[for-you]", err);
    return { featured: null, items: [], recommendationSource: "error" };
  });

  ROUTE_IN_FLIGHT.set(routeKey, pipelinePromise);
  const data = await pipelinePromise;
  ROUTE_IN_FLIGHT.delete(routeKey);
  ROUTE_CACHE.set(routeKey, { data, ts: Date.now() });
  return NextResponse.json(data);
}
