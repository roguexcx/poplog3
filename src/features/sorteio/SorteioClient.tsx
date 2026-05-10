"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  Check,
  ChevronDown,
  Clock,
  Eye,
  Info,
  Play,
  RefreshCcw,
  Shuffle,
  Snowflake,
  Sparkles,
  Star,
  Tv,
  X,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { useUserTitles } from "@/hooks/useUserTitles";
import { useWatchlistToggle } from "@/hooks/useWatchlistToggle";
import { useWatchedToggle } from "@/hooks/useWatchedToggle";
import { createClient } from "@/lib/supabase/client";
import type { TMDBItem, TMDBMediaType } from "@/types/tmdb";
import type { UserTitle } from "@/types/user";

type Mode = "roulette" | "discovery" | "cards";
type SourceFilter = "all" | "watchlist" | "fridge" | "watching" | "favorites" | "rewatch";
type ContentFilter = "all" | "movie" | "tv" | "miniseries" | "animation" | "documentary";
type DurationFilter = "all" | "quick" | "movieNight" | "shortSeries" | "deepDive";
type VibeFilter = "all" | "comfort" | "intense" | "smart" | "magic" | "funny" | "dark";
type AvailabilityFilter = "any" | "streaming" | "rent" | "confirmed";

type Filters = {
  source: SourceFilter;
  content: ContentFilter;
  duration: DurationFilter;
  vibe: VibeFilter;
  availability: AvailabilityFilter;
  allowWatched: boolean;
};

type Genre = { id: number; name: string };
type Season = { season_number: number; episode_count?: number; name?: string };

type TMDBDetails = TMDBItem & {
  genres?: Genre[];
  runtime?: number | null;
  episode_run_time?: number[];
  number_of_seasons?: number | null;
  number_of_episodes?: number | null;
  seasons?: Season[];
  tagline?: string;
};

type EnrichedUserTitle = UserTitle & {
  tmdb: TMDBDetails | null;
  nextEpisode?: NextEpisode | null;
  watchedEpisodes?: number;
  totalEpisodes?: number;
};

type NextEpisode = { season: number; episode: number; name?: string };

type Candidate = {
  key: string;
  tmdbId: number;
  mediaType: TMDBMediaType;
  title: string;
  originalTitle: string | null;
  year: string | null;
  tmdb: TMDBDetails;
  userTitle?: EnrichedUserTitle;
  source: "personal" | "discovery";
  nextEpisode?: NextEpisode | null;
};

const initialFilters: Filters = {
  source: "all",
  content: "all",
  duration: "all",
  vibe: "all",
  availability: "any",
  allowWatched: false,
};

const FATE_CARD_COUNT = 5;

const sourceOptions: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "watchlist", label: "Watchlist" },
  { value: "fridge", label: "Geladeira" },
  { value: "watching", label: "Em andamento" },
  { value: "favorites", label: "Favoritos" },
  { value: "rewatch", label: "Reassistir" },
];

const contentOptions: { value: ContentFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "movie", label: "Filmes" },
  { value: "tv", label: "Séries" },
  { value: "miniseries", label: "Minisséries" },
  { value: "animation", label: "Animações" },
  { value: "documentary", label: "Documentários" },
];

const durationOptions: { value: DurationFilter; label: string }[] = [
  { value: "all", label: "Qualquer duração" },
  { value: "quick", label: "Cabe hoje" },
  { value: "movieNight", label: "Noite de filme" },
  { value: "shortSeries", label: "Pouco compromisso" },
  { value: "deepDive", label: "Mergulho longo" },
];

const vibeOptions: { value: VibeFilter; label: string }[] = [
  { value: "all", label: "Qualquer clima" },
  { value: "comfort", label: "Conforto" },
  { value: "intense", label: "Intenso" },
  { value: "smart", label: "Cabeça" },
  { value: "magic", label: "Mágico" },
  { value: "funny", label: "Leve" },
  { value: "dark", label: "Sombrio" },
];

const availabilityOptions: { value: AvailabilityFilter; label: string }[] = [
  { value: "any", label: "Qualquer plataforma" },
  { value: "streaming", label: "Streaming" },
  { value: "rent", label: "Aluguel/compra" },
  { value: "confirmed", label: "Confirmada" },
];

const vibeGenreIds: Record<Exclude<VibeFilter, "all">, number[]> = {
  comfort: [35, 10751, 10749],
  intense: [28, 53, 80],
  smart: [99, 36, 9648],
  magic: [14, 878, 12],
  funny: [35],
  dark: [27, 80, 53],
};

const genreLabelById: Record<number, string> = {
  12: "Aventura", 14: "Fantasia", 16: "Animação", 18: "Drama",
  27: "Terror", 28: "Ação", 35: "Comédia", 36: "História",
  53: "Suspense", 80: "Crime", 99: "Documentário", 878: "Ficção científica",
  9648: "Mistério", 10749: "Romance", 10751: "Família",
};

const genreNameTranslations: Record<string, string> = {
  Action: "Ação", Adventure: "Aventura", Animation: "Animação", Comedy: "Comédia",
  Crime: "Crime", Documentary: "Documentário", Drama: "Drama", Family: "Família",
  Fantasy: "Fantasia", History: "História", Horror: "Terror", Mystery: "Mistério",
  Romance: "Romance", "Science Fiction": "Ficção científica",
  "Sci-Fi & Fantasy": "Ficção científica e fantasia", Soap: "Novela",
  Thriller: "Suspense", War: "Guerra", Western: "Faroeste",
  "Action & Adventure": "Ação e aventura", Kids: "Infantil", News: "Notícias",
  Reality: "Reality", "Talk": "Talk show", "War & Politics": "Guerra e política",
};

const rejectedStorageKey = "poplog:sorteio:rejected";

function getTitle(item: TMDBDetails | TMDBItem): string {
  return item.title ?? item.name ?? "Título desconhecido";
}

function getOriginalTitle(item: TMDBDetails | TMDBItem): string | null {
  return item.original_title ?? item.original_name ?? null;
}

function getYear(item: TMDBDetails | TMDBItem): string | null {
  const date = item.release_date ?? item.first_air_date;
  return date ? date.slice(0, 4) : null;
}

function getImage(path?: string | null, size = "w780"): string | null {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

function formatRating(value?: number): string | null {
  return typeof value === "number" && value > 0 ? value.toFixed(1) : null;
}

function formatRuntime(candidate: Candidate): string {
  const runtime = candidate.tmdb.runtime;
  if (candidate.mediaType === "movie" && runtime) {
    const hours = Math.floor(runtime / 60);
    const minutes = runtime % 60;
    return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`;
  }
  if (candidate.nextEpisode) return `T${candidate.nextEpisode.season}:E${candidate.nextEpisode.episode}`;
  const episodeRuntime = candidate.tmdb.episode_run_time?.[0];
  if (episodeRuntime) return `${episodeRuntime}min por ep.`;
  const seasons = candidate.tmdb.number_of_seasons;
  if (seasons) return seasons === 1 ? "1 temporada" : `${seasons} temporadas`;
  return candidate.mediaType === "tv" ? "Série" : "Filme";
}

function getGenres(candidate: Candidate): string[] {
  const genres = candidate.tmdb.genres?.map((g) => genreNameTranslations[g.name] ?? g.name).filter(Boolean) ?? [];
  if (genres.length > 0) return genres.slice(0, 3);
  return (candidate.tmdb.genre_ids ?? []).map((id) => genreLabelById[id]).filter(Boolean).slice(0, 3);
}

function normalize(text?: string | null): string {
  return (text ?? "").toLowerCase();
}

function hasGenre(candidate: Candidate, ids: number[], names: string[] = []): boolean {
  const genreIds = candidate.tmdb.genre_ids ?? [];
  const detailNames = candidate.tmdb.genres?.map((g) => normalize(g.name)) ?? [];
  return ids.some((id) => genreIds.includes(id) || detailNames.includes(normalize(genreLabelById[id]))) ||
    names.some((name) => detailNames.some((gn) => gn.includes(normalize(name))));
}

function getAvailabilityLabel(candidate: Candidate): string {
  const status = candidate.userTitle?.stream_status;
  if (!status) return candidate.source === "discovery" ? "Disponibilidade a confirmar" : "Sem disponibilidade confirmada";
  const normalized = normalize(status);
  if (normalized.includes("stream")) return "Disponível em streaming";
  if (normalized.includes("rent") || normalized.includes("alug") || normalized.includes("buy") || normalized.includes("compra")) return "Aluguel ou compra";
  if (normalized.includes("available") || normalized.includes("dispon")) return "Disponibilidade confirmada";
  return status;
}

function getStatusLabel(candidate: Candidate): string {
  if (candidate.source === "discovery") return "Novo para você";
  if (candidate.userTitle?.fridge || candidate.userTitle?.status === "fridge") return "Na geladeira";
  if (candidate.userTitle?.status === "watching") return "Em andamento";
  if (candidate.userTitle?.favorite) return "Favorito";
  if (candidate.userTitle?.status === "watched") return "Assistido";
  if (candidate.userTitle?.status === "watchlist") return "Na watchlist";
  return "Na sua biblioteca";
}

function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.round((Date.now() - then) / 86400000));
}

function getReason(candidate: Candidate, mode: Mode): string {
  if (candidate.nextEpisode) {
    const watched = candidate.userTitle?.watchedEpisodes ?? 0;
    const total = candidate.userTitle?.totalEpisodes ?? 0;
    const remaining = total > 0 ? Math.max(total - watched, 0) : null;
    if (remaining !== null && remaining <= 4) return "Faltam poucos episódios para terminar essa história.";
    return `O próximo portal é T${candidate.nextEpisode.season}:E${candidate.nextEpisode.episode}.`;
  }
  if (candidate.userTitle?.fridge || candidate.userTitle?.status === "fridge") return "Talvez seja hora de descongelar este título.";
  if (candidate.userTitle?.status === "watchlist") {
    const days = daysSince(candidate.userTitle.created_at);
    return days ? `Na sua Watchlist há ${days} dias.` : "Já estava esperando por você na Watchlist.";
  }
  if (candidate.userTitle?.favorite) return "Um favorito voltou a pedir a sala escura.";
  if (candidate.userTitle?.status === "watched") return "A noite também aceita uma boa reassistida.";
  if (candidate.source === "discovery") return "Uma escolha improvável entrou em cena.";
  if (mode === "cards") return "As cartas puxaram uma escolha com o clima certo.";
  const runtime = candidate.tmdb.runtime;
  if (runtime && runtime <= 105) return "Cabe na noite sem virar compromisso.";
  return "O sorteio encontrou um ponto bom entre desejo, tempo e disponibilidade.";
}

function personalSourceMatches(title: EnrichedUserTitle, source: SourceFilter): boolean {
  if (source === "all") return true;
  if (source === "watchlist") return title.status === "watchlist" && !title.fridge;
  if (source === "fridge") return Boolean(title.fridge) || title.status === "fridge";
  if (source === "watching") return title.status === "watching";
  if (source === "favorites") return Boolean(title.favorite);
  if (source === "rewatch") return title.status === "watched";
  return true;
}

function candidateMatchesFilters(candidate: Candidate, filters: Filters, mode: Mode): boolean {
  const alreadyWatched = candidate.userTitle?.status === "watched";
  if (alreadyWatched && !filters.allowWatched) return false;
  if (candidate.source === "personal" && mode !== "discovery" && !personalSourceMatches(candidate.userTitle!, filters.source)) return false;
  if (filters.content === "movie" && candidate.mediaType !== "movie") return false;
  if (filters.content === "tv" && candidate.mediaType !== "tv") return false;
  if (filters.content === "miniseries" && !(candidate.mediaType === "tv" && (candidate.tmdb.number_of_seasons ?? 99) <= 1)) return false;
  if (filters.content === "animation" && !hasGenre(candidate, [16], ["animation", "anima"])) return false;
  if (filters.content === "documentary" && !hasGenre(candidate, [99], ["document"])) return false;
  if (filters.vibe !== "all") { const ids = vibeGenreIds[filters.vibe]; if (!hasGenre(candidate, ids)) return false; }
  if (filters.duration === "quick") {
    const runtime = candidate.tmdb.runtime ?? candidate.tmdb.episode_run_time?.[0] ?? null;
    if (candidate.mediaType === "movie" && runtime && runtime > 110) return false;
    if (candidate.mediaType === "tv" && !candidate.nextEpisode && runtime && runtime > 50) return false;
  }
  if (filters.duration === "movieNight" && candidate.mediaType === "movie") { const runtime = candidate.tmdb.runtime; if (runtime && runtime > 160) return false; }
  if (filters.duration === "shortSeries") { if (candidate.mediaType !== "tv") return false; if ((candidate.tmdb.number_of_seasons ?? 99) > 1 && !candidate.nextEpisode) return false; }
  if (filters.duration === "deepDive") {
    const runtime = candidate.tmdb.runtime ?? 0;
    const seasons = candidate.tmdb.number_of_seasons ?? 0;
    if (candidate.mediaType === "movie" && runtime < 130) return false;
    if (candidate.mediaType === "tv" && seasons < 2) return false;
  }
  if (filters.availability === "confirmed" && candidate.source === "personal" && !candidate.userTitle?.stream_status) return false;
  return true;
}

function availabilityScore(candidate: Candidate, filter: AvailabilityFilter): number {
  const status = normalize(candidate.userTitle?.stream_status);
  if (!status) return 0;
  if (filter === "streaming" && status.includes("stream")) return 8;
  if (filter === "rent" && (status.includes("rent") || status.includes("alug") || status.includes("buy") || status.includes("compra"))) return 8;
  if (filter === "confirmed") return 6;
  return status ? 2 : 0;
}

function weightedPick(candidates: Candidate[], filters: Filters, lastKey: string | null): Candidate | null {
  const pool = candidates.filter((c) => c.key !== lastKey || candidates.length === 1);
  if (pool.length === 0) return null;
  const weighted = pool.map((c) => {
    let score = 10 + availabilityScore(c, filters.availability);
    if (c.nextEpisode) score += 4;
    if (c.userTitle?.fridge) score += 2;
    if (c.userTitle?.favorite) score += 1;
    score += Math.min(c.tmdb.vote_average ?? 0, 9) / 3;
    return { candidate: c, score };
  }).sort((a, b) => b.score - a.score);
  const top = weighted.slice(0, Math.max(3, Math.ceil(weighted.length * 0.55)));
  return top[Math.floor(Math.random() * top.length)]?.candidate ?? weighted[0]?.candidate ?? null;
}

function buildFateCards(candidates: Candidate[], filters: Filters, lastKey: string | null): (Candidate | null)[] {
  const used = new Set<string>();
  return Array.from({ length: FATE_CARD_COUNT }).map((_, i) => {
    const pool = candidates.filter((c) => !used.has(c.key));
    const picked = weightedPick(pool, filters, i === 0 ? lastKey : null);
    if (!picked) return null;
    used.add(picked.key);
    return picked;
  });
}

function toCandidate(title: EnrichedUserTitle): Candidate | null {
  if (!title.tmdb) return null;
  const mediaType = title.media_type === "tv" ? "tv" : "movie";
  return {
    key: `${mediaType}-${title.tmdb_id}`,
    tmdbId: title.tmdb_id,
    mediaType,
    title: getTitle(title.tmdb),
    originalTitle: getOriginalTitle(title.tmdb),
    year: getYear(title.tmdb) ?? (title.release_year ? String(title.release_year) : null),
    tmdb: { ...title.tmdb, media_type: mediaType },
    userTitle: title,
    source: "personal",
    nextEpisode: title.nextEpisode,
  };
}

function itemToDiscoveryCandidate(item: TMDBItem): Candidate {
  const mediaType = item.media_type === "tv" ? "tv" : "movie";
  const tmdb = { ...item, media_type: mediaType } as TMDBDetails;
  return {
    key: `${mediaType}-${item.id}`,
    tmdbId: item.id,
    mediaType,
    title: getTitle(item),
    originalTitle: getOriginalTitle(item),
    year: getYear(item),
    tmdb,
    source: "discovery",
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(url, init);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch { return null; }
}

type EpisodeRow = { tmdb_id: number; season: number; episode: number };
type AvailableEpisode = { episode_number: number; name?: string; available: boolean };

async function attachNextEpisodes(titles: EnrichedUserTitle[], userId: string | undefined): Promise<EnrichedUserTitle[]> {
  const watching = titles.filter((t) => t.media_type === "tv" && t.status === "watching" && t.tmdb?.seasons?.length);
  if (!watching.length || !userId) return titles;
  const supabase = createClient();
  const { data } = await supabase.from("episode_progress").select("tmdb_id, season, episode").eq("user_id", userId);
  const watchedRows = (data ?? []) as EpisodeRow[];
  const nextByKey = new Map<string, { nextEpisode: NextEpisode | null; watchedEpisodes: number; totalEpisodes: number }>();
  await Promise.all(watching.map(async (title) => {
    const validSeasons = title.tmdb?.seasons?.filter((s) => s.season_number > 0) ?? [];
    const watchedForTitle = watchedRows.filter((r) => r.tmdb_id === title.tmdb_id);
    let nextEpisode: NextEpisode | null = null;
    let totalEpisodes = 0;
    let watchedEpisodes = 0;
    for (const season of validSeasons) {
      const payload = await fetchJson<{ episodes: AvailableEpisode[] }>(`/api/episodes?tvId=${title.tmdb_id}&season=${season.season_number}`);
      const episodes = (payload?.episodes ?? []).filter((e) => e.available);
      totalEpisodes += episodes.length;
      const watchedSet = new Set(watchedForTitle.filter((r) => r.season === season.season_number).map((r) => r.episode));
      watchedEpisodes += episodes.filter((e) => watchedSet.has(e.episode_number)).length;
      if (!nextEpisode) {
        const next = episodes.find((e) => !watchedSet.has(e.episode_number));
        if (next) nextEpisode = { season: season.season_number, episode: next.episode_number, name: next.name };
      }
    }
    nextByKey.set(title.id, { nextEpisode, watchedEpisodes, totalEpisodes });
  }));
  return titles.map((t) => { const next = nextByKey.get(t.id); return next ? { ...t, ...next } : t; });
}

function loadRejectedKeys(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(rejectedStorageKey) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((i): i is string => typeof i === "string") : []);
  } catch { return new Set(); }
}

function saveRejectedKey(key: string) {
  const keys = loadRejectedKeys();
  keys.add(key);
  window.localStorage.setItem(rejectedStorageKey, JSON.stringify(Array.from(keys).slice(-200)));
}

function chooseDiscoveryGenres(filters: Filters): number[] {
  if (filters.content === "animation") return [16];
  if (filters.content === "documentary") return [99];
  if (filters.vibe !== "all") return vibeGenreIds[filters.vibe];
  return [18, 35, 53, 878];
}

async function fetchDiscoveryCandidates(filters: Filters, personalKeys: Set<string>): Promise<Candidate[]> {
  const mediaTypes: TMDBMediaType[] = filters.content === "movie" ? ["movie"] : filters.content === "tv" || filters.content === "miniseries" ? ["tv"] : ["movie", "tv"];
  const rejected = loadRejectedKeys();
  const genres = chooseDiscoveryGenres(filters);
  const page = String(1 + Math.floor(Math.random() * 3));
  const responses = await Promise.all(mediaTypes.flatMap((media) => genres.slice(0, 2).map((genre) => fetchJson<{ results?: TMDBItem[] }>(`/api/tmdb/discover?genre=${genre}&media=${media}&page=${page}`))));
  const seen = new Set<string>();
  return responses.flatMap((r) => r?.results ?? []).map(itemToDiscoveryCandidate)
    .filter((c) => { if (seen.has(c.key)) return false; seen.add(c.key); return !personalKeys.has(c.key) && !rejected.has(c.key); })
    .filter((c) => c.tmdb.poster_path || c.tmdb.backdrop_path)
    .filter((c) => candidateMatchesFilters(c, filters, "discovery"));
}

async function hydrateCandidate(candidate: Candidate): Promise<Candidate> {
  const details = await fetchJson<TMDBDetails>(`/api/tmdb/${candidate.mediaType}/${candidate.tmdbId}`);
  if (!details) return candidate;
  const tmdb = { ...candidate.tmdb, ...details, media_type: candidate.mediaType };
  return { ...candidate, title: getTitle(tmdb), originalTitle: getOriginalTitle(tmdb), year: getYear(tmdb) ?? candidate.year, tmdb };
}

// ─── FilterGroup ───────────────────────────────────────────────────────────────

function FilterGroup<T extends string>({
  label, options, value, onChange, muted = false,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  muted?: boolean;
}) {
  return (
    <div>
      <p className="mb-2.5 text-[9px] font-black uppercase tracking-[0.3em] text-[#19D5FF]/50">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = option.value === value;
          const selectOption = () => onChange(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onPointerDown={(e) => { e.preventDefault(); selectOption(); }}
              onClick={selectOption}
              className={[
                "rounded-full border px-3 py-2 md:py-1.5 text-[11px] font-bold transition-all duration-200",
                "focus:outline-none focus:ring-1 focus:ring-[#19D5FF]/30",
                "active:scale-95",
                active
                  ? "border-[#19D5FF]/40 bg-[#19D5FF]/10 text-[#19D5FF] shadow-[0_0_16px_rgba(25,213,255,0.12)]"
                  : "border-white/[0.07] bg-white/[0.03] text-slate-400 hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-slate-200",
                muted && !active ? "opacity-40" : "",
              ].join(" ")}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── FateCardsStage ────────────────────────────────────────────────────────────

function FateCardsStage({
  candidates,
  cardSlots = [],
  revealedCards = {},
  revealingIndex = null,
  onRevealCard,
  onClearCard,
}: {
  candidates: Candidate[];
  cardSlots?: (Candidate | null)[];
  revealedCards?: Record<number, Candidate>;
  revealingIndex?: number | null;
  onRevealCard?: (index: number) => void;
  onClearCard?: (index: number) => void;
}) {
  const visibleCards = cardSlots.length > 0 ? cardSlots : Array.from({ length: FATE_CARD_COUNT }, () => null);

  return (
    <div className="flex flex-col items-center gap-8 md:gap-10">

      {/* ── Cards row ─────────────────────────────────────────────────────── */}
      <div className="relative w-full">
        {/* Ambient glow */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-48 md:h-64 bg-[radial-gradient(ellipse_80%_60%_at_50%_50%,rgba(25,213,255,0.05),transparent_70%)]" />

        {/*
          Mobile: horizontal scroll with peek — each card is ~42vw so ~2.4 fit
          Tablet+: 5-column grid
        */}
        <div
          className="
            flex gap-3 overflow-x-auto overscroll-x-contain scroll-smooth
            px-4 pb-3
            snap-x snap-mandatory
            md:grid md:grid-cols-5 md:gap-4 md:overflow-visible md:px-2 md:pb-0
            lg:gap-5
            [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]
          "
        >
          {visibleCards.map((candidate, index) => {
            const revealed = revealedCards[index];
            const isRevealing = revealingIndex === index;
            const poster = revealed ? getImage(revealed.tmdb.poster_path, "w500") : null;

            if (revealed) {
              return (
                <div
                  key={`${index}-${revealed.key}`}
                  className="
                    group relative shrink-0
                    w-[42vw] max-w-[180px]
                    md:w-auto md:max-w-none
                    snap-center
                    aspect-[2/3] overflow-hidden rounded-2xl
                    border border-[#19D5FF]/25
                    shadow-[0_0_40px_rgba(25,213,255,0.12),0_20px_60px_rgba(0,0,0,0.7)]
                    transition-all duration-700
                  "
                  style={{ animation: "cardReveal 0.6s cubic-bezier(0.16,1,0.3,1) both" }}
                >
                  {poster ? (
                    <Image
                      src={poster}
                      alt={revealed.title}
                      fill
                      sizes="(max-width: 768px) 42vw, 20vw"
                      className="object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-[#071426] text-[10px] text-slate-500">Sem imagem</div>
                  )}

                  {/* Top cyan line */}
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#19D5FF]/60 to-transparent" />

                  {/* Bottom gradient — always visible on mobile (no hover), fade on desktop hover */}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#020611]/80 via-transparent to-transparent md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300" />

                  {/* Dismiss — always visible on mobile, hover on desktop */}
                  <button
                    type="button"
                    onClick={() => onClearCard?.(index)}
                    className="
                      absolute top-2 right-2
                      w-7 h-7 md:w-6 md:h-6
                      rounded-full bg-[#020611]/85 border border-white/15
                      flex items-center justify-center
                      md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200
                      active:scale-95
                    "
                  >
                    <X className="h-3.5 w-3.5 md:h-3 md:w-3 text-slate-300" />
                  </button>

                  {/* "Revelada" badge — mobile always, desktop hover */}
                  <div className="absolute top-2 left-2 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200">
                    <span className="text-[7px] md:text-[8px] font-black uppercase tracking-[0.2em] text-[#19D5FF] bg-[#020611]/80 px-1.5 py-0.5 rounded-full border border-[#19D5FF]/20">
                      Revelada
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <button
                key={`${index}-${candidate?.key ?? "empty"}`}
                type="button"
                onClick={() => onRevealCard?.(index)}
                disabled={!candidate || isRevealing}
                className={[
                  // sizing
                  "group relative shrink-0",
                  "w-[42vw] max-w-[180px]",
                  "md:w-auto md:max-w-none",
                  "snap-center",
                  "aspect-[2/3] overflow-hidden rounded-2xl border transition-all duration-500",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#19D5FF]/40",
                  // active tap feedback on mobile
                  "active:scale-[0.97]",
                  candidate && !isRevealing
                    ? "border-white/[0.08] bg-[#050B1A] hover:-translate-y-2 hover:border-[#19D5FF]/30 hover:shadow-[0_0_50px_rgba(25,213,255,0.1),0_28px_70px_rgba(0,0,0,0.7)] cursor-pointer shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
                    : "border-white/[0.04] bg-[#050B1A]/50 cursor-wait shadow-[0_8px_24px_rgba(0,0,0,0.5)]",
                ].join(" ")}
              >
                {/* Card back pattern */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(124,58,237,0.18),transparent_50%),radial-gradient(circle_at_50%_100%,rgba(25,213,255,0.06),transparent_40%)]" />

                {/* Inner border decorations */}
                <div className="absolute inset-[6px] rounded-xl border border-white/[0.05]" />
                <div className="absolute inset-[12px] rounded-lg border border-white/[0.03]" />

                {/* Subtle grid lines */}
                <div
                  className="absolute inset-0 opacity-[0.03]"
                  style={{
                    backgroundImage: "linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)",
                    backgroundSize: "24px 24px",
                  }}
                />

                {/* Center icon */}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 md:gap-3">
                  {isRevealing ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-5 h-5 md:w-6 md:h-6 rounded-full border-2 border-[#19D5FF]/40 border-t-[#19D5FF] animate-spin" />
                      <span className="text-[7px] md:text-[8px] font-black uppercase tracking-[0.25em] text-[#19D5FF]/60">Revelando</span>
                    </div>
                  ) : (
                    <>
                      <div className={[
                        "relative w-8 h-8 md:w-10 md:h-10 rounded-full border border-white/10 flex items-center justify-center transition-all duration-300",
                        candidate ? "group-hover:border-[#19D5FF]/30 group-hover:shadow-[0_0_20px_rgba(25,213,255,0.15)]" : "",
                      ].join(" ")}>
                        <Sparkles className={[
                          "h-4 w-4 md:h-5 md:w-5 transition-all duration-300",
                          candidate ? "text-[#7C3AED]/80 group-hover:text-[#19D5FF]/80 group-hover:scale-110" : "text-white/10",
                        ].join(" ")} />
                      </div>
                      <span className="text-[7px] md:text-[8px] font-black uppercase tracking-[0.2em] md:tracking-[0.25em] text-white/30 group-hover:text-[#19D5FF]/50 transition-colors duration-300">
                        {candidate ? "Destino" : "—"}
                      </span>
                    </>
                  )}
                </div>

                {/* Top cyan accent line on hover */}
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#19D5FF]/0 to-transparent group-hover:via-[#19D5FF]/50 transition-all duration-500" />

                {/* Card index number */}
                <div className="absolute bottom-2 inset-x-0 flex justify-center">
                  <span className="text-[7px] font-black uppercase tracking-[0.3em] text-white/15 group-hover:text-[#19D5FF]/30 transition-colors duration-300">
                    {index + 1}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Mobile scroll hint dots */}
        <div className="flex justify-center gap-1.5 mt-3 md:hidden">
          {visibleCards.map((_, i) => {
            const isRevealed = Boolean(revealedCards[i]);
            return (
              <div
                key={i}
                className={[
                  "rounded-full transition-all duration-300",
                  isRevealed
                    ? "w-4 h-1 bg-[#19D5FF]/60"
                    : "w-1 h-1 bg-white/20",
                ].join(" ")}
              />
            );
          })}
        </div>
      </div>

      {/* ── Revealed card details ──────────────────────────────────────────── */}
      {Object.keys(revealedCards).length > 0 && (
        <div className="w-full space-y-3">
          {Object.entries(revealedCards).map(([indexStr, revealed]) => {
            const index = Number(indexStr);
            return (
              <RevealedCardDetail
                key={revealed.key}
                candidate={revealed}
                onClear={() => onClearCard?.(index)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── RevealedCardDetail ────────────────────────────────────────────────────────

function RevealedCardDetail({ candidate, onClear }: { candidate: Candidate; onClear: () => void }) {
  const backdrop = getImage(candidate.tmdb.backdrop_path, "w1280");
  const poster = getImage(candidate.tmdb.poster_path, "w500");
  const rating = formatRating(candidate.tmdb.vote_average);
  const genres = getGenres(candidate);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#050B1A]/80 backdrop-blur-xl"
      style={{ animation: "slideDown 0.5s cubic-bezier(0.16,1,0.3,1) both" }}
    >
      {backdrop && (
        <Image src={backdrop} alt="" fill sizes="100vw" className="object-cover opacity-[0.08] blur-sm saturate-150" />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-[#020611]/95 via-[#050B1A]/90 to-[#071426]/80" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#19D5FF]/30 to-transparent" />

      <div className="relative flex gap-4 p-4 md:gap-5 md:p-5">
        {/* Mini poster */}
        <div className="relative shrink-0 w-14 md:w-16 aspect-[2/3] overflow-hidden rounded-xl border border-[#19D5FF]/15 shadow-[0_0_20px_rgba(25,213,255,0.08)]">
          {poster ? (
            <Image src={poster} alt={candidate.title} fill sizes="64px" className="object-cover" />
          ) : (
            <div className="h-full bg-[#071426]" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {/* Badges */}
              <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                <span className="text-[7px] md:text-[8px] font-black uppercase tracking-[0.2em] md:tracking-[0.25em] text-[#19D5FF]/60 bg-[#19D5FF]/8 border border-[#19D5FF]/15 px-2 py-0.5 rounded-full">
                  {getStatusLabel(candidate)}
                </span>
                {candidate.mediaType !== "movie" && (
                  <span className="text-[7px] md:text-[8px] font-black uppercase tracking-[0.2em] text-slate-500 border border-white/[0.06] px-2 py-0.5 rounded-full">
                    Série
                  </span>
                )}
              </div>

              {/* Title */}
              <h3 className="text-sm md:text-base font-black text-white leading-tight truncate">{candidate.title}</h3>

              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-1.5 md:gap-2 mt-1.5">
                {candidate.year && <span className="text-[10px] text-slate-500">{candidate.year}</span>}
                <span className="w-px h-3 bg-white/10 hidden sm:block" />
                <span className="text-[10px] text-slate-500">{formatRuntime(candidate)}</span>
                {rating && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-amber-300/80">
                    <Star className="h-2.5 w-2.5 fill-current" /> {rating}
                  </span>
                )}
                {genres.length > 0 && (
                  <span className="text-[10px] text-slate-500 hidden sm:inline">{genres.join(" · ")}</span>
                )}
              </div>

              {/* Genres on own row for very small screens */}
              {genres.length > 0 && (
                <p className="text-[10px] text-slate-600 mt-1 sm:hidden truncate">{genres.join(" · ")}</p>
              )}
            </div>

            {/* Reset button */}
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 w-8 h-8 md:w-7 md:h-7 rounded-full border border-white/[0.07] bg-white/[0.03] flex items-center justify-center text-slate-500 hover:text-slate-300 hover:border-white/15 active:scale-95 transition-all duration-200"
            >
              <RefreshCcw className="h-3.5 w-3.5 md:h-3 md:w-3" />
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            <Link
              href={`/title/${candidate.mediaType}/${candidate.tmdbId}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#19D5FF] px-3 py-2 md:py-1.5 text-[10px] font-black text-[#020611] hover:bg-[#6EEBFF] active:scale-95 transition-all duration-200"
            >
              <Play className="h-3 w-3" /> Assistir
            </Link>
            <Link
              href={`/title/${candidate.mediaType}/${candidate.tmdbId}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-2 md:py-1.5 text-[10px] font-bold text-slate-300 hover:bg-white/[0.07] active:scale-95 transition-all duration-200"
            >
              <Info className="h-3 w-3" /> Detalhes
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ResultActions (full) ──────────────────────────────────────────────────────

function ResultActions({ candidate, onRemove, onReject }: { candidate: Candidate; onRemove: () => void; onReject: () => void }) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const releaseYear = candidate.year ? Number(candidate.year) : null;
  const shared = {
    tmdbId: candidate.tmdbId,
    mediaType: candidate.mediaType,
    title: candidate.title,
    releaseYear: Number.isFinite(releaseYear) ? releaseYear : null,
  };
  const watchlist = useWatchlistToggle(shared);
  const watched = useWatchedToggle(shared);

  async function putInFridge() {
    if (!user || saving) return;
    setSaving(true);
    const supabase = createClient();
    await supabase.from("user_titles").upsert({
      user_id: user.id, tmdb_id: candidate.tmdbId, media_type: candidate.mediaType,
      status: "watchlist", favorite: candidate.userTitle?.favorite ?? false, fridge: true,
      title: candidate.title, release_year: shared.releaseYear,
    }, { onConflict: "user_id,tmdb_id,media_type" });
    window.dispatchEvent(new Event("poplog:user-titles-updated"));
    setSaving(false);
  }

  async function removeFromList() {
    if (!user || saving || candidate.source !== "personal") return;
    setSaving(true);
    const supabase = createClient();
    await supabase.from("user_titles").delete().eq("user_id", user.id).eq("tmdb_id", candidate.tmdbId).eq("media_type", candidate.mediaType);
    window.dispatchEvent(new Event("poplog:user-titles-updated"));
    setSaving(false);
    onRemove();
  }

  const btn = "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black transition duration-200 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex flex-wrap gap-1.5">
      <Link href={`/title/${candidate.mediaType}/${candidate.tmdbId}`} className={`${btn} bg-[#19D5FF] border-[#19D5FF] text-[#020611] hover:bg-[#6EEBFF]`}>
        <Play className="h-3 w-3" /> Assistir agora
      </Link>
      <Link href={`/title/${candidate.mediaType}/${candidate.tmdbId}`} className={`${btn} border-white/10 bg-white/[0.05] text-white hover:bg-white/[0.09]`}>
        <Info className="h-3 w-3" /> Detalhes
      </Link>
      <button type="button" onClick={watched.toggle} disabled={watched.loading || watched.saving || !watched.isLoggedIn} className={`${btn} border-emerald-300/20 bg-emerald-300/8 text-emerald-300/80 hover:bg-emerald-300/12`}>
        <Check className="h-3 w-3" /> {watched.isWatched ? "Já visto" : "Marcar visto"}
      </button>
      <button type="button" onClick={putInFridge} disabled={!user || saving} className={`${btn} border-[#19D5FF]/20 bg-[#19D5FF]/8 text-[#19D5FF]/70 hover:bg-[#19D5FF]/12`}>
        <Snowflake className="h-3 w-3" /> Geladeira
      </button>
      {candidate.source === "discovery" ? (
        <button type="button" onClick={onReject} className={`${btn} border-white/8 bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]`}>
          <X className="h-3 w-3" /> Dispensar
        </button>
      ) : (
        <button type="button" onClick={removeFromList} disabled={!user || saving} className={`${btn} border-white/8 bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]`}>
          <X className="h-3 w-3" /> Remover
        </button>
      )}
      {candidate.source === "discovery" && (
        <button type="button" onClick={watchlist.toggle} disabled={watchlist.loading || watchlist.saving || !watchlist.isLoggedIn} className={`${btn} border-[#0EA5E9]/20 bg-[#0EA5E9]/8 text-[#0EA5E9]/70 hover:bg-[#0EA5E9]/12`}>
          <Bookmark className="h-3 w-3" /> {watchlist.inWatchlist ? "Na watchlist" : "Salvar"}
        </button>
      )}
    </div>
  );
}

// ─── Main Export ───────────────────────────────────────────────────────────────

export default function SorteioClient() {
  const { user, loading: authLoading } = useAuth();
  const { titles, loading: titlesLoading } = useUserTitles();
  const [mode] = useState<Mode>("cards");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [personalTitles, setPersonalTitles] = useState<EnrichedUserTitle[]>([]);
  const [personalLoading, setPersonalLoading] = useState(true);
  const [discoveryCandidates, setDiscoveryCandidates] = useState<Candidate[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [result, setResult] = useState<Candidate | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [cardSlots, setCardSlots] = useState<(Candidate | null)[]>([]);
  const [revealedCards, setRevealedCards] = useState<Record<number, Candidate>>({});
  const [revealingIndex, setRevealingIndex] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const drawTokenRef = useRef(0);
  const revealedCardsRef = useRef<Record<number, Candidate>>({});
  const revealingIndexRef = useRef<number | null>(null);
  const filterKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (authLoading || titlesLoading) return;
    if (!user || titles.length === 0) {
      queueMicrotask(() => { setPersonalTitles([]); setPersonalLoading(false); });
      return;
    }
    let alive = true;
    queueMicrotask(() => { if (alive) setPersonalLoading(true); });
    fetchJson<{ titles: EnrichedUserTitle[] }>("/api/user/titles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titles }),
    })
      .then(async (payload) => { const enriched = payload?.titles ?? []; return attachNextEpisodes(enriched, user.id); })
      .then((enriched) => { if (alive) setPersonalTitles(enriched); })
      .finally(() => { if (alive) setPersonalLoading(false); });
    return () => { alive = false; };
  }, [authLoading, titlesLoading, titles, user]);

  const personalCandidates = useMemo(
    () => personalTitles.map(toCandidate).filter((c): c is Candidate => c !== null),
    [personalTitles],
  );
  const personalKeys = useMemo(() => new Set(personalCandidates.map((c) => c.key)), [personalCandidates]);
  const filteredPersonalCandidates = useMemo(
    () => personalCandidates.filter((c) => candidateMatchesFilters(c, filters, mode)),
    [personalCandidates, filters, mode],
  );
  const filteredDiscoveryCandidates = useMemo(
    () => discoveryCandidates.filter((c) => candidateMatchesFilters(c, filters, "discovery")),
    [discoveryCandidates, filters],
  );
  const visibleCandidates = useMemo(
    () => filters.source === "all" ? [...filteredPersonalCandidates, ...filteredDiscoveryCandidates] : filteredPersonalCandidates,
    [filteredDiscoveryCandidates, filteredPersonalCandidates, filters.source],
  );

  const isLoading = personalLoading || discoveryLoading;
  const filterKey = `${filters.source}|${filters.content}|${filters.duration}|${filters.vibe}|${filters.availability}|${filters.allowWatched}`;

  useEffect(() => { revealedCardsRef.current = revealedCards; }, [revealedCards]);
  useEffect(() => { revealingIndexRef.current = revealingIndex; }, [revealingIndex]);

  const loadDiscovery = useCallback(async () => {
    setDiscoveryLoading(true);
    const items = await fetchDiscoveryCandidates(filters, personalKeys);
    setDiscoveryCandidates(items);
    setDiscoveryLoading(false);
    return items;
  }, [filters, personalKeys]);

  useEffect(() => { void Promise.resolve().then(() => loadDiscovery()); }, [loadDiscovery]);

  const shuffleFateCards = useCallback(() => {
    setCardSlots(buildFateCards(visibleCandidates, filters, lastKey));
    setRevealedCards({});
    revealedCardsRef.current = {};
    revealedCardsRef.current = {};
    setResult(null);
  }, [filters, lastKey, visibleCandidates]);

  useEffect(() => {
    queueMicrotask(() => {
      const filtersChanged = filterKeyRef.current !== filterKey;
      filterKeyRef.current = filterKey;
      const hasRevealedCards = Object.keys(revealedCardsRef.current).length > 0;
      if (!filtersChanged && (revealingIndexRef.current !== null || hasRevealedCards)) return;
      setCardSlots(buildFateCards(visibleCandidates, filters, null));
      if (filtersChanged) { setRevealedCards({}); revealedCardsRef.current = {}; }
      setResult(null);
    });
  }, [filterKey, filters, visibleCandidates]);

  const revealFateCard = useCallback(async (index: number) => {
    if (revealingIndex !== null || revealedCards[index]) return;
    const candidate = cardSlots[index];
    if (!candidate) return;
    revealingIndexRef.current = index;
    setRevealingIndex(index);
    const hydrated = await hydrateCandidate(candidate);
    setRevealedCards((current) => {
      const next = { ...current, [index]: hydrated };
      revealedCardsRef.current = next;
      return next;
    });
    setLastKey(hydrated.key);
    revealingIndexRef.current = null;
    setRevealingIndex(null);
  }, [cardSlots, revealedCards, revealingIndex]);

  function clearFateCard(index: number) {
    setRevealedCards((current) => {
      const next = { ...current };
      delete next[index];
      revealedCardsRef.current = next;
      return next;
    });
  }

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setResult(null);
  }

  const revealedCount = Object.keys(revealedCards).length;

  return (
    <>
      {/* Global keyframe animations */}
      <style>{`
        @keyframes cardReveal {
          from { opacity: 0; transform: rotateY(90deg) scale(0.85); }
          to   { opacity: 1; transform: rotateY(0deg)  scale(1);    }
        }
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>

      <main className="relative min-h-screen overflow-hidden text-white"
        style={{ background: "linear-gradient(160deg, #020611 0%, #050B1A 40%, #071426 100%)" }}>

        {/* Background atmosphere layers */}
        <div className="pointer-events-none absolute inset-0">
          {/* Deep space radials */}
          <div className="absolute inset-0" style={{
            background: [
              "radial-gradient(ellipse 70% 50% at 15% 10%, rgba(14,116,144,0.12) 0%, transparent 60%)",
              "radial-gradient(ellipse 50% 60% at 85% 5%,  rgba(124,58,237,0.10) 0%, transparent 55%)",
              "radial-gradient(ellipse 80% 40% at 50% 90%, rgba(7,20,38,0.9)     0%, transparent 70%)",
            ].join(",")
          }} />
          {/* Subtle noise grain */}
          <div className="absolute inset-0 opacity-[0.025]"
            style={{
              backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")",
              backgroundRepeat: "repeat",
              backgroundSize: "256px 256px",
            }}
          />
          {/* Top vignette */}
          <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-[#020611]/60 to-transparent" />
          {/* Bottom vignette */}
          <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-[#020611] to-transparent" />
        </div>

        <div className="relative z-10 mx-auto max-w-[1400px] px-3 py-6 sm:px-5 md:px-8 md:py-10 lg:px-12">

          {/* ── Header ───────────────────────────────────────────────────── */}
          <header className="flex flex-col gap-5 mb-8 md:mb-10">
            {/* Top row: kicker + shuffle (always side by side) */}
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#7C3AED]/30 bg-[#7C3AED]/10 px-3 py-1.5"
                style={{ animation: "fadeIn 0.6s ease both" }}>
                <Sparkles className="h-3 w-3 text-[#7C3AED]" />
                <span className="text-[9px] font-black uppercase tracking-[0.25em] md:tracking-[0.3em] text-[#7C3AED]/80">Oráculo · Sorteio</span>
              </div>

              {/* Shuffle — compact on mobile */}
              <button
                type="button"
                onClick={shuffleFateCards}
                style={{ animation: "fadeIn 0.7s ease 0.3s both" }}
                className="inline-flex items-center gap-2 rounded-full border border-[#19D5FF]/25 bg-[#19D5FF]/8 px-4 py-2 md:px-5 md:py-2.5 text-[11px] font-black text-[#19D5FF] transition-all duration-200 hover:bg-[#19D5FF]/15 active:scale-95 hover:shadow-[0_0_24px_rgba(25,213,255,0.15)]"
              >
                <Shuffle className="h-3.5 w-3.5 md:h-4 md:w-4" />
                <span className="hidden sm:inline">Nova mesa</span>
                <span className="sm:hidden">Embaralhar</span>
              </button>
            </div>

            {/* Title block */}
            <div style={{ animation: "fadeIn 0.7s ease 0.1s both" }}>
              <h1
                className="text-[2.6rem] leading-[0.88] tracking-[-0.03em] font-black text-white sm:text-5xl md:text-7xl lg:text-8xl"
                style={{ fontFamily: "'Sora', sans-serif" }}
              >
                Cartas do<br />
                <span style={{
                  background: "linear-gradient(135deg, #19D5FF 0%, #0EA5E9 50%, #6EEBFF 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}>Destino</span>
              </h1>

              <p className="mt-3 max-w-lg text-sm leading-6 text-slate-500"
                style={{ animation: "fadeIn 0.7s ease 0.2s both" }}>
                O POPLOG embaralha sua noite e revela um título que ainda não saiu da sua história.
              </p>

              {/* Status pills — inline below description on mobile */}
              <div className="flex flex-wrap items-center gap-2 mt-3" style={{ animation: "fadeIn 0.7s ease 0.3s both" }}>
                <div className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] px-3 py-1.5 md:px-4 md:py-2.5 backdrop-blur-sm">
                  <Clock className="h-3 w-3 md:h-3.5 md:w-3.5 text-[#19D5FF]/50" />
                  <span className="text-[10px] font-bold text-slate-400">{visibleCandidates.length} elegíveis</span>
                </div>
                {isLoading && (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-[#19D5FF]/15 bg-[#19D5FF]/5 px-3 py-1.5 md:px-4 md:py-2.5">
                    <RefreshCcw className="h-3 w-3 md:h-3.5 md:w-3.5 text-[#19D5FF]/60 animate-spin" />
                    <span className="text-[10px] font-bold text-[#19D5FF]/60">Preparando</span>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* ── Filters ──────────────────────────────────────────────────── */}
          <div className="mb-6 md:mb-10" style={{ animation: "fadeIn 0.7s ease 0.35s both" }}>
            <button
              type="button"
              onClick={() => setFiltersOpen((prev) => !prev)}
              className="flex w-full items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 md:px-5 md:py-3.5 backdrop-blur-sm transition-all duration-200 hover:bg-white/[0.04] active:scale-[0.99]"
            >
              <span className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.28em] md:tracking-[0.3em] text-slate-500">Filtros</span>
              <div className="flex items-center gap-2 md:gap-3">
                <span className="rounded-full border border-white/[0.07] px-2 md:px-2.5 py-1 text-[8px] md:text-[9px] font-bold text-slate-600">
                  <span className="hidden sm:inline">Vistos </span>{filters.allowWatched ? "liberados" : "bloqueados"}
                </span>
                <ChevronDown className={["h-4 w-4 text-slate-600 transition-transform duration-300", filtersOpen ? "rotate-180" : ""].join(" ")} />
              </div>
            </button>

            {filtersOpen && (
              <div className="mt-1 rounded-2xl border border-white/[0.05] bg-[#050B1A]/60 p-4 md:p-5 backdrop-blur-xl"
                style={{ animation: "slideDown 0.35s cubic-bezier(0.16,1,0.3,1) both" }}>
                <div className="grid gap-4 md:gap-5">
                  <FilterGroup label="Origem da lista" options={sourceOptions} value={filters.source} onChange={(v) => updateFilter("source", v)} />
                  <FilterGroup label="Tipo de conteúdo" options={contentOptions} value={filters.content} onChange={(v) => updateFilter("content", v)} />
                  <FilterGroup label="Duração" options={durationOptions} value={filters.duration} onChange={(v) => updateFilter("duration", v)} />
                  <FilterGroup label="Clima / vibe" options={vibeOptions} value={filters.vibe} onChange={(v) => updateFilter("vibe", v)} />
                  <FilterGroup label="Disponibilidade" options={availabilityOptions} value={filters.availability} onChange={(v) => updateFilter("availability", v)} />
                  <div>
                    <p className="mb-2.5 text-[9px] font-black uppercase tracking-[0.3em] text-[#19D5FF]/50">Já assistidos</p>
                    <button
                      type="button"
                      onPointerDown={(e) => { e.preventDefault(); updateFilter("allowWatched", !filters.allowWatched); }}
                      onClick={() => updateFilter("allowWatched", !filters.allowWatched)}
                      className={[
                        "rounded-full border px-3 py-2 md:py-1.5 text-[11px] font-bold transition-all duration-200 active:scale-95",
                        filters.allowWatched
                          ? "border-amber-300/25 bg-amber-300/10 text-amber-200"
                          : "border-emerald-300/20 bg-emerald-300/8 text-emerald-300/70",
                      ].join(" ")}
                    >
                      {filters.allowWatched ? "Permitir vistos" : "Bloquear vistos"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Divider with label ────────────────────────────────────────── */}
          <div className="flex items-center gap-3 md:gap-4 mb-6 md:mb-10" style={{ animation: "fadeIn 0.7s ease 0.4s both" }}>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-white/[0.06]" />
            <span className="text-[8px] md:text-[9px] font-black uppercase tracking-[0.3em] md:tracking-[0.35em] text-slate-600">Escolha uma carta</span>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-white/[0.06]" />
          </div>

          {/* ── Cards Stage ───────────────────────────────────────────────── */}
          <section style={{ animation: "fadeIn 0.8s ease 0.45s both" }}>
            <FateCardsStage
              candidates={visibleCandidates}
              cardSlots={cardSlots}
              revealedCards={revealedCards}
              revealingIndex={revealingIndex}
              onRevealCard={revealFateCard}
              onClearCard={clearFateCard}
            />
          </section>

          {/* ── Status bar ───────────────────────────────────────────────── */}
          <div className="mt-8 md:mt-10 flex flex-wrap items-center justify-center gap-2"
            style={{ animation: "fadeIn 0.7s ease 0.5s both" }}>
            <div className="h-px w-6 md:w-8 bg-white/[0.06]" />
            {revealedCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#19D5FF]/15 bg-[#19D5FF]/5 px-3 py-1.5 text-[10px] font-bold text-[#19D5FF]/60">
                <Eye className="h-3 w-3" /> {revealedCount} revelada{revealedCount > 1 ? "s" : ""}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-[10px] font-bold text-slate-600">
              <Clock className="h-3 w-3" />
              <span className="hidden sm:inline">{visibleCandidates.length} elegíveis</span>
              <span className="sm:hidden">{visibleCandidates.length}</span>
            </span>
            <span className={["hidden sm:inline rounded-full border px-3 py-1.5 text-[10px] font-bold",
              filters.allowWatched ? "border-amber-300/15 text-amber-400/50" : "border-emerald-300/15 text-emerald-400/50"
            ].join(" ")}>
              Vistos {filters.allowWatched ? "permitidos" : "bloqueados"}
            </span>
            <div className="h-px w-6 md:w-8 bg-white/[0.06]" />
          </div>

          {/* ── Login nudge ───────────────────────────────────────────────── */}
          {!user && !authLoading && (
            <div className="mt-8 rounded-2xl border border-amber-300/10 bg-amber-300/[0.04] p-5 text-sm leading-6 text-amber-200/50"
              style={{ animation: "fadeIn 0.7s ease 0.6s both" }}>
              Entre na sua conta para as Cartas do Destino usarem sua biblioteca real. Sem login, a página fica pronta visualmente, mas não há universo pessoal para sortear.
            </div>
          )}
        </div>
      </main>
    </>
  );
}