"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { resolveForRender as resolveCatalogImage } from "@/lib/images/proxy";
import { Reorder, useDragControls } from "framer-motion";
import { signOut as signOutAuthJs } from "next-auth/react";
import type { AuthUser } from "@/server/auth/types";
import { useAuth } from "@/hooks/useAuth";
import {
  GripVertical, X, Search, ChevronRight,
  LogOut, Mail, Lock, Check, Trash2,
  Film, Tv, BarChart2, ChevronDown, RotateCcw, AlertTriangle,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type Tab = "visao-geral" | "preferencias" | "nao-interesse" | "conta";

type LibraryStats = {
  watched:   number;
  watching:  number;
  watchlist: number;
  abandoned: number;
  favorites: number;
  movies:    number;
  series:    number;
  total:     number;
};

type GenreStat = { name: string; count: number; pct: number };

type StreamingProvider = {
  id:               string;
  provider_name:    string;
  provider_slug:    string;
  logo_url:         string | null;
  tmdb_provider_id: number | null;
  country:          string;
  is_active:        boolean;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

type NotInterestedTitle = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  originalTitle: string | null;
  year: string | null;
  source: string | null;
  updatedAt: string;
};

type GenreStatsResponse = { ok: boolean; genres: GenreStat[] };
type StreamingPreferencesResponse = {
  ok:          boolean;
  providers:   StreamingProvider[];
  preferences: Array<{ provider_id: string; is_enabled: boolean; priority_order: number }>;
};
type NotInterestedResponse = {
  ok: boolean;
  items: NotInterestedTitle[];
};
type LibraryItemForStats = {
  status: string | null;
  media_type: "movie" | "tv";
  favorite?: boolean | null;
};
type LibraryResponseForStats = {
  success: boolean;
  data: LibraryItemForStats[];
};

const PROFILE_CLIENT_CACHE_TTL_MS = 5 * 60_000;
let genreStatsCache:
  | { promise: Promise<GenreStatsResponse>; expiresAt: number }
  | null = null;
let streamingPreferencesCache:
  | { promise: Promise<StreamingPreferencesResponse>; expiresAt: number }
  | null = null;

function fetchGenreStatsOnce() {
  if (genreStatsCache && genreStatsCache.expiresAt > Date.now()) {
    return genreStatsCache.promise;
  }

  const promise = fetch("/api/user/genre-stats").then((res) => {
    if (!res.ok) throw new Error("genre stats failed");
    return res.json() as Promise<GenreStatsResponse>;
  });
  genreStatsCache = { promise, expiresAt: Date.now() + PROFILE_CLIENT_CACHE_TTL_MS };
  return promise;
}

function fetchStreamingPreferencesOnce() {
  if (streamingPreferencesCache && streamingPreferencesCache.expiresAt > Date.now()) {
    return streamingPreferencesCache.promise;
  }

  const promise = fetch("/api/user/streaming-preferences").then((res) => {
    if (!res.ok) throw new Error("streaming preferences failed");
    return res.json() as Promise<StreamingPreferencesResponse>;
  });
  streamingPreferencesCache = { promise, expiresAt: Date.now() + PROFILE_CLIENT_CACHE_TTL_MS };
  return promise;
}

function fetchNotInterestedTitles() {
  return fetch("/api/user/not-interested").then((res) => {
    if (!res.ok) throw new Error("not interested failed");
    return res.json() as Promise<NotInterestedResponse>;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER BRAND MAP
// ─────────────────────────────────────────────────────────────────────────────

type ProviderCategory = "principais" | "gratuitos" | "canais" | "aluguel" | "outros";
type ProviderType     = "subscription" | "ads" | "channel" | "free" | "rental";

type ProviderMeta = {
  brand:         string;
  variantLabel?: string;
  type:          ProviderType;
  category:      ProviderCategory;
  bg:            string;
  textColor?:    string;
  short:         string;
};

const PROVIDER_BRAND_MAP: Record<string, ProviderMeta> = {
  "netflix":                         { brand: "Netflix",         type: "subscription", category: "principais", bg: "#E50914", short: "N" },
  "netflix standard with ads":       { brand: "Netflix",         variantLabel: "Com anúncios",       type: "ads",     category: "principais", bg: "#E50914", short: "N"  },
  "netflix basic with ads":          { brand: "Netflix",         variantLabel: "Com anúncios",       type: "ads",     category: "principais", bg: "#E50914", short: "N"  },
  "max":                             { brand: "Max",             type: "subscription", category: "principais", bg: "#002BE7", short: "M"  },
  "hbo max":                         { brand: "Max",             type: "subscription", category: "principais", bg: "#002BE7", short: "M"  },
  "max amazon channel":              { brand: "Max",             variantLabel: "Canal Prime Video",  type: "channel", category: "canais",    bg: "#002BE7", short: "M"  },
  "max apple tv channel":            { brand: "Max",             variantLabel: "Canal Apple TV",     type: "channel", category: "canais",    bg: "#002BE7", short: "M"  },
  "amazon prime video":              { brand: "Prime Video",     type: "subscription", category: "principais", bg: "#00A8E1", short: "P"  },
  "prime video":                     { brand: "Prime Video",     type: "subscription", category: "principais", bg: "#00A8E1", short: "P"  },
  "amazon prime video with ads":     { brand: "Prime Video",     variantLabel: "Com anúncios",       type: "ads",     category: "principais", bg: "#00A8E1", short: "P"  },
  "amazon video":                    { brand: "Prime Video",     variantLabel: "Aluguel/compra",     type: "rental",  category: "aluguel",   bg: "#00A8E1", short: "P"  },
  "disney plus":                     { brand: "Disney+",         type: "subscription", category: "principais", bg: "#113CCF", short: "D+" },
  "disney+":                         { brand: "Disney+",         type: "subscription", category: "principais", bg: "#113CCF", short: "D+" },
  "star plus":                       { brand: "Star+",           type: "subscription", category: "principais", bg: "#0A2A6E", short: "S+" },
  "apple tv plus":                   { brand: "Apple TV+",       type: "subscription", category: "principais", bg: "#1C1C1E", short: "▶" },
  "apple tv+":                       { brand: "Apple TV+",       type: "subscription", category: "principais", bg: "#1C1C1E", short: "▶" },
  "apple tv":                        { brand: "Apple TV+",       type: "subscription", category: "principais", bg: "#1C1C1E", short: "▶" },
  "apple tv store":                  { brand: "Apple TV+",       variantLabel: "Aluguel/compra",     type: "rental",  category: "aluguel",   bg: "#1C1C1E", short: "▶" },
  "apple tv channels":               { brand: "Apple TV+",       variantLabel: "Canais",             type: "channel", category: "canais",    bg: "#1C1C1E", short: "▶" },
  "globoplay":                       { brand: "Globoplay",       type: "subscription", category: "principais", bg: "#D50032", short: "G"  },
  "globoplay amazon channel":        { brand: "Globoplay",       variantLabel: "Canal Prime Video",  type: "channel", category: "canais",    bg: "#D50032", short: "G"  },
  "paramount plus":                  { brand: "Paramount+",      type: "subscription", category: "principais", bg: "#0064FF", short: "P+" },
  "paramount+":                      { brand: "Paramount+",      type: "subscription", category: "principais", bg: "#0064FF", short: "P+" },
  "paramount plus apple tv channel": { brand: "Paramount+",      variantLabel: "Canal Apple TV",     type: "channel", category: "canais",    bg: "#0064FF", short: "P+" },
  "paramount+ amazon channel":       { brand: "Paramount+",      variantLabel: "Canal Prime Video",  type: "channel", category: "canais",    bg: "#0064FF", short: "P+" },
  "mubi":                            { brand: "MUBI",            type: "subscription", category: "principais", bg: "#2C2C2C", short: "MB" },
  "mubi amazon channel":             { brand: "MUBI",            variantLabel: "Canal Prime Video",  type: "channel", category: "canais",    bg: "#2C2C2C", short: "MB" },
  "pluto tv":                        { brand: "Pluto TV",        type: "free",         category: "gratuitos",  bg: "#1F1D36", short: "PT" },
  "mercado play":                    { brand: "Mercado Play",    type: "free",         category: "gratuitos",  bg: "#FFE600", textColor: "#000", short: "MP" },
  "plex":                            { brand: "Plex",            type: "free",         category: "gratuitos",  bg: "#E5A00D", textColor: "#000", short: "PX" },
  "netmovies":                       { brand: "NetMovies",       type: "free",         category: "gratuitos",  bg: "#2D2D2D", short: "NM" },
  "claro video":                     { brand: "Claro Video",     type: "subscription", category: "outros",     bg: "#CC0000", short: "CV" },
  "telecine play":                   { brand: "Telecine",        type: "channel",      category: "canais",     bg: "#003087", short: "TC" },
  "mgm plus":                        { brand: "MGM+",            type: "channel",      category: "canais",     bg: "#C4A020", textColor: "#000", short: "MG" },
  "universal plus":                  { brand: "Universal+",      type: "channel",      category: "canais",     bg: "#2A2A2A", short: "U+" },
  "google play movies":              { brand: "Google Play",     variantLabel: "Aluguel/compra",     type: "rental",  category: "aluguel",   bg: "#34A853", short: "GP" },
  "youtube premium":                 { brand: "YouTube Premium", type: "subscription", category: "outros",     bg: "#FF0000", short: "YT" },
  "crunchyroll":                      { brand: "Crunchyroll",     type: "subscription", category: "principais", bg: "#F47521", short: "CR" },
  "wow":                              { brand: "WOW",             type: "subscription", category: "principais", bg: "#00C2FF", short: "W"  },
  "wow presents plus":               { brand: "WOW",             variantLabel: "Presents Plus",          type: "subscription", category: "principais", bg: "#00C2FF", short: "W"  },
};

function getProviderMeta(name: string | null | undefined): ProviderMeta {
  const key = (name ?? "").trim().toLowerCase();
  if (PROVIDER_BRAND_MAP[key]) return PROVIDER_BRAND_MAP[key];

  // Auto-detect Amazon Channel variants not explicitly mapped
  if (key.includes(" amazon channel")) {
    const rawBrand = key.replace(" amazon channel", "").trim();
    const base = PROVIDER_BRAND_MAP[rawBrand];
    return {
      brand:        base?.brand ?? toTitleCase(rawBrand),
      variantLabel: "Canal Prime Video",
      type:         "channel",
      category:     "canais",
      bg:           base?.bg ?? "#2A2A2A",
      textColor:    base?.textColor,
      short:        base?.short ?? rawBrand.slice(0, 2).toUpperCase(),
    };
  }

  // Auto-detect Apple TV Channel variants
  if (key.includes(" apple tv channel")) {
    const rawBrand = key.replace(" apple tv channel", "").trim();
    const base = PROVIDER_BRAND_MAP[rawBrand];
    return {
      brand:        base?.brand ?? toTitleCase(rawBrand),
      variantLabel: "Canal Apple TV",
      type:         "channel",
      category:     "canais",
      bg:           base?.bg ?? "#1C1C1E",
      textColor:    base?.textColor,
      short:        base?.short ?? rawBrand.slice(0, 2).toUpperCase(),
    };
  }

  // Generic "channel" keyword
  if (key.includes(" channel")) {
    return {
      brand:    toTitleCase(key.replace(/ channel.*/, "").trim()) ?? name ?? "Canal",
      type:     "channel",
      category: "canais",
      bg:       "#2A2A2A",
      short:    (name ?? "?").slice(0, 2).toUpperCase(),
    };
  }

  return {
    brand:    name ?? "Desconhecido",
    type:     "subscription",
    category: "outros",
    bg:       "#444444",
    short:    (name ?? "?").slice(0, 2).toUpperCase(),
  };
}

function toTitleCase(str: string): string {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

function getLogoUrl(logoUrl: string | null | undefined): string | null {
  return resolveCatalogImage(logoUrl, "w200");
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function getInitials(user: AuthUser): string {
  const name = user.user_metadata?.full_name ?? user.user_metadata?.name;
  if (typeof name === "string") return name.split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase();
  return (user.email?.[0] ?? "U").toUpperCase();
}

function getDisplayName(user: AuthUser): string {
  return (
    (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null) ??
    (typeof user.user_metadata?.name === "string" ? user.user_metadata.name : null) ??
    user.name ??
    user.email?.split("@")[0] ??
    "Usuário"
  );
}

function formatJoinDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function estimateHours(stats: LibraryStats): number {
  return Math.round((stats.movies * 105 + stats.series * 45 * 8) / 60);
}

function avatarGradient(email: string): string {
  const opts = [
    "from-violet-600 to-indigo-600",
    "from-rose-600 to-pink-600",
    "from-cyan-600 to-teal-600",
    "from-amber-600 to-orange-600",
    "from-emerald-600 to-teal-600",
  ];
  return opts[email.charCodeAt(0) % opts.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

type EyebrowColor = "indigo" | "violet" | "teal" | "amber" | "muted" | "rose";

function Eyebrow({ children, color = "indigo" }: { children: React.ReactNode; color?: EyebrowColor }) {
  const map: Record<EyebrowColor, [string, string]> = {
    indigo: ["bg-indigo-400/60",  "text-indigo-400/80"],
    violet: ["bg-violet-400/60",  "text-violet-400/80"],
    teal:   ["bg-teal-400/60",    "text-teal-400/80"],
    amber:  ["bg-amber-400/60",   "text-amber-400/80"],
    muted:  ["bg-white/20",       "text-white/30"],
    rose:   ["bg-rose-400/60",    "text-rose-400/80"],
  };
  const [line, text] = map[color];
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className={`block h-px w-5 rounded-full ${line}`} />
      <p className={`text-[9.5px] font-bold uppercase tracking-[0.22em] ${text}`}>{children}</p>
    </div>
  );
}

function BlockTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[18px] font-black tracking-[-0.03em] text-white/90 leading-tight mb-5">{children}</h2>;
}

function Block({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[22px] border border-white/[0.06] bg-white/[0.025] p-5 sm:p-6 ${className}`}>
      {children}
    </div>
  );
}

function StatPill({ value, label, accent = false }: { value: string | number; label: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border px-4 py-3.5 ${accent ? "bg-violet-950/35 border-violet-500/20" : "bg-white/[0.025] border-white/[0.06]"}`}>
      <p className={`text-[22px] font-black tracking-tight leading-none mb-1 ${accent ? "text-violet-200" : "text-white/80"}`}>{value}</p>
      <p className="text-[11px] text-white/35 leading-snug">{label}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE HEADER
// ─────────────────────────────────────────────────────────────────────────────

function ProfileHeader({
  user, stats, onSignOut,
}: {
  user: AuthUser; stats: LibraryStats; onSignOut: () => void;
}) {
  const initials = getInitials(user);
  const name     = getDisplayName(user);
  const gradBg   = avatarGradient(user.email ?? "u");
  const joinDate = formatJoinDate(user.created_at ?? new Date().toISOString());
  const hours    = estimateHours(stats);

  return (
    <div className="relative isolate rounded-[24px] overflow-hidden border border-white/[0.07] mb-6">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-indigo-950/60 via-zinc-950 to-black" />
      <div
        className="absolute inset-0 -z-10"
        style={{ background: "radial-gradient(ellipse at 20% 0%,rgba(139,92,246,.15) 0%,transparent 55%),radial-gradient(ellipse at 80% 100%,rgba(6,182,212,.09) 0%,transparent 45%)" }}
      />

      <div className="px-5 sm:px-7 pt-6 pb-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">

          {/* Avatar */}
          <div
            className={`w-[72px] h-[72px] sm:w-20 sm:h-20 rounded-[20px] bg-gradient-to-br ${gradBg} flex items-center justify-center border-2 border-white/[0.12] shadow-xl flex-shrink-0`}
          >
            {typeof user.user_metadata?.avatar_url === "string" ? (
              <img src={user.user_metadata.avatar_url} alt={name} className="w-full h-full rounded-[18px] object-cover" />
            ) : (
              <span className="text-xl sm:text-2xl font-black text-white/90 tracking-tight">{initials}</span>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h1 className="text-[22px] sm:text-[26px] font-black tracking-[-0.04em] text-white/93 leading-tight">{name}</h1>
            <p className="text-[11px] text-white/30 mt-0.5">Membro desde {joinDate}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2.5 text-[12px] text-white/45">
              <span><span className="font-bold text-white/70">{stats.total}</span> títulos</span>
              <span className="text-white/15">·</span>
              <span><span className="font-bold text-white/70">{hours > 0 ? `${hours.toLocaleString("pt-BR")}h` : "—"}</span> estimadas</span>
              <span className="text-white/15">·</span>
              <span><span className="font-bold text-violet-300/80">{stats.favorites}</span> favoritos</span>
            </div>
          </div>

          {/* Desktop stat pills */}
          <div className="hidden lg:flex items-center gap-3 flex-shrink-0">
            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] px-4 py-3 text-center min-w-[72px]">
              <p className="text-[20px] font-black text-white/80 tracking-tight leading-none">{stats.watched}</p>
              <p className="text-[10px] text-white/30 mt-1">assistidos</p>
            </div>
            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] px-4 py-3 text-center min-w-[72px]">
              <p className="text-[20px] font-black text-cyan-300/80 tracking-tight leading-none">{stats.watching}</p>
              <p className="text-[10px] text-white/30 mt-1">assistindo</p>
            </div>
            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] px-4 py-3 text-center min-w-[72px]">
              <p className="text-[20px] font-black text-violet-300/80 tracking-tight leading-none">{stats.watchlist}</p>
              <p className="text-[10px] text-white/30 mt-1">watchlist</p>
            </div>
          </div>

          {/* Sign out — low visual weight */}
          <button
            type="button"
            onClick={onSignOut}
            className="flex items-center gap-1.5 text-[11px] text-white/22 hover:text-white/45 transition-colors px-2 py-1.5 flex-shrink-0 self-start sm:self-center"
          >
            <LogOut size={13} />
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB BAR
// ─────────────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: "visao-geral",  label: "Visão geral" },
  { id: "preferencias", label: "Preferências" },
  { id: "nao-interesse", label: "Não tenho interesse" },
  { id: "conta",        label: "Conta" },
];

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="flex border-b border-white/[0.07] mb-7 overflow-x-auto no-scrollbar">
      {TABS.map(tab => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={[
            "relative flex-shrink-0 px-5 py-3.5 text-[12px] font-bold uppercase tracking-[0.12em] transition-colors duration-200 border-b-2 -mb-px",
            active === tab.id
              ? "border-indigo-500 text-white"
              : "border-transparent text-white/35 hover:text-white/60",
          ].join(" ")}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: VISÃO GERAL
// ─────────────────────────────────────────────────────────────────────────────

function ProgressBar({ pct, colorClass }: { pct: number; colorClass: string }) {
  return (
    <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
      <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${pct}%`, transition: "width 1.1s ease" }} />
    </div>
  );
}

function TabOverview({ stats, genres }: { stats: LibraryStats; genres: GenreStat[] }) {
  const hours      = estimateHours(stats);
  const watchedPct = stats.total > 0 ? Math.round((stats.watched / stats.total) * 100) : 0;
  const moviesPct  = stats.total > 0 ? Math.round((stats.movies  / stats.total) * 100) : 50;
  const seriesPct  = 100 - moviesPct;

  return (
    <div className="space-y-4">

      {/* Topo: resumo + biblioteca lado a lado no desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

        {/* Resumo geral */}
        <Block>
          <Eyebrow color="violet">Sua jornada · POPLOG</Eyebrow>
          <BlockTitle>Resumo geral</BlockTitle>

          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="text-center">
              <p className="text-3xl font-black text-white/85 tracking-tight leading-none">{stats.total}</p>
              <p className="text-[11px] text-white/30 mt-1">títulos</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-black text-white/85 tracking-tight leading-none">
                {hours > 0 ? hours.toLocaleString("pt-BR") : "—"}
              </p>
              <p className="text-[11px] text-white/30 mt-1">horas est.</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-black text-cyan-300/80 tracking-tight leading-none">{watchedPct}%</p>
              <p className="text-[11px] text-white/30 mt-1">concluídos</p>
            </div>
          </div>

          <div className="h-px bg-white/[0.05] mb-5" />
          <div className="mb-1.5 flex justify-between">
            <span className="text-[11px] text-white/40">Progresso geral</span>
            <span className="text-[11px] text-white/25">{stats.watched}/{stats.total}</span>
          </div>
          <ProgressBar pct={watchedPct} colorClass="bg-gradient-to-r from-indigo-500 to-cyan-400" />
        </Block>

        {/* Biblioteca + Consumo empilhados na coluna direita */}
        <div className="space-y-4">
          {/* Biblioteca em números */}
          <div className="grid grid-cols-2 gap-2.5">
            <StatPill value={stats.watched}   label="Assistidos"  accent />
            <StatPill value={stats.watching}  label="Assistindo"  />
            <StatPill value={stats.watchlist} label="Watchlist"   />
            <StatPill value={stats.favorites} label="Favoritos"   />
          </div>

          {/* Perfil de consumo */}
          <Block>
            <Eyebrow color="teal">Perfil de consumo</Eyebrow>
            <BlockTitle>Filmes vs Séries</BlockTitle>

            <div className="space-y-3.5">
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <Film size={13} className="text-cyan-400/70" />
                    <span className="text-[11px] text-cyan-400/80 font-bold">Filmes</span>
                  </div>
                  <span className="text-[11px] text-white/30">{stats.movies} · {moviesPct}%</span>
                </div>
                <ProgressBar pct={moviesPct} colorClass="bg-gradient-to-r from-cyan-500 to-cyan-400" />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <Tv size={13} className="text-indigo-400/70" />
                    <span className="text-[11px] text-indigo-400/80 font-bold">Séries</span>
                  </div>
                  <span className="text-[11px] text-white/30">{stats.series} · {seriesPct}%</span>
                </div>
                <ProgressBar pct={seriesPct} colorClass="bg-gradient-to-r from-indigo-500 to-violet-400" />
              </div>
            </div>
          </Block>
        </div>
      </div>

      {/* Gêneros favoritos — largura total */}
      <Block>
        <Eyebrow color="indigo">Gêneros favoritos</Eyebrow>
        <BlockTitle>O que você mais assiste</BlockTitle>

        {genres.length > 0 ? (
          <div className="space-y-3">
            {genres.slice(0, 6).map((g, i) => {
              const colorClasses = [
                "bg-indigo-500 opacity-75",
                "bg-violet-500 opacity-75",
                "bg-cyan-500 opacity-75",
                "bg-rose-500 opacity-75",
                "bg-amber-500 opacity-75",
                "bg-teal-500 opacity-75",
              ];
              return (
                <div key={g.name}>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-[12px] font-bold text-white/60">{g.name}</span>
                    <span className="text-[11px] text-white/25">{g.pct}%</span>
                  </div>
                  <ProgressBar pct={g.pct} colorClass={colorClasses[i % colorClasses.length]} />
                </div>
              );
            })}
            <p className="text-[10px] text-white/20 mt-3 italic">
              * Calculado a partir dos títulos da sua biblioteca.
            </p>
          </div>
        ) : (
          <div className="text-center py-6">
            <BarChart2 size={28} className="text-white/15 mx-auto mb-3" />
            <p className="text-[12px] text-white/30">Nenhum dado de gênero disponível ainda.</p>
            <p className="text-[11px] text-white/20 mt-1">
              Adicione títulos à sua biblioteca para ver seus gêneros favoritos.
            </p>
          </div>
        )}
      </Block>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVE STREAMING ITEM (draggable)
// ─────────────────────────────────────────────────────────────────────────────

function ActiveStreamingItem({
  provider, priority, onRemove, isSaving,
}: {
  provider: StreamingProvider;
  priority: number;
  onRemove: () => void;
  isSaving: boolean;
}) {
  const controls = useDragControls();
  const meta     = getProviderMeta(provider.provider_name);
  const logo     = getLogoUrl(provider.logo_url);

  const typeBadge = (() => {
    if (meta.type === "free")    return { label: "Grátis",     cls: "border-teal-500/25 bg-teal-950/30 text-teal-400/70"     };
    if (meta.type === "rental")  return { label: "Aluguel",    cls: "border-amber-500/25 bg-amber-950/30 text-amber-400/70"   };
    if (meta.type === "ads")     return { label: "Anúncios",   cls: "border-orange-500/25 bg-orange-950/30 text-orange-400/70" };
    if (meta.type === "channel") return { label: "Canal",      cls: "border-violet-500/25 bg-violet-950/30 text-violet-400/70" };
    return                              { label: "Assinatura", cls: "border-white/[0.07] bg-white/[0.04] text-white/25"       };
  })();

  return (
    <Reorder.Item
      value={provider.id}
      dragListener={false}
      dragControls={controls}
      className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-3 touch-none select-none"
      whileDrag={{ scale: 1.02, boxShadow: "0 12px 40px rgba(0,0,0,0.45)", zIndex: 50 }}
    >
      {/* Drag handle */}
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing text-white/20 hover:text-white/50 transition-colors flex-shrink-0"
        onPointerDown={e => controls.start(e)}
        aria-label="Arrastar para reordenar"
      >
        <GripVertical size={16} />
      </button>

      {/* Priority */}
      <span className="w-5 h-5 rounded-full bg-white/[0.06] border border-white/[0.08] text-[9px] font-black text-white/40 flex items-center justify-center flex-shrink-0 tabular-nums">
        {priority}
      </span>

      {/* Logo */}
      {logo ? (
        <img src={logo} alt={meta.brand} className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
      ) : (
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-black"
          style={{ background: meta.bg, color: meta.textColor ?? "#fff" }}
        >
          {meta.short}
        </div>
      )}

      {/* Name + variant */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold text-white/80 leading-tight truncate">{meta.brand}</p>
        {meta.variantLabel && (
          <p className="text-[10px] text-white/30 mt-0.5">{meta.variantLabel}</p>
        )}
      </div>

      {/* Type badge */}
      <span
        className={[
          "text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border flex-shrink-0",
          typeBadge.cls,
        ].join(" ")}
      >
        {typeBadge.label}
      </span>

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        disabled={isSaving}
        className="w-7 h-7 rounded-full border border-white/[0.07] bg-white/[0.03] hover:bg-rose-500/15 hover:border-rose-500/25 flex items-center justify-center text-white/25 hover:text-rose-400 transition-all flex-shrink-0"
        aria-label={`Remover ${meta.brand}`}
      >
        <X size={12} />
      </button>
    </Reorder.Item>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BRAND GROUPS FOR ADD STREAMING
// ─────────────────────────────────────────────────────────────────────────────

type BrandGroup = {
  brand:     string;
  bg:        string;
  textColor: string;
  short:     string;
  logoUrl:   string | null;
  category:  ProviderCategory;
  providers: StreamingProvider[];
};

function buildBrandGroups(providers: StreamingProvider[]): BrandGroup[] {
  const map = new Map<string, BrandGroup>();
  for (const p of providers) {
    const meta = getProviderMeta(p.provider_name);
    if (!map.has(meta.brand)) {
      map.set(meta.brand, {
        brand:     meta.brand,
        bg:        meta.bg,
        textColor: meta.textColor ?? "#fff",
        short:     meta.short,
        logoUrl:   getLogoUrl(p.logo_url),
        category:  meta.category,
        providers: [],
      });
    }
    map.get(meta.brand)!.providers.push(p);
  }
  return Array.from(map.values());
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD STREAMING BLOCK
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<ProviderCategory, string> = {
  principais: "Principais",
  gratuitos:  "Gratuitos",
  canais:     "Canais",
  aluguel:    "Aluguel",
  outros:     "Outros",
};

function AddStreamingBlock({
  allProviders,
  activeIds,
  onAdd,
  desktopMode = false,
}: {
  allProviders:  StreamingProvider[];
  activeIds:     string[];
  onAdd:         (id: string) => void;
  desktopMode?:  boolean;
}) {
  const [search,       setSearch]       = useState("");
  const [activeFilter, setActiveFilter] = useState<ProviderCategory | "todos">("todos");
  const [expandedBrand, setExpandedBrand] = useState<string | null>(null);

  // Hide the entire brand once any variant of it is already active
  const activeBrands = new Set(
    activeIds
      .map(id => allProviders.find(p => p.id === id))
      .filter((p): p is StreamingProvider => !!p)
      .map(p => getProviderMeta(p.provider_name).brand)
  );
  const available = allProviders.filter(p => {
    if (activeIds.includes(p.id)) return false;
    return !activeBrands.has(getProviderMeta(p.provider_name).brand);
  });
  const groups = buildBrandGroups(available);

  const filtered = groups.filter(g => {
    if (activeFilter !== "todos" && g.category !== activeFilter) return false;
    if (search && !g.brand.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const categories: Array<ProviderCategory | "todos"> = ["todos", "principais", "gratuitos", "canais", "aluguel", "outros"];

  function handleBrandClick(group: BrandGroup) {
    if (group.providers.length === 1) {
      onAdd(group.providers[0].id);
      setExpandedBrand(null);
    } else {
      setExpandedBrand(prev => prev === group.brand ? null : group.brand);
    }
  }

  return (
    <div className={desktopMode ? "flex flex-col h-full" : "mt-6 pt-6 border-t border-white/[0.06]"}>
      {!desktopMode && <Eyebrow color="muted">Adicionar streaming</Eyebrow>}
      <p className="text-[12px] text-white/30 mb-4 flex-shrink-0">Selecione os serviços que você assina.</p>

      {/* Search */}
      <div className="relative mb-3 flex-shrink-0">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25 pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar streaming..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-white/[0.04] border border-white/[0.07] rounded-xl pl-8 pr-3 py-2.5 text-[12px] text-white/70 placeholder:text-white/20 outline-none focus:border-indigo-500/40 focus:bg-white/[0.06] transition-all"
        />
      </div>

      {/* Category chips */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 mb-3 flex-shrink-0">
        {categories.map(cat => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveFilter(cat)}
            className={[
              "flex-shrink-0 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wide transition-all",
              activeFilter === cat
                ? "bg-indigo-600/30 border border-indigo-500/40 text-indigo-300"
                : "bg-white/[0.04] border border-white/[0.06] text-white/30 hover:bg-white/[0.07] hover:text-white/50",
            ].join(" ")}
          >
            {cat === "todos" ? "Todos" : CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Brand grid — scrollable area */}
      <div className={desktopMode ? "relative flex-1 min-h-0" : ""}>
        <div className={desktopMode ? "absolute inset-0 overflow-y-auto thin-scrollbar pr-1" : "overflow-y-auto no-scrollbar max-h-[420px] pr-0.5"}>
        {filtered.length === 0 ? (
          <p className="text-[12px] text-white/25 text-center py-6">
            {search ? "Nenhum resultado para esta busca." : "Todos os streamings desta categoria ja foram adicionados."}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-1.5">
            {filtered.map(group => {
              const isExpanded = expandedBrand === group.brand;
              const brandLogo  = group.logoUrl;
              return (
                <div key={group.brand}>
                  <button
                    type="button"
                    onClick={() => handleBrandClick(group)}
                    className="w-full flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] hover:bg-white/[0.05] hover:border-indigo-500/25 transition-all px-3 py-2.5 text-left"
                  >
                    {brandLogo ? (
                      <img
                        src={brandLogo}
                        alt={group.brand}
                        className="w-9 h-9 rounded-xl object-cover flex-shrink-0"
                        style={{ background: group.bg }}
                      />
                    ) : (
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-black flex-shrink-0"
                        style={{ background: group.bg, color: group.textColor }}
                      >
                        {group.short}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-white/80 truncate">{group.brand}</p>
                      {group.providers.length > 1 && (
                        <p className="text-[10px] text-white/30">{group.providers.length} opcoes</p>
                      )}
                    </div>
                    {group.providers.length > 1 && (
                      isExpanded
                        ? <ChevronDown size={14} className="text-white/30 flex-shrink-0" />
                        : <ChevronRight size={14} className="text-white/30 flex-shrink-0" />
                    )}
                  </button>

                  {/* Variant picker */}
                  {isExpanded && (
                    <div className="mt-1 ml-3 space-y-1">
                      {group.providers.map(p => {
                        const pMeta   = getProviderMeta(p.provider_name);
                        const pLogo   = getLogoUrl(p.logo_url);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => { onAdd(p.id); setExpandedBrand(null); }}
                            className="w-full flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06] hover:border-indigo-500/25 transition-all px-3 py-2 text-left"
                          >
                            {pLogo ? (
                              <img
                                src={pLogo}
                                alt={pMeta.brand}
                                className="w-6 h-6 rounded-lg object-cover flex-shrink-0"
                                style={{ background: pMeta.bg }}
                              />
                            ) : (
                              <div
                                className="w-6 h-6 rounded-lg flex items-center justify-center text-[9px] font-black flex-shrink-0"
                                style={{ background: pMeta.bg, color: pMeta.textColor ?? "#fff" }}
                              >
                                {pMeta.short}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-semibold text-white/70 truncate">
                                {pMeta.variantLabel ?? pMeta.brand}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SAVE STATUS BADGE
// ─────────────────────────────────────────────────────────────────────────────

function SaveStatusBadge({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  const map: Record<Exclude<SaveStatus, "idle">, { label: string; cls: string }> = {
    saving: { label: "Salvando...",    cls: "bg-white/[0.05] border-white/[0.08] text-white/30"       },
    saved:  { label: "✓ Salvo",        cls: "bg-teal-950/40 border-teal-500/25 text-teal-400/80"      },
    error:  { label: "Erro ao salvar", cls: "bg-rose-950/40 border-rose-500/25 text-rose-400/80"      },
  };
  const { label, cls } = map[status as Exclude<SaveStatus, "idle">];
  return (
    <span
      className={[
        "text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded-full border",
        cls,
      ].join(" ")}
    >
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: PREFERÊNCIAS
// ─────────────────────────────────────────────────────────────────────────────

function TabPreferences({
  allProviders,
  initialActiveIds,
}: {
  allProviders:     StreamingProvider[];
  initialActiveIds: string[];
}) {
  const [activeIds,  setActiveIds]  = useState<string[]>(initialActiveIds);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSaving = saveStatus === "saving";

  const doSave = useCallback(async (ids: string[]) => {
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/user/streaming-preferences", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ providerIds: ids, country: "BR" }),
      });
      if (!res.ok) throw new Error("save failed");
      streamingPreferencesCache = null;
      if (savedTimer.current) clearTimeout(savedTimer.current);
      setSaveStatus("saved");
      savedTimer.current = setTimeout(() => setSaveStatus("idle"), 2500);
    } catch {
      setSaveStatus("error");
    }
  }, []);

  function scheduleProviderSave(ids: string[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    saveTimer.current = setTimeout(() => { void doSave(ids); }, 700);
  }

  function handleReorder(newOrder: string[]) {
    setActiveIds(newOrder);
    scheduleProviderSave(newOrder);
  }

  function handleAdd(id: string) {
    const next = [...activeIds, id];
    setActiveIds(next);
    scheduleProviderSave(next);
  }

  function handleRemove(id: string) {
    const next = activeIds.filter(x => x !== id);
    setActiveIds(next);
    scheduleProviderSave(next);
  }

  const activeProviders = activeIds
    .map(id => allProviders.find(p => p.id === id))
    .filter((p): p is StreamingProvider => !!p);

  return (
    <div className="space-y-4">

      {/* Streaming: 2 cols desktop — direita fixa/sticky, esquerda com scroll */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 lg:items-start">

        {/* Esquerda — lista ativa, scroll interno no desktop */}
        <Block className="flex flex-col">
          <div className="flex items-center justify-between mb-1.5">
            <Eyebrow color="indigo">Streaming</Eyebrow>
            <SaveStatusBadge status={saveStatus} />
          </div>
          <BlockTitle>Seus streamings</BlockTitle>

          {activeProviders.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-[13px] text-white/30">Nenhum streaming adicionado ainda.</p>
              <p className="text-[11px] text-white/20 mt-1">Adicione ao lado para personalizar sua experiência.</p>
            </div>
          ) : (
            <Reorder.Group
              axis="y"
              values={activeIds}
              onReorder={handleReorder}
              className="space-y-2"
            >
              {activeProviders.map((p, idx) => (
                <ActiveStreamingItem
                  key={p.id}
                  provider={p}
                  priority={idx + 1}
                  isSaving={isSaving}
                  onRemove={() => handleRemove(p.id)}
                />
              ))}
            </Reorder.Group>
          )}

          {/* Mobile: adicionar inline */}
          <div className="lg:hidden">
            <AddStreamingBlock
              allProviders={allProviders}
              activeIds={activeIds}
              onAdd={handleAdd}
            />
          </div>
        </Block>

        {/* Direita — sticky, altura igual à viewport menos o header */}
        <div className="hidden lg:flex lg:flex-col lg:sticky lg:top-6" style={{ height: "calc(100vh - 6rem)" }}>
          <Block className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex-shrink-0">
              <Eyebrow color="muted">Adicionar streaming</Eyebrow>
              <BlockTitle>Serviços disponíveis</BlockTitle>
            </div>
            <div className="flex-1 min-h-0">
              <AddStreamingBlock
                allProviders={allProviders}
                activeIds={activeIds}
                onAdd={handleAdd}
                desktopMode
              />
            </div>
          </Block>
        </div>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: NÃO TENHO INTERESSE
// ─────────────────────────────────────────────────────────────────────────────

function mediaLabel(mediaType: NotInterestedTitle["mediaType"]) {
  return mediaType === "tv" ? "Série" : "Filme";
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function TabNotInterested({
  titles,
  onUndo,
}: {
  titles: NotInterestedTitle[];
  onUndo: (title: NotInterestedTitle) => void;
}) {
  return (
    <div className="space-y-4">
      <Block>
        <Eyebrow color="rose">Preferências negativas</Eyebrow>
        <BlockTitle>Não tenho interesse</BlockTitle>

        <div className="mb-5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <StatPill value={titles.length} label="títulos bloqueados" accent />
          <StatPill value={titles.filter((item) => item.mediaType === "movie").length} label="filmes" />
          <StatPill value={titles.filter((item) => item.mediaType === "tv").length} label="séries" />
        </div>

        {titles.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] px-4 py-8 text-center">
            <p className="text-[13px] font-semibold text-white/55">Nenhum título marcado.</p>
            <p className="mt-1 text-[11px] text-white/28">
              Quando você usar &quot;Não tenho interesse&quot;, ele aparece aqui e perde força nas recomendações.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {titles.map((item) => {
              const changedAt = formatShortDate(item.updatedAt);
              return (
                <div
                  key={`${item.mediaType}:${item.tmdbId}`}
                  className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <a
                    href={`/title/${item.mediaType}/${item.tmdbId}`}
                    className="min-w-0 flex-1 rounded-xl px-1 py-1 transition-colors hover:bg-white/[0.03]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-rose-400/20 bg-rose-950/25 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-rose-300/75">
                        {mediaLabel(item.mediaType)}
                      </span>
                      {item.year && <span className="text-[11px] text-white/28">{item.year}</span>}
                      {changedAt && <span className="text-[11px] text-white/22">marcado em {changedAt}</span>}
                    </div>
                    <p className="mt-1 truncate text-[14px] font-bold text-white/82">{item.title}</p>
                    <p className="mt-0.5 truncate text-[11px] text-white/35">
                      Original: {item.originalTitle?.trim() || item.title}
                    </p>
                  </a>

                  <button
                    type="button"
                    onClick={() => onUndo(item)}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-[11px] font-bold text-white/55 transition-colors hover:border-teal-400/25 hover:bg-teal-950/20 hover:text-teal-200"
                  >
                    <RotateCcw size={13} />
                    Desfazer
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Block>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: CONTA
// ─────────────────────────────────────────────────────────────────────────────

function TabAccount({
  user, onSignOut, onResetLibrary,
}: {
  user: AuthUser;
  onSignOut: () => void;
  onResetLibrary: () => Promise<void>;
}) {
  const hasProvider = (user.app_metadata?.providers as string[] | undefined)?.includes("email");
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting]       = useState(false);
  const [resetDone, setResetDone]       = useState(false);

  async function handleConfirmReset() {
    setResetting(true);
    try {
      await onResetLibrary();
      setResetDone(true);
      setConfirmReset(false);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-4">

      {/* Login + Sessão lado a lado no desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

      {/* Login info */}
      <Block>
        <Eyebrow color="indigo">Informações da conta</Eyebrow>
        <BlockTitle>Login &amp; segurança</BlockTitle>

        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] px-4 py-3.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/25 flex items-center justify-center flex-shrink-0">
              <Mail size={15} className="text-indigo-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-wide mb-0.5">E-mail</p>
              <p className="text-[13px] font-semibold text-white/75 truncate">{user.email}</p>
            </div>
          </div>

          {hasProvider && (
            <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] px-4 py-3.5">
              <div className="w-9 h-9 rounded-xl bg-violet-600/20 border border-violet-500/25 flex items-center justify-center flex-shrink-0">
                <Lock size={15} className="text-violet-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-wide mb-0.5">Senha</p>
                <p className="text-[13px] font-semibold text-white/75">••••••••</p>
              </div>
            </div>
          )}
        </div>
      </Block>

      {/* Sign out */}
      <Block>
        <Eyebrow color="muted">Sessão</Eyebrow>
        <BlockTitle>Sair da conta</BlockTitle>

        <p className="text-[12px] text-white/35 mb-5 leading-relaxed">
          Encerre a sessão neste dispositivo. Seus dados permanecem salvos.
        </p>

        <button
          type="button"
          onClick={onSignOut}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.07] text-[13px] font-semibold text-white/60 hover:text-white/80 transition-all"
        >
          <LogOut size={15} />
          Sair da conta
        </button>
      </Block>

      </div>{/* end desktop 2-col grid */}

      {/* Reset library */}
      <Block>
        <Eyebrow color="muted">Zona de perigo</Eyebrow>
        <BlockTitle>Resetar biblioteca</BlockTitle>

        {resetDone ? (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3.5">
            <Check size={15} className="text-emerald-400 flex-shrink-0" />
            <p className="text-[13px] text-emerald-300/80">
              Biblioteca apagada. Sua conta está zerada.
            </p>
          </div>
        ) : confirmReset ? (
          <div className="rounded-2xl border border-rose-500/25 bg-rose-500/[0.05] p-4 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle size={16} className="text-rose-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-[13px] font-semibold text-rose-300">Tem certeza absoluta?</p>
                <p className="text-[12px] text-white/40 leading-relaxed">
                  Isso vai apagar <strong className="text-white/60">permanentemente</strong> toda a sua
                  biblioteca, histórico, avaliações, episódios assistidos e sinais de recomendação.
                  Essa ação não pode ser desfeita.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleConfirmReset}
                disabled={resetting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-rose-500/40 bg-rose-600/20 hover:bg-rose-600/30 text-[13px] font-semibold text-rose-300 hover:text-rose-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resetting ? (
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-rose-400/30 border-t-rose-400 animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                {resetting ? "Apagando..." : "Sim, apagar tudo"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                disabled={resetting}
                className="px-4 py-2.5 rounded-xl text-[13px] text-white/40 hover:text-white/60 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[12px] text-white/35 mb-5 leading-relaxed">
              Apaga toda a sua biblioteca, histórico de episódios, avaliações e dados de comportamento.
              Suas preferências de streaming são mantidas. Essa ação é irreversível.
            </p>
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] hover:bg-rose-500/[0.12] text-[13px] font-semibold text-rose-400/80 hover:text-rose-300 transition-all"
            >
              <Trash2 size={14} />
              Resetar biblioteca
            </button>
          </>
        )}
      </Block>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function ProfilePageClient() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading, refresh: refreshAuth } = useAuth();


  const [stats,        setStats]        = useState<LibraryStats>({ watched: 0, watching: 0, watchlist: 0, abandoned: 0, favorites: 0, movies: 0, series: 0, total: 0 });
  const [genres,       setGenres]       = useState<GenreStat[]>([]);
  const [allProviders, setAllProviders] = useState<StreamingProvider[]>([]);
  const [activeIds,    setActiveIds]    = useState<string[]>([]);
  const [notInterestedTitles, setNotInterestedTitles] = useState<NotInterestedTitle[]>([]);
  const [dataLoading,  setDataLoading]  = useState(true);

  const rawTab    = searchParams.get("tab") as Tab | null;
  const validTabs: Tab[] = ["visao-geral", "preferencias", "nao-interesse", "conta"];
  const [tab, setTab] = useState<Tab>(validTabs.includes(rawTab as Tab) ? (rawTab as Tab) : "visao-geral");

  function changeTab(t: Tab) {
    setTab(t);
    router.replace(`/profile?tab=${t}`, { scroll: false });
  }

  const loadData = useCallback(async (_u: AuthUser) => {
    setDataLoading(true);

    // Stats
    try {
      const response = await fetch("/api/library", { cache: "no-store" });
      if (response.ok) {
        const json = (await response.json()) as LibraryResponseForStats;
        const titles = json.data ?? [];
        const s: LibraryStats = { watched: 0, watching: 0, watchlist: 0, abandoned: 0, favorites: 0, movies: 0, series: 0, total: titles.length };
        for (const t of titles) {
          if (t.status === "watched")   s.watched++;
          if (t.status === "watching")  s.watching++;
          if (t.status === "watchlist") s.watchlist++;
          if (t.status === "abandoned") s.abandoned++;
          if (t.media_type === "movie") s.movies++;
          if (t.media_type === "tv")    s.series++;
          if (t.favorite)               s.favorites++;
        }
        setStats(s);
      }
    } catch { /* silent */ }

    // Genres — via API route (server-side, service role bypasses RLS)
    try {
      const json = await fetchGenreStatsOnce();
      if (json.ok && Array.isArray(json.genres)) {
        setGenres(json.genres);
      }
    } catch { /* silent */ }

    // Providers + active preferences via API
    try {
      const json = await fetchStreamingPreferencesOnce();
      if (json.ok) {
        setAllProviders(json.providers ?? []);
        const active = (json.preferences ?? [])
          .filter(p => p.is_enabled)
          .sort((a, b) => a.priority_order - b.priority_order)
          .map(p => p.provider_id);
        setActiveIds(active);
      }
    } catch { /* silent */ }

    // Lista de titulos marcados como "Nao tenho interesse"
    try {
      const json = await fetchNotInterestedTitles();
      if (json.ok && Array.isArray(json.items)) {
        setNotInterestedTitles(json.items);
      }
    } catch { /* silent */ }

    setDataLoading(false);
  }, []);

  useEffect(() => {
    if (!user) { setDataLoading(false); return; }
    void loadData(user);
  }, [user, loadData]);

  async function handleSignOut() {
    if (user?.authProvider === "authjs") {
      try {
        await signOutAuthJs({ redirect: false });
      } catch {
        // Auth.js signout failed — estado local ainda será limpo
      }
    }
    await refreshAuth();
    router.push("/");
    router.refresh();
  }

  async function handleResetLibrary() {
    const res = await fetch("/api/user/reset-library", { method: "DELETE" });
    if (!res.ok) throw new Error("Falha ao resetar a biblioteca");
    setStats({ watched: 0, watching: 0, watchlist: 0, abandoned: 0, favorites: 0, movies: 0, series: 0, total: 0 });
    setGenres([]);
    router.refresh();
  }

  async function handleUndoNotInterested(title: NotInterestedTitle) {
    const previous = notInterestedTitles;
    setNotInterestedTitles((current) =>
      current.filter((item) => item.tmdbId !== title.tmdbId || item.mediaType !== title.mediaType),
    );

    try {
      const response = await fetch("/api/user/feedback", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmdb_id: title.tmdbId,
          media_type: title.mediaType,
          feedback_type: "not_interested",
          source: "profile_not_interested",
        }),
      });

      if (!response.ok) throw new Error("undo failed");
      router.refresh();
    } catch {
      setNotInterestedTitles(previous);
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500/30 border-t-indigo-400 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="w-14 h-14 rounded-[18px] bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center mb-2">
          <span className="text-2xl font-black text-white">P</span>
        </div>
        <h1 className="text-xl font-black text-white/90 tracking-tight">Central do Perfil</h1>
        <p className="text-[13px] text-white/40 max-w-xs leading-relaxed">
          Entre na sua conta para ver sua biblioteca, preferencias e historico na Poplog.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">

      <ProfileHeader user={user} stats={stats} onSignOut={handleSignOut} />

      <TabBar active={tab} onChange={changeTab} />

      {tab === "visao-geral" && (
        dataLoading
          ? <div className="flex items-center justify-center py-16"><div className="w-6 h-6 rounded-full border-2 border-indigo-500/30 border-t-indigo-400 animate-spin" /></div>
          : <TabOverview stats={stats} genres={genres} />
      )}

      {tab === "preferencias" && (
        dataLoading
          ? <div className="flex items-center justify-center py-16"><div className="w-6 h-6 rounded-full border-2 border-indigo-500/30 border-t-indigo-400 animate-spin" /></div>
          : <TabPreferences allProviders={allProviders} initialActiveIds={activeIds} />
      )}

      {tab === "nao-interesse" && (
        dataLoading
          ? <div className="flex items-center justify-center py-16"><div className="w-6 h-6 rounded-full border-2 border-rose-500/30 border-t-rose-400 animate-spin" /></div>
          : <TabNotInterested titles={notInterestedTitles} onUndo={handleUndoNotInterested} />
      )}

      {tab === "conta" && (
        <TabAccount user={user} onSignOut={handleSignOut} onResetLibrary={handleResetLibrary} />
      )}

    </div>
  );
}
