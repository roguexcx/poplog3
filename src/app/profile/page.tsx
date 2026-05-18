"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/server/supabase/client";
import type { User } from "@supabase/supabase-js";

// ── types ─────────────────────────────────────────────────────────────────────

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

// ── mock visual data (genres + streamings — phase 2 will derive from library) ─

const GENRE_DIST = [
  { name: "Drama",            pct: 34, color: "bg-indigo-500" },
  { name: "Ação",             pct: 23, color: "bg-rose-500" },
  { name: "Ficção Científica",pct: 18, color: "bg-cyan-500" },
  { name: "Crime",            pct: 14, color: "bg-amber-500" },
  { name: "Comédia",          pct: 11, color: "bg-teal-500" },
];

const STREAMINGS = [
  { name: "Netflix",     bg: "bg-[#E50914]", short: "N",   active: true  },
  { name: "Prime Video", bg: "bg-[#00A8E1]", short: "P",   active: true  },
  { name: "Disney+",     bg: "bg-[#113CCF]", short: "D+",  active: false },
  { name: "Max",         bg: "bg-[#6D28D9]", short: "M",   active: true  },
  { name: "Apple TV+",   bg: "bg-zinc-800",  short: "▶",   active: false },
  { name: "Globoplay",   bg: "bg-[#D50032]", short: "G",   active: false },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function getInitials(user: User): string {
  const name = user.user_metadata?.full_name ?? user.user_metadata?.name;
  if (name) {
    return name.split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase();
  }
  return (user.email?.[0] ?? "U").toUpperCase();
}

function getDisplayName(user: User): string {
  return user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email?.split("@")[0] ?? "Usuário";
}

function formatJoinDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function estimateHours(stats: LibraryStats): number {
  return Math.round((stats.movies * 105 + stats.series * 45 * 8) / 60);
}

function avatarBg(email: string): string {
  const hues = ["from-violet-600 to-indigo-600", "from-rose-600 to-pink-600",
    "from-cyan-600 to-teal-600", "from-amber-600 to-orange-600",
    "from-emerald-600 to-teal-600"];
  const idx = email.charCodeAt(0) % hues.length;
  return hues[idx];
}

// ── primitives ────────────────────────────────────────────────────────────────

function SectionEyebrow({ children, color = "indigo" }: { children: React.ReactNode; color?: string }) {
  const map: Record<string, [string, string]> = {
    indigo: ["bg-indigo-400/60", "text-indigo-400/80"],
    violet: ["bg-violet-400/60", "text-violet-400/80"],
    teal:   ["bg-teal-400/60",   "text-teal-400/80"],
    amber:  ["bg-amber-400/60",  "text-amber-400/80"],
    muted:  ["bg-white/20",      "text-white/30"],
  };
  const [line, text] = map[color] ?? map.indigo;
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className={`block h-px w-5 rounded-full ${line}`} />
      <p className={`text-[9.5px] font-bold uppercase tracking-[0.22em] ${text}`}>{children}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-black tracking-[-0.03em] text-white/90 leading-tight mb-5">{children}</h2>;
}

function SectionDivider() {
  return <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent my-10" />;
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({
  value, label, sub, accent = false,
}: {
  value: string | number;
  label: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border px-4 py-4 ${accent
      ? "bg-violet-950/35 border-violet-500/20"
      : "bg-white/[0.025] border-white/[0.06]"
    }`}>
      <p className={`text-2xl font-black tracking-tight leading-none mb-1 ${accent ? "text-violet-200" : "text-white/80"}`}>
        {value}
      </p>
      <p className="text-[11px] text-white/35 leading-snug">{label}</p>
      {sub && <p className={`text-[10px] mt-1 ${accent ? "text-violet-400/60" : "text-white/20"}`}>{sub}</p>}
    </div>
  );
}

// ── ProgressRing ──────────────────────────────────────────────────────────────

function ProgressRing({
  pct, value, label,
}: {
  pct: number;
  value: string;
  label: string;
}) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(pct, 100) / 100);
  return (
    <div className="flex flex-col items-center gap-2">
      <svg viewBox="0 0 84 84" className="w-20 h-20">
        <circle cx="42" cy="42" r={r} fill="none" stroke="white" strokeOpacity="0.06" strokeWidth="6" />
        <circle cx="42" cy="42" r={r} fill="none" stroke="url(#ring-grad)" strokeWidth="6"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 42 42)" />
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#06B6D4" />
          </linearGradient>
        </defs>
        <text x="42" y="39" textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: 14, fontWeight: 900, fill: "rgba(255,255,255,0.88)", fontFamily: "inherit" }}>
          {value}
        </text>
        <text x="42" y="53" textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: 8, fill: "rgba(255,255,255,0.35)", fontFamily: "inherit", letterSpacing: 1 }}>
          %
        </text>
      </svg>
      <p className="text-[11px] text-white/40 text-center leading-snug">{label}</p>
    </div>
  );
}

// ── AvatarEditDropdown ────────────────────────────────────────────────────────

function AvatarEditDropdown({ onClose }: { onClose: () => void }) {
  const options = [
    { icon: "↑", label: "Enviar foto",    sub: "JPG, PNG ou WebP · max 2MB" },
    { icon: "🔗", label: "URL de imagem", sub: "Cole um link público" },
    { icon: "✕", label: "Remover foto",  sub: "Volta ao avatar padrão" },
  ];
  return (
    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 z-50 w-56 rounded-2xl border border-white/[0.10] bg-zinc-900/95 backdrop-blur-xl shadow-2xl p-1.5">
      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/25 px-3 pt-2 pb-1.5">Editar avatar</p>
      {options.map(o => (
        <button
          key={o.label}
          type="button"
          onClick={onClose}
          className="w-full flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.05] transition-colors text-left group"
        >
          <span className="text-base mt-0.5 group-hover:scale-110 transition-transform">{o.icon}</span>
          <div>
            <p className="text-[12.5px] font-bold text-white/75">{o.label}</p>
            <p className="text-[10px] text-white/30">{o.sub}</p>
          </div>
        </button>
      ))}
      <div className="h-px bg-white/[0.06] mx-3 my-1" />
      <button
        type="button"
        onClick={onClose}
        className="w-full text-[11px] text-white/25 hover:text-white/45 py-1.5 transition-colors"
      >
        Cancelar
      </button>
    </div>
  );
}

// ── ProfileHeader ─────────────────────────────────────────────────────────────

function ProfileHeader({
  user, stats,
}: {
  user: User;
  stats: LibraryStats;
}) {
  const initials = getInitials(user);
  const name     = getDisplayName(user);
  const gradBg   = avatarBg(user.email ?? "u");
  const joinDate = formatJoinDate(user.created_at);
  const hours    = estimateHours(stats);
  const [editOpen, setEditOpen] = useState(false);

  return (
    <div className="relative isolate rounded-[28px] overflow-hidden border border-white/[0.06] mb-10">
      {/* atmospheric bg */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-indigo-950/70 via-zinc-950 to-black" />
      <div className="absolute inset-0 -z-10"
        style={{ background: "radial-gradient(ellipse at 20% 0%, rgba(139,92,246,0.18) 0%, transparent 55%), radial-gradient(ellipse at 80% 100%, rgba(6,182,212,0.10) 0%, transparent 45%)" }} />
      <div className="absolute inset-0 -z-10 opacity-[0.025]"
        style={{ backgroundImage: "linear-gradient(0deg,white 1px,transparent 1px),linear-gradient(90deg,white 1px,transparent 1px)", backgroundSize: "44px 44px" }} />

      <div className="px-6 sm:px-8 pt-8 pb-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">

          {/* avatar */}
          <div className="relative">
            <div className={`w-[88px] h-[88px] rounded-[24px] bg-gradient-to-br ${gradBg} flex items-center justify-center border-2 border-white/[0.12] shadow-2xl flex-shrink-0`}>
              {user.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt={name}
                  className="w-full h-full rounded-[22px] object-cover"
                />
              ) : (
                <span className="text-2xl font-black text-white/90 tracking-tight">{initials}</span>
              )}
            </div>

            {/* edit button */}
            <button
              type="button"
              onClick={() => setEditOpen(v => !v)}
              className="absolute -bottom-2 -right-2 w-7 h-7 rounded-full bg-white/[0.09] hover:bg-white/[0.16] border border-white/[0.14] flex items-center justify-center transition-all text-white/60 hover:text-white/90"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>

            {editOpen && <AvatarEditDropdown onClose={() => setEditOpen(false)} />}
          </div>

          {/* user info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h1 className="text-2xl font-black tracking-[-0.04em] text-white/93 leading-none">{name}</h1>
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] px-2 py-0.5 rounded-full border border-violet-500/25 bg-violet-950/40 text-violet-300/70">
                Membro
              </span>
            </div>
            <p className="text-[12px] text-white/35 mb-3">{user.email}</p>
            <p className="text-[11px] text-white/22">Membro desde {joinDate}</p>
          </div>

          {/* right quick stats */}
          <div className="flex items-center gap-4 sm:gap-6 flex-shrink-0">
            <div className="text-center">
              <p className="text-xl font-black text-white/80 leading-none">{stats.total}</p>
              <p className="text-[10px] text-white/30 mt-0.5">títulos</p>
            </div>
            <div className="h-8 w-px bg-white/[0.08]" />
            <div className="text-center">
              <p className="text-xl font-black text-white/80 leading-none">{hours}</p>
              <p className="text-[10px] text-white/30 mt-0.5">horas est.</p>
            </div>
            <div className="h-8 w-px bg-white/[0.08]" />
            <div className="text-center">
              <p className="text-xl font-black text-violet-300/80 leading-none">{stats.favorites}</p>
              <p className="text-[10px] text-white/30 mt-0.5">favoritos</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── LoadingSkeleton ───────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-[190px] rounded-[28px] bg-white/[0.03] animate-pulse" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 rounded-2xl bg-white/[0.03] animate-pulse" />)}
      </div>
    </div>
  );
}

function NotLoggedIn() {
  const router = useRouter();
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center rounded-[28px] border border-white/[0.06] bg-white/[0.02]">
      <div className="w-14 h-14 rounded-2xl border border-white/10 bg-white/[0.04] flex items-center justify-center mx-auto mb-5">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/25">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
      <h3 className="text-[17px] font-black tracking-tight text-white/50 mb-2">Você não está logado</h3>
      <p className="text-[12px] text-white/25 max-w-xs mx-auto mb-6">Faça login para ver seu perfil, estatísticas e histórico da POPLOG.</p>
      <button
        type="button"
        onClick={() => router.push("/login")}
        className="text-[12.5px] font-bold text-indigo-300/80 border border-indigo-500/25 bg-indigo-950/30 hover:bg-indigo-950/50 rounded-2xl px-5 py-2.5 transition-colors"
      >
        Fazer login
      </button>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const [user, setUser]   = useState<User | null>(null);
  const [stats, setStats] = useState<LibraryStats>({
    watched: 0, watching: 0, watchlist: 0, abandoned: 0,
    favorites: 0, movies: 0, series: 0, total: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setIsLoading(false); return; }
      setUser(user);

      // fetch library counts
      const { data: titles } = await supabase
        .from("user_titles")
        .select("status, media_type, favorite")
        .eq("user_id", user.id);

      if (titles) {
        const s: LibraryStats = {
          watched:   titles.filter(t => t.status === "watched").length,
          watching:  titles.filter(t => t.status === "watching").length,
          watchlist: titles.filter(t => t.status === "watchlist").length,
          abandoned: titles.filter(t => t.status === "abandoned").length,
          favorites: titles.filter(t => t.favorite).length,
          movies:    titles.filter(t => t.media_type === "movie").length,
          series:    titles.filter(t => t.media_type === "tv").length,
          total:     titles.length,
        };
        setStats(s);
      }

      setIsLoading(false);
    }

    load().catch(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return (
      <section className="px-4 py-6 sm:px-6 md:px-8 lg:px-10">
        <LoadingSkeleton />
      </section>
    );
  }

  if (!user) {
    return (
      <section className="px-4 py-6 sm:px-6 md:px-8 lg:px-10">
        <NotLoggedIn />
      </section>
    );
  }

  const hours        = estimateHours(stats);
  const watchedPct   = stats.total > 0 ? Math.round((stats.watched / stats.total) * 100) : 0;
  const moviesPct    = stats.total > 0 ? Math.round((stats.movies / stats.total) * 100) : 50;

  return (
    <section className="px-4 py-6 sm:px-6 md:px-8 lg:px-10 pb-24 max-w-[1200px]">

      {/* ── Header ─────────────────────────────────────────────── */}
      <ProfileHeader user={user} stats={stats} />

      {/* ── Stats grid ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6 mb-10">
        <StatCard value={stats.watched}   label="Assistidos"  accent />
        <StatCard value={stats.watching}  label="Assistindo"  />
        <StatCard value={stats.watchlist} label="Watchlist"   />
        <StatCard value={stats.movies}    label="Filmes"      />
        <StatCard value={stats.series}    label="Séries"      />
        <StatCard value={stats.favorites} label="Favoritos"   sub="★ marcados" />
      </div>

      {/* ── Jornada ────────────────────────────────────────────── */}
      <div className="rounded-[24px] border border-white/[0.06] bg-white/[0.02] p-6 sm:p-8 mb-10">
        <SectionEyebrow color="violet">Sua jornada · POPLOG</SectionEyebrow>
        <SectionTitle>Números da sua história</SectionTitle>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 items-center">
          {/* Hours */}
          <div className="flex flex-col items-center gap-2">
            <p className="text-3xl font-black text-white/85 tracking-tight leading-none">
              {hours > 0 ? hours.toLocaleString("pt-BR") : "—"}
            </p>
            <p className="text-[11px] text-white/30 text-center">horas estimadas</p>
            <p className="text-[9.5px] text-white/20 text-center">filmes + séries</p>
          </div>

          {/* Completion ring */}
          <ProgressRing
            pct={watchedPct}
            value={String(watchedPct)}
            label="concluídos"
          />

          {/* Films vs Series bar */}
          <div className="flex flex-col gap-3 col-span-2">
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[10px] text-cyan-400/70 font-bold">Filmes</span>
                <span className="text-[10px] text-white/30">{moviesPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400"
                  style={{ width: `${moviesPct}%`, transition: "width 1s ease" }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[10px] text-indigo-400/70 font-bold">Séries</span>
                <span className="text-[10px] text-white/30">{100 - moviesPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-400"
                  style={{ width: `${100 - moviesPct}%`, transition: "width 1s ease" }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <SectionDivider />

      {/* ── Gêneros favoritos ───────────────────────────────────── */}
      <section className="mb-10">
        <SectionEyebrow color="teal">Gêneros favoritos · Estimado</SectionEyebrow>
        <SectionTitle>O que você mais assiste</SectionTitle>

        <div className="space-y-3">
          {GENRE_DIST.map(g => (
            <div key={g.name}>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[12px] font-bold text-white/60">{g.name}</span>
                <span className="text-[11px] text-white/25">{g.pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                <div className={`h-full rounded-full ${g.color} opacity-70`}
                  style={{ width: `${g.pct}%`, transition: "width 1.2s ease" }} />
              </div>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-white/18 mt-4 italic">
          * Distribuição estimada. Análise precisa dos gêneros chega em breve.
        </p>
      </section>

      <SectionDivider />

      {/* ── Streamings ativos ───────────────────────────────────── */}
      <section className="mb-10">
        <div className="flex items-end justify-between mb-5">
          <div>
            <SectionEyebrow color="indigo">Streamings · Configurados</SectionEyebrow>
            <h2 className="text-xl font-black tracking-[-0.03em] text-white/90 leading-tight">Plataformas ativas</h2>
          </div>
          <button
            type="button"
            onClick={() => router.push("/settings")}
            className="text-[11px] text-white/30 hover:text-white/60 transition-colors flex items-center gap-1 pb-0.5"
          >
            Gerenciar
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>

        <div className="flex flex-wrap gap-3">
          {STREAMINGS.map(s => (
            <div key={s.name}
              className={`flex items-center gap-2.5 rounded-2xl border px-4 py-3 transition-all ${
                s.active
                  ? "border-white/[0.10] bg-white/[0.04]"
                  : "border-white/[0.04] bg-transparent opacity-35"
              }`}
            >
              <div className={`w-7 h-7 rounded-lg ${s.bg} flex items-center justify-center flex-shrink-0`}>
                <span className="text-[10px] font-black text-white">{s.short}</span>
              </div>
              <div>
                <p className="text-[12px] font-bold text-white/75 leading-none">{s.name}</p>
                <p className={`text-[9.5px] mt-0.5 ${s.active ? "text-teal-400/60" : "text-white/25"}`}>
                  {s.active ? "Ativo" : "Inativo"}
                </p>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => router.push("/settings")}
            className="flex items-center gap-2 rounded-2xl border border-dashed border-white/[0.10] px-4 py-3 text-white/25 hover:text-white/50 hover:border-white/[0.18] transition-all"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="text-[12px] font-bold">Adicionar</span>
          </button>
        </div>
      </section>

      <SectionDivider />

      {/* ── Ações rápidas ───────────────────────────────────────── */}
      <section>
        <SectionEyebrow color="muted">Acesso rápido</SectionEyebrow>
        <SectionTitle>Central da conta</SectionTitle>

        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { label: "Configurações",     sub: "Streamings, idioma, notificações",  href: "/settings",     icon: "⚙️" },
            { label: "Minha Biblioteca",  sub: `${stats.total} títulos registrados`, href: "/library",      icon: "📚" },
            { label: "Acompanhando",      sub: `${stats.watching} em andamento`,     href: "/acompanhando", icon: "▶️" },
          ].map(link => (
            <button
              key={link.label}
              type="button"
              onClick={() => router.push(link.href)}
              className="group flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.045] hover:border-white/[0.10] transition-all duration-200 px-5 py-4 text-left"
            >
              <span className="text-xl flex-shrink-0">{link.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-black text-white/80 tracking-tight">{link.label}</p>
                <p className="text-[11px] text-white/30 truncate">{link.sub}</p>
              </div>
              <svg className="text-white/20 group-hover:text-white/45 flex-shrink-0 transition-colors" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          ))}
        </div>
      </section>

    </section>
  );
}
