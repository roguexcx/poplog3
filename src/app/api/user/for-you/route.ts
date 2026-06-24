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
import { attachBestProvider } from "@/server/availability/attach-best-provider";
import { resolveDisplayTitle } from "@/lib/titles/display-title";
import type { UserTitle } from "@/types/user";
import {
  readContinuitySectionCache,
  writeContinuitySectionCache,
} from "@/server/continuity/continuity-section-cache";
import {
  getUserLibraryIdentityIndex,
  hasTitleIdentity,
  type LibraryIdentityIndex,
} from "@/server/library/library-identity-index";
import { titleIdentityKeys } from "@/lib/user-title-identity";

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_SEEDS             = 12;
const DEFAULT_FINAL_COUNT   = 6;   // home desktop exibe 1 featured + 5 small = 6 slots
const MAX_FINAL_COUNT       = 30;
const SESSION_EXCLUDE_CAP   = 150;
const HOME_FAST_COUNT       = 6;
const FOR_YOU_REGION        = "BR";
const FOR_YOU_LANGUAGE      = "pt-BR";
// Balloonerismm is the primary source. All seeds with imdbId are queried.
// Concurrency cap avoids rate-limit cascades; hydration cap limits Trakt calls.
const BALLOON_CONCURRENCY   = 4;
const HYDRATION_CAP         = 40; // top-N candidates to enrich via Trakt single-item lookup
const HYDRATION_CONCURRENCY = 8;
const FOR_YOU_POOL_CACHE_VERSION = 2;
const PERSISTENT_POOL_TTL_MS     = 60 * 60_000;
const LOCAL_FALLBACK_TTL_MS      = 8 * 60_000;

type ForYouSurface = "home" | "page";
type ForYouMode = "summary" | "full";
type ForYouCacheStatus =
  | "memory_hit"
  | "persistent_hit"
  | "persistent_stale"
  | "miss"
  | "local_fallback"
  | "warming"
  | "error";

type PerfTracker = {
  startedAt: number;
  lastAt: number;
  stages: Record<string, number>;
};

function createPerfTracker(): PerfTracker {
  const now = Date.now();
  return { startedAt: now, lastAt: now, stages: {} };
}

function markPerf(perf: PerfTracker, stage: string): void {
  const now = Date.now();
  perf.stages[stage] = (perf.stages[stage] ?? 0) + (now - perf.lastAt);
  perf.lastAt = now;
}

function finishPerf(perf: PerfTracker): Record<string, number> {
  return { ...perf.stages, total: Date.now() - perf.startedAt };
}

function hashText(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

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

function candidateIdentityKeys(candidate: RecCandidate): string[] {
  return titleIdentityKeys({
    mediaType: candidate.mediaType,
    tmdbId: candidate.tmdbId,
    imdbId: candidate.imdbId,
    traktId: candidate.traktId,
    slug: candidate.traktSlug,
    poplogId: candidate._poplogId,
  });
}

function isInIdentitySet(candidate: RecCandidate, identities: LibraryIdentityIndex): boolean {
  return hasTitleIdentity(identities, {
    mediaType: candidate.mediaType,
    tmdbId: candidate.tmdbId,
    imdbId: candidate.imdbId,
    traktId: candidate.traktId,
    slug: candidate.traktSlug,
    poplogId: candidate._poplogId,
  });
}


// The canonical payload item returned to the client
export type ForYouApiItem = {
  id: number;
  poplogId?: string | null;
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
  /** imdbId quando conhecido — usado para hidratar disponibilidade. */
  imdbId?: string | null;
  traktId?: number | null;
  slug?: string | null;
  /** Disponibilidade (Onde assistir) — mesmo contrato do card da Watchlist. */
  best_provider_name?: string | null;
  best_provider_type?: string | null;
  best_provider_logo?: string | null;
};

type ForYouApiMeta = {
  surface: ForYouSurface;
  mode: ForYouMode;
  cacheStatus: ForYouCacheStatus;
  stale: boolean;
  source: string;
  returned: number;
  generatedAt?: string;
  perf: Record<string, number>;
};

type ForYouApiResponse = {
  featured: ForYouApiItem | null;
  items: ForYouApiItem[];
  recommendationSource: string;
  meta: ForYouApiMeta;
  emptyReason?: string;
  retryAfterMs?: number;
  staleCacheUsed?: boolean;
  validSeeds?: number;
  failedSeeds?: number;
  cooldownActive?: boolean;
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

class Deduper {
  private identities = new Set<string>();

  seen(c: RecCandidate): boolean {
    const identityKeys = candidateIdentityKeys(c);

    if (identityKeys.some((key) => this.identities.has(key))) return true;

    for (const key of identityKeys) this.identities.add(key);
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

function buildRouteKey(titles: UserTitle[], limit: number, excludeKeys: Set<string>): string {
  const ids = titles
    .map((t) => [
      t.media_type,
      t.tmdb_id,
      t.poplogId ?? "",
      t.imdb_id ?? t.externalIds?.imdbId ?? "",
      t.externalIds?.traktId ?? "",
      t.externalIds?.slug ?? "",
    ].join(":"))
    .sort()
    .join(",");
  return `fy:${ids}:exclude=${[...excludeKeys].sort().join(",")}:limit=${limit}`;
}

// ─── Candidate pool cache ─────────────────────────────────────────────────────
// O gargalo de performance do "Pra você" são as chamadas externas (Balloonerismm
// /recommendations+/similar por seed + hidratação Trakt + traduções). Esse pool de
// candidatos elegíveis depende apenas da BIBLIOTECA do usuário, não da seleção
// aleatória final nem do `exclude` de sessão. Cacheamos o pool por assinatura da
// biblioteca; a amostragem ponderada (weightedSample) e o filtro de `exclude` rodam
// frescos a cada request, preservando a variedade entre recargas.

type PoolCachePayload = {
  version: number;
  eligible: RecCandidate[];
  source: string;
  generatedAt: string;
  libraryHash: string;
};

type PoolCacheRead = {
  eligible: RecCandidate[];
  source: string;
  cacheStatus: ForYouCacheStatus;
  stale: boolean;
  generatedAt?: string;
};

const POOL_CACHE     = new Map<string, { eligible: RecCandidate[]; ts: number; source: string; generatedAt: string }>();
const POOL_CACHE_TTL = 60 * 60_000; // 60 min
const POOL_CACHE_MAX = 200;

function buildLibrarySignature(titles: UserTitle[]): string {
  return titles
    .map((t) => [
      t.media_type,
      t.tmdb_id,
      t.poplogId ?? "",
      safeStr(t.imdb_id) ?? safeStr(t.externalIds?.imdbId) ?? "",
      t.externalIds?.traktId ?? "",
      t.externalIds?.slug ?? "",
      t.status ?? "",
      t.favorite ? 1 : 0,
      t.stream_status ?? "",
    ].join(":"))
    .sort()
    .join(",");
}

function buildLibraryHash(titles: UserTitle[]): string {
  return hashText(buildLibrarySignature(titles));
}

function buildPoolKey(titles: UserTitle[], userId: string | null): string {
  return `pool:${userId ?? "anon"}:${buildLibraryHash(titles)}`;
}

function buildPersistentPoolSectionKey(libraryHash: string): string {
  return `for_you_pool_v${FOR_YOU_POOL_CACHE_VERSION}:${libraryHash}`;
}

function cloneCandidates(candidates: RecCandidate[]): RecCandidate[] {
  return JSON.parse(JSON.stringify(candidates)) as RecCandidate[];
}

function readPoolCache(key: string): PoolCacheRead | null {
  const hit = POOL_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > POOL_CACHE_TTL) {
    POOL_CACHE.delete(key);
    return null;
  }
  return {
    eligible: cloneCandidates(hit.eligible),
    source: hit.source,
    cacheStatus: "memory_hit",
    stale: false,
    generatedAt: hit.generatedAt,
  };
}

function writePoolCache(key: string, eligible: RecCandidate[], source: string): void {
  if (POOL_CACHE.size >= POOL_CACHE_MAX) {
    // Evicção simples: remove a entrada mais antiga.
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [k, v] of POOL_CACHE) {
      if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
    }
    if (oldestKey) POOL_CACHE.delete(oldestKey);
  }
  POOL_CACHE.set(key, {
    eligible: cloneCandidates(eligible),
    ts: Date.now(),
    source,
    generatedAt: new Date().toISOString(),
  });
}

async function readPersistentPoolCache(input: {
  userId: string | null;
  libraryHash: string;
}): Promise<PoolCacheRead | null> {
  const cached = await readContinuitySectionCache<PoolCachePayload>(
    buildPersistentPoolSectionKey(input.libraryHash),
    {
      userId: input.userId,
      region: FOR_YOU_REGION,
      language: FOR_YOU_LANGUAGE,
    },
  );

  if (
    !cached?.payload ||
    cached.payload.version !== FOR_YOU_POOL_CACHE_VERSION ||
    cached.payload.libraryHash !== input.libraryHash ||
    !Array.isArray(cached.payload.eligible)
  ) {
    return null;
  }

  return {
    eligible: cloneCandidates(cached.payload.eligible),
    source: cached.payload.source,
    cacheStatus: cached.status === "hit" ? "persistent_hit" : "persistent_stale",
    stale: cached.status === "stale",
    generatedAt: cached.payload.generatedAt,
  };
}

function writePersistentPoolCache(input: {
  userId: string | null;
  libraryHash: string;
  eligible: RecCandidate[];
  source: string;
  ttlMs?: number;
}): void {
  const generatedAt = new Date().toISOString();
  void writeContinuitySectionCache({
    sectionKey: buildPersistentPoolSectionKey(input.libraryHash),
    userId: input.userId,
    region: FOR_YOU_REGION,
    language: FOR_YOU_LANGUAGE,
    ttlMs: input.ttlMs ?? PERSISTENT_POOL_TTL_MS,
    payload: {
      version: FOR_YOU_POOL_CACHE_VERSION,
      eligible: cloneCandidates(input.eligible),
      source: input.source,
      generatedAt,
      libraryHash: input.libraryHash,
    } satisfies PoolCachePayload,
  });
}

// ─── Gate de qualidade mínima ─────────────────────────────────────────────────
// Bloqueia candidatos sem metadados suficientes para exibir um card útil.
// Aplicado ANTES de cachear o pool para que itens fracos não contaminem o cache.
//
// Critérios (qualquer falha descarta o candidato):
//   1. Título ausente
//   2. Sem imagem alguma (poster E backdrop ausentes)
//   3. voteCount conhecido E abaixo de 5 (título praticamente sem dados)
//   4. Sem overview E rating < 4.5 (metadados insuficientes + qualidade baixa)

function passesQualityGate(c: RecCandidate): boolean {
  // 1. Título
  if (!c.title?.trim()) return false;
  // 2. Imagem obrigatória — sem imagem o card fica em branco
  if (!c.posterUrl && !c.backdropUrl) return false;
  // 3. voteCount muito baixo → dados incompletos (new releases: voteCount null → permite)
  const knownLowVotes =
    c.voteCount !== null && c.voteCount !== undefined && c.voteCount < 5;
  if (knownLowVotes) return false;
  // 4. Sem overview + baixa qualidade → provável título fraco / irrelevante
  const hasOverview = c.overview != null && c.overview.trim().length >= 20;
  if (!hasOverview && (c.voteAverage ?? 10) < 4.5) return false;
  return true;
}

async function buildLocalFallbackCandidates(
  titles: UserTitle[],
  libraryIdentities: LibraryIdentityIndex,
  limit: number,
): Promise<RecCandidate[]> {
  const allSeeds = buildWeightedSeeds(titles);
  const picks = pickSeeds(allSeeds);
  if (!picks.length) return [];

  const seedRows = await db.poplog3Title.findMany({
    where: {
      OR: picks.map((seed) => ({
        tmdbId: seed.title.tmdb_id,
        mediaType: seed.title.media_type,
      })),
    },
    select: { tmdbId: true, mediaType: true, genres: true },
  }).catch(() => []);

  const mediaTypes = new Set<"movie" | "tv">(picks.map((seed) => seed.title.media_type));
  const genreWeights = new Map<number, number>();
  for (const row of seedRows) {
    for (const genreId of parseGenreIds(row.genres).slice(0, 4)) {
      genreWeights.set(genreId, (genreWeights.get(genreId) ?? 0) + 1);
    }
  }

  const rows = await db.poplog3Title.findMany({
    where: {
      posterPath: { not: null },
      ...(mediaTypes.size === 1 ? { mediaType: [...mediaTypes][0] } : {}),
    },
    orderBy: [{ popularity: "desc" }, { voteAverage: "desc" }],
    take: Math.max(60, limit * 8),
    select: {
      id: true,
      tmdbId: true,
      mediaType: true,
      title: true,
      originalTitle: true,
      overview: true,
      posterPath: true,
      backdropPath: true,
      voteAverage: true,
      voteCount: true,
      genres: true,
      year: true,
      releaseDate: true,
      firstAirDate: true,
      imdbId: true,
      traktId: true,
      slug: true,
      popularity: true,
    },
  }).catch(() => []);

  const deduper = new Deduper();
  const out: RecCandidate[] = [];

  for (const row of rows) {
    const genreIds = parseGenreIds(row.genres);
    const primaryGenre = genreIds.find((id) => genreWeights.has(id)) ?? genreIds[0] ?? null;
    const genreLabel = primaryGenre ? GENRE_MAP[primaryGenre] : null;
    const genreBonus = primaryGenre ? (genreWeights.get(primaryGenre) ?? 0) * 8 : 0;
    const mediaType = row.mediaType as "movie" | "tv";
    const title = row.title ?? row.originalTitle ?? "";

    const candidate: RecCandidate = {
      tmdbId: row.tmdbId,
      _poplogId: row.id,
      imdbId: row.imdbId ?? null,
      traktId: row.traktId != null ? Number(row.traktId) : null,
      traktSlug: row.slug ?? null,
      title,
      originalTitle: row.originalTitle ?? null,
      overview: row.overview ?? null,
      posterUrl: row.posterPath ?? null,
      backdropUrl: row.backdropPath ?? null,
      voteAverage: row.voteAverage != null ? Number(row.voteAverage) : null,
      voteCount: row.voteCount ?? null,
      year:
        row.year != null
          ? String(row.year)
          : mediaType === "movie"
            ? row.releaseDate?.toISOString().slice(0, 4) ?? null
            : row.firstAirDate?.toISOString().slice(0, 4) ?? null,
      genreIds,
      mediaType,
      seedEffectiveWeight: 35 + genreBonus,
      relationStrength: Math.max(10, 100 - out.length * 3),
      reason: genreLabel
        ? `${genreLabel} · Combina com sua biblioteca`
        : "Combina com sua biblioteca",
      _imageSource: row.posterPath ? "db:poster" : row.backdropPath ? "db:backdrop" : "none",
      _langSource: looksPortuguese(title) ? "pt-BR:db" : "en:db",
      _inLocalDb: true,
      _hydrationSource: "balloon",
    };

    if (isInIdentitySet(candidate, libraryIdentities)) continue;
    if (deduper.seen(candidate)) continue;
    if (!passesQualityGate(candidate)) continue;

    out.push(candidate);
    if (out.length >= limit) break;
  }

  return out;
}

// ─── Seleção final (Fases 8/10/11) ────────────────────────────────────────────
// Extraída para reuso tanto no caminho normal quanto no cache-hit do pool.
// Aplica o filtro de sessão (`exclude`), preferência por imagens e amostragem.

// Número mínimo de slots visuais primários na Home (1 featured + 5 small).
// O pool prefere imagens se tiver pelo menos CORE_DISPLAY candidatos com imagem,
// garantindo que o buffer de renovação (posições 7+) também tenha imagens.
const CORE_DISPLAY = 6;

async function buildForYouResponse(
  eligible: RecCandidate[],
  excludeKeys: Set<string>,
  libraryIdentities: LibraryIdentityIndex,
  FINAL_COUNT: number,
  source: string,
  options: {
    surface: ForYouSurface;
    mode: ForYouMode;
    cacheStatus: ForYouCacheStatus;
    stale?: boolean;
    generatedAt?: string;
    perf: PerfTracker;
    includeProviders?: boolean;
    compact?: boolean;
  },
): Promise<ForYouApiResponse> {
  // Filtro de sessão (`exclude`) — por request, nunca cacheado.
  // A biblioteca também é reaplicada aqui para proteger o caminho de cache-hit.
  const responseDeduper = new Deduper();
  const notExcluded = eligible.filter((c) =>
    !excludeKeys.has(`${c.mediaType}:${c.tmdbId}`) &&
    !isInIdentitySet(c, libraryIdentities) &&
    !responseDeduper.seen(c)
  );

  // Pool com preferência por imagens.
  // Usa apenas candidatos com imagem se houver >= CORE_DISPLAY, garantindo que
  // os slots de renovação (após o primeiro dismiss) também tenham imagem.
  const withImages = notExcluded.filter((c) => c.posterUrl || c.backdropUrl);
  const pool = withImages.length >= CORE_DISPLAY ? withImages : notExcluded;

  if (!pool.length) {
    markPerf(options.perf, "response_build");
    const perf = finishPerf(options.perf);
    return {
      featured: null,
      items: [],
      recommendationSource: source,
      meta: {
        surface: options.surface,
        mode: options.mode,
        cacheStatus: options.cacheStatus,
        stale: Boolean(options.stale),
        source,
        returned: 0,
        generatedAt: options.generatedAt,
        perf,
      },
    };
  }

  // Seleção ponderada (roulette-wheel sem reposição).
  const selected = weightedSample(pool, score, Math.min(FINAL_COUNT, pool.length));

  const items: ForYouApiItem[] = selected.map((c) => {
    const genreLabel = c.genreIds?.[0] ? (GENRE_MAP[c.genreIds[0]] ?? null) : null;
    // Prioridade de linkId: Poplog CUID (rota garantida) > tmdbId local > imdbId externo.
    // Usar imdbId como linkId só quando o título não está no DB local — e nesse caso
    // é a única opção viável para abrir a página do título.
    const linkId = c._poplogId
      ?? (c._inLocalDb ? String(c.tmdbId) : (c.imdbId ?? String(c.tmdbId)));

    return {
      id:            c.tmdbId,
      poplogId:      c._poplogId ?? null,
      linkId,
      title:         resolveDisplayTitle({
        title: c.title,
        originalTitle: c.originalTitle,
        tmdbId: c.tmdbId,
        imdbId: c.imdbId,
        poplogId: c._poplogId,
        mediaType: c.mediaType,
      }),
      originalTitle: c.originalTitle !== c.title ? (c.originalTitle ?? null) : null,
      overview:      options.compact ? undefined : c.overview ?? undefined,
      posterUrl:     c.posterUrl   ?? null,
      backdropUrl:   c.backdropUrl ?? null,
      rating:        c.voteAverage ?? undefined,
      year:          c.year,
      mediaType:     c.mediaType,
      mediaLabel:    c.mediaType === "movie" ? "Filme" : "Série",
      genreLabel,
      reason:        c.reason,
      sourceSeed:    c.seedEffectiveWeight > 0 ? undefined : "popular",
      imdbId:        c.imdbId ?? null,
      traktId:       c.traktId ?? null,
      slug:          c.traktSlug ?? null,
    } as ForYouApiItem;
  });

  const itemsWithProviders = options.includeProviders
    ? await attachBestProvider(items, {
        block: "for-you",
        getMediaType: (it) => it.mediaType,
        getTmdbId: (it) => it.id,
        getImdbId: (it) => it.imdbId ?? null,
      })
    : items;

  // Featured = maior rating com backdrop; senão o primeiro item.
  const withBackdrop = itemsWithProviders.filter((it) => it.backdropUrl);
  const featured = withBackdrop.length > 0
    ? [...withBackdrop].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0]
    : (itemsWithProviders[0] ?? null);
  const rest = featured ? itemsWithProviders.filter((it) => it !== featured) : itemsWithProviders;

  if (options.compact) {
    for (const item of rest) delete item.overview;
    if (featured && !featured.overview) {
      const sourceCandidate = selected.find((candidate) => candidate.tmdbId === featured.id);
      featured.overview = sourceCandidate?.overview ?? undefined;
    }
  }

  markPerf(options.perf, "response_build");
  const perf = finishPerf(options.perf);
  const returned = (featured ? 1 : 0) + rest.length;

  return {
    featured,
    items: rest,
    recommendationSource: source,
    meta: {
      surface: options.surface,
      mode: options.mode,
      cacheStatus: options.cacheStatus,
      stale: Boolean(options.stale),
      source,
      returned,
      generatedAt: options.generatedAt,
      perf,
    },
  };
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────
// Separada do handler para facilitar withOrigin + route-level dedup.
// Retorna o payload JSON (não NextResponse).

async function runForYouPipeline(
  titles: UserTitle[],
  FINAL_COUNT: number,
  excludeKeys: Set<string>,
  options: {
    surface: ForYouSurface;
    mode: ForYouMode;
    includeProviders?: boolean;
    perf: PerfTracker;
  },
): Promise<ForYouApiResponse> {
    // Auth primeiro — necessário para lookup autoritativo da biblioteca no DB.
    const user = await getCurrentUser().catch(() => null);
    markPerf(options.perf, "auth");

    // A chave ainda permite reaproveitar o trabalho externo, mas a biblioteca
    // autoritativa é carregada antes de qualquer cache-hit para nunca servir um
    // título recém-adicionado ou representado por outro alias.
    const poolKey = buildPoolKey(titles, user?.id ?? null);
    const libraryHash = buildLibraryHash(titles);

    // Índice canônico compartilhado por todas as superfícies de descoberta.
    // Une user_titles + user_title_state (qualquer status) e percorre aliases
    // poplog/TMDB/IMDb/Trakt/slug até um ponto fixo. Os títulos enviados pelo
    // cliente entram apenas como aliases adicionais; o DB é autoritativo.
    const suppliedIdentities = titles.map((t) => ({
      mediaType: t.media_type,
      tmdbId: t.externalIds?.tmdbId ?? t.tmdb_id,
      poplogId: t.poplogId,
      imdbId: safeStr(t.imdb_id) ?? safeStr(t.externalIds?.imdbId),
      traktId: t.externalIds?.traktId,
      slug: t.externalIds?.slug,
    }));
    const libraryIdentities = user
      ? await getUserLibraryIdentityIndex(user.id, suppliedIdentities)
      : new Set(suppliedIdentities.flatMap(titleIdentityKeys));
    markPerf(options.perf, "library_read");

    const cachedEligible = readPoolCache(poolKey);
    if (cachedEligible && !(options.mode === "full" && cachedEligible.source === "local_fallback")) {
      markPerf(options.perf, "cache");
      console.log(`[for-you] pool_cache_hit memory candidates=${cachedEligible.eligible.length}`);
      return await buildForYouResponse(
        cachedEligible.eligible,
        excludeKeys,
        libraryIdentities,
        FINAL_COUNT,
        cachedEligible.source,
        {
          surface: options.surface,
          mode: options.mode,
          cacheStatus: cachedEligible.cacheStatus,
          stale: cachedEligible.stale,
          generatedAt: cachedEligible.generatedAt,
          perf: options.perf,
          includeProviders: Boolean(options.includeProviders),
          compact: options.surface === "home",
        },
      );
    }

    const persistentEligible = await readPersistentPoolCache({
      userId: user?.id ?? null,
      libraryHash,
    });
    if (
      persistentEligible &&
      !(options.mode === "full" && persistentEligible.source === "local_fallback")
    ) {
      writePoolCache(poolKey, persistentEligible.eligible, persistentEligible.source);
      markPerf(options.perf, "cache");
      console.log(
        `[for-you] pool_cache_hit persistent status=${persistentEligible.cacheStatus} ` +
        `candidates=${persistentEligible.eligible.length}`,
      );
      return await buildForYouResponse(
        persistentEligible.eligible,
        excludeKeys,
        libraryIdentities,
        FINAL_COUNT,
        persistentEligible.source,
        {
          surface: options.surface,
          mode: options.mode,
          cacheStatus: persistentEligible.cacheStatus,
          stale: persistentEligible.stale,
          generatedAt: persistentEligible.generatedAt,
          perf: options.perf,
          includeProviders: Boolean(options.includeProviders),
          compact: options.surface === "home",
        },
      );
    }

    markPerf(options.perf, "cache");

    if (options.surface === "home" && options.mode === "summary") {
      const localEligible = await buildLocalFallbackCandidates(
        titles,
        libraryIdentities,
        Math.max(HOME_FAST_COUNT, FINAL_COUNT),
      );
      markPerf(options.perf, "local_fallback");

      if (localEligible.length > 0) {
        writePoolCache(poolKey, localEligible, "local_fallback");
        writePersistentPoolCache({
          userId: user?.id ?? null,
          libraryHash,
          eligible: localEligible,
          source: "local_fallback",
          ttlMs: LOCAL_FALLBACK_TTL_MS,
        });

        return await buildForYouResponse(
          localEligible,
          excludeKeys,
          libraryIdentities,
          FINAL_COUNT,
          "local_fallback",
          {
            surface: options.surface,
            mode: options.mode,
            cacheStatus: "local_fallback",
            stale: false,
            perf: options.perf,
            includeProviders: false,
            compact: true,
          },
        );
      }

      markPerf(options.perf, "response_build");
      return {
        featured: null,
        items: [],
        recommendationSource: "warming",
        meta: {
          surface: options.surface,
          mode: options.mode,
          cacheStatus: "warming",
          stale: false,
          source: "warming",
          returned: 0,
          perf: finishPerf(options.perf),
        },
      };
    }

    // ── FASE 1 — SEMENTES ────────────────────────────────────────────────────
    const allSeeds = buildWeightedSeeds(titles);
    const picks    = pickSeeds(allSeeds);
    markPerf(options.perf, "seed_generation");

    if (!picks.length) {
      markPerf(options.perf, "response_build");
      return {
        featured: null,
        items: [],
        recommendationSource: "empty",
        meta: {
          surface: options.surface,
          mode: options.mode,
          cacheStatus: "miss",
          stale: false,
          source: "empty",
          returned: 0,
          perf: finishPerf(options.perf),
        },
      };
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
    markPerf(options.perf, "seed_labels");

    // ── FASE 3 — IDs externos para chamadas Trakt ──────────────────────────────
    const extIds = new Map<string, ExtIds>();
    await Promise.all(
      picks.map(async (seed) => {
        const key = `${seed.title.media_type}:${seed.title.tmdb_id}`;
        extIds.set(key, await resolveExternalIds(seed));
      }),
    );
    markPerf(options.perf, "seed_external_ids");

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
    markPerf(options.perf, "candidate_fetch");

    // ── FASE 4c — Merge Balloon cross-seeds + hidratação Trakt ───────────────
    // Balloon determina relevância. Trakt fornece tmdbId, slug, pt-BR, imagens.
    const mergedBalloonRaw = mergeBalloonCandidates(balloonSeedResults);

    let preHydrationLibRemoved = 0;
    let preHydrationDeduped = 0;
    const preHydrationIdentities = new Set<string>();
    const mergedBalloon = mergedBalloonRaw.filter((candidate) => {
      const identity = {
        mediaType: candidate.mediaType,
        imdbId: candidate.imdbId,
        tmdbId: syntheticTmdbFromImdbId(candidate.imdbId),
      };
      if (hasTitleIdentity(libraryIdentities, identity)) {
        preHydrationLibRemoved++;
        return false;
      }

      const keys = titleIdentityKeys(identity);
      if (keys.some((key) => preHydrationIdentities.has(key))) {
        preHydrationDeduped++;
        return false;
      }
      for (const key of keys) preHydrationIdentities.add(key);
      return true;
    });

    console.log(
      `[for-you:merge] merged_candidates=${mergedBalloon.length}/${mergedBalloonRaw.length} ` +
      `pre_hydration_lib_removed=${preHydrationLibRemoved} ` +
      `pre_hydration_deduped=${preHydrationDeduped} ` +
      `recs_only=${mergedBalloon.filter(c => c.balloonSource === "recommendations").length} ` +
      `sim_only=${mergedBalloon.filter(c => c.balloonSource === "similar").length} ` +
      `both=${mergedBalloon.filter(c => c.balloonSource === "both").length}`,
    );
    markPerf(options.perf, "dedup_pre_enrichment");

    // Empty state: all seeds failed Balloon fetch
    if (!mergedBalloon.length) {
      const cooldownActive = balloonSeedResults.length === 0 && seedsWithImdb.length > 0;
      markPerf(options.perf, "response_build");
      return {
        featured:             null,
        items:                [],
        recommendationSource: "empty_balloon",
        meta: {
          surface: options.surface,
          mode: options.mode,
          cacheStatus: "miss",
          stale: false,
          source: "empty_balloon",
          returned: 0,
          perf: finishPerf(options.perf),
        },
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
    markPerf(options.perf, "hydration");

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

      // Reason: base no seed + contexto de gênero do candidato para melhorar explicabilidade.
      // "Drama · Porque você favoritou 'The Pitt'" deixa claro a conexão ao usuário.
      const candidateGenreLabel = h.genreIds?.[0] ? (GENRE_MAP[h.genreIds[0]] ?? null) : null;

      let reason = h.seedReason;
      if (h.appearedFromSeeds > 1 && h.seedOrigins.length > 1) {
        const top  = h.seedOrigins[0];
        const rest = h.appearedFromSeeds - 1;
        reason = `${top.seedReason} e mais ${rest} título${rest > 1 ? "s" : ""} que você gostou`;
      }
      // Prefixo de gênero: só para recomendações single-seed onde o gênero acrescenta contexto.
      // Multi-seed já tem razão composta; não sobrecarregar com mais info.
      if (candidateGenreLabel && h.appearedFromSeeds === 1) {
        reason = `${candidateGenreLabel} · ${reason}`;
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
    // NOTA: o filtro de sessão (`exclude`) NÃO é aplicado aqui — ele roda por request
    // em buildForYouResponse, para que o pool cacheado seja independente da sessão.
    let libRemoved = 0;
    let deduped    = 0;
    const deduper    = new Deduper();
    const candidates: RecCandidate[] = [];

    for (const rec of rawCandidates) {
      const inLibrary = isInIdentitySet(rec, libraryIdentities);
      if (inLibrary)          {
        libRemoved++;
        console.log(`[for-you:filter] excludedReason=in-library imdb=${rec.imdbId ?? "?"} title="${rec.title}"`);
        continue;
      }
      if (deduper.seen(rec))  { deduped++;   rec._discardReason = "dedup"; continue; }
      candidates.push(rec);
    }
    markPerf(options.perf, "dedup");

    const hadBalloonCandidates = candidates.length > 0;

    // ── FASE 6 — Enriquecimento canônico com local DB ─────────────────────────
    // Aplica: imagens TMDB (sobre Trakt se necessário), ratings, gêneros.
    // NOTA: row.title da DB é o título original (inglês). Não é pt-BR.
    // Fase 6b busca pt-BR via endpoint dedicado do Trakt.
    await enrichFromDb(candidates);
    markPerf(options.perf, "db_enrichment");

    // O enriquecimento revela poplogId e outros aliases locais que não estavam
    // necessariamente presentes na resposta externa. Revalida e deduplica após
    // essa canonicalização para impedir escapes por alias cruzado.
    const canonicalDeduper = new Deduper();
    const canonicalCandidates = candidates.filter((candidate) => {
      if (isInIdentitySet(candidate, libraryIdentities)) {
        libRemoved++;
        return false;
      }
      if (canonicalDeduper.seen(candidate)) {
        deduped++;
        return false;
      }
      return true;
    });
    candidates.length = 0;
    candidates.push(...canonicalCandidates);

    // ── FASE 6b — Localização pt-BR via endpoint dedicado Trakt ───────────────
    // Para candidatos ainda sem pt-BR (inline Trakt não retornou ou DB não tinha),
    // busca /translations/pt separadamente. Resposta em cache TTL=86400.
    await enrichWithTraktTranslations(candidates);
    markPerf(options.perf, "translation_enrichment");

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
      (c) => !notIntSet.has(`${c.mediaType}:${c.tmdbId}`) && passesQualityGate(c),
    );
    markPerf(options.perf, "feedback_quality");

    // ── LOG SUMMARY ───────────────────────────────────────────────────────────
    const source = hadBalloonCandidates ? "balloon_primary" : "empty";
    const withImagesCount = eligible.filter((c) => c.posterUrl || c.backdropUrl).length;
    console.log(
      `[for-you] context=user-for-you seeds=${picks.length} ` +
      `balloon_seeds=${balloonSeedResults.length} candidates=${candidates.length} ` +
      `lib_removed=${libRemoved} deduped=${deduped} ` +
      `with_images=${withImagesCount} eligible=${eligible.length} source=${source} ` +
      `exclusion_keys=canonical(poplog+tmdb+imdb+trakt+slug) ` +
      `library_aliases=${libraryIdentities.size}`,
    );

    // Cacheia o pool elegível (independente de sessão/seleção) para recargas baratas.
    if (eligible.length > 0) {
      writePoolCache(poolKey, eligible, source);
      writePersistentPoolCache({
        userId: user?.id ?? null,
        libraryHash,
        eligible,
        source,
      });
    }
    markPerf(options.perf, "cache_write");

    // ── FASES 8/10/11 — Filtro de sessão + amostragem + payload ───────────────
    return await buildForYouResponse(
      eligible,
      excludeKeys,
      libraryIdentities,
      FINAL_COUNT,
      source,
      {
        surface: options.surface,
        mode: options.mode,
        cacheStatus: "miss",
        stale: false,
        perf: options.perf,
        includeProviders: Boolean(options.includeProviders),
        compact: options.surface === "home",
      },
    );
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body     = await req.json().catch(() => null);
  const titles: UserTitle[] = Array.isArray(body?.titles) ? body.titles : [];
  const surface: ForYouSurface = body?.surface === "page" ? "page" : "home";
  const mode: ForYouMode = body?.mode === "full" || surface === "page" ? "full" : "summary";
  const includeProviders = body?.includeProviders === true;
  const excludeKeys = new Set<string>(
    Array.isArray(body?.exclude)
      ? (body.exclude as string[]).slice(-SESSION_EXCLUDE_CAP)
      : [],
  );
  const FINAL_COUNT = Math.min(
    typeof body?.limit === "number" && body.limit > 0 ? body.limit : DEFAULT_FINAL_COUNT,
    surface === "home" ? HOME_FAST_COUNT : MAX_FINAL_COUNT,
  );
  const perf = createPerfTracker();

  if (!titles.length) {
    markPerf(perf, "response_build");
    return NextResponse.json({
      featured: null,
      items: [],
      recommendationSource: "empty",
      meta: {
        surface,
        mode,
        cacheStatus: "miss",
        stale: false,
        source: "empty",
        returned: 0,
        perf: finishPerf(perf),
      },
    } satisfies ForYouApiResponse);
  }

  // ── Route-level dedup (burst protection) ─────────────────────────────────
  const routeKey = `${surface}:${mode}:${includeProviders ? "providers" : "compact"}:${buildRouteKey(titles, FINAL_COUNT, excludeKeys)}`;
  const inflight = ROUTE_IN_FLIGHT.get(routeKey);
  if (inflight) {
    console.log(`[for-you] dedup_inflight key="${routeKey}"`);
    const data = await inflight;
    return NextResponse.json(data);
  }

  // Run pipeline with origin context
  const pipelinePromise: Promise<unknown> = withOrigin("for-you", () =>
    runForYouPipeline(titles, FINAL_COUNT, excludeKeys, {
      surface,
      mode,
      includeProviders,
      perf,
    })
  ).catch((err: unknown) => {
    console.error("[for-you]", err);
    markPerf(perf, "response_build");
    return {
      featured: null,
      items: [],
      recommendationSource: "error",
      meta: {
        surface,
        mode,
        cacheStatus: "error",
        stale: false,
        source: "error",
        returned: 0,
        perf: finishPerf(perf),
      },
    } satisfies ForYouApiResponse;
  });

  ROUTE_IN_FLIGHT.set(routeKey, pipelinePromise);
  const data = (await pipelinePromise) as ForYouApiResponse;
  ROUTE_IN_FLIGHT.delete(routeKey);
  console.log("[for-you/perf]", {
    surface: data.meta.surface,
    mode: data.meta.mode,
    cacheStatus: data.meta.cacheStatus,
    stale: data.meta.stale,
    returned: data.meta.returned,
    ...data.meta.perf,
  });
  return NextResponse.json(data);
}
