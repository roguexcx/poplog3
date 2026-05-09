"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import {
  Home,
  Search,
  Film,
  Tv,
  LogOut,
  User,
  Library,
  Settings,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";
import LoginDrawer from "@/components/auth/LoginDrawer";

// ─── Configurações ──────────────────────────────────────────────────────────

const NAV_LINKS = [
  { href: "/", label: "Início", icon: Home },
  { href: "/buscar", label: "Buscar", icon: Search },
  { href: "/filmes", label: "Filmes", icon: Film },
  { href: "/series", label: "Séries", icon: Tv },
  { href: "/profile", label: "Biblioteca", icon: Library },
];

const ROUTE_ANCHORS: Record<string, { label: string; anchor: string }[]> = {
  "/": [
    { label: "Continue Assistindo", anchor: "continue-watching" },
    { label: "Para Você", anchor: "for-you" },
    { label: "Em Alta", anchor: "trending" },
    { label: "Minha Watchlist", anchor: "watchlist" },
  ],
};

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();

  const router = useRouter();
  const [loginOpen, setLoginOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileUserMenuOpen, setMobileUserMenuOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const anchors = ROUTE_ANCHORS[pathname] ?? [];

  const handleLogout = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUserMenuOpen(false);
  }, []);

  const displayName =
    user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "Usuário";

  const avatarLetter = displayName[0]?.toUpperCase() ?? "U";

  return (
    <>
      {/* ════════════════════════════════════════════════════════════
          DESKTOP SIDEBAR
      ════════════════════════════════════════════════════════════ */}
      <aside
  onMouseEnter={() => setIsHovered(true)}
  onMouseLeave={() => setIsHovered(false)}
  className={`
    peer/sidebar fixed top-0 left-0 z-50 hidden h-screen flex-col
    border-r border-white/5 bg-[#09090f]/80 backdrop-blur-xl
    transition-all duration-300 ease-in-out md:flex
    ${isHovered ? "w-60" : "w-20"}
  `}
>
        {/* Logo */}
        <div className="flex items-center gap-4 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-purple-700 shadow-lg shadow-indigo-500/20">
            <span className="text-xl font-black text-white">P</span>
          </div>

          <span
            className={`
              whitespace-nowrap text-lg font-bold text-white transition-all duration-300
              ${isHovered ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2 pointer-events-none"}
            `}
          >
            Poplog
          </span>
        </div>

        {/* Navegação */}
        <nav className="mt-4 flex-1 space-y-2 px-3">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;

            return (
              <Link
                key={link.href}
                href={link.href}
                className={`
                  group relative flex items-center gap-4 rounded-xl p-3
                  transition-all duration-200
                  ${
                    active
                      ? "bg-indigo-600/10 text-indigo-300"
                      : "text-zinc-300 hover:bg-white/5 hover:text-white"
                  }
                `}
              >
                <link.icon
                  size={22}
                  className={`
                    shrink-0 transition-colors duration-200
                    ${
                      active
                        ? "text-indigo-300 stroke-[2.5px]"
                        : "text-zinc-300 stroke-[1.9px] group-hover:text-white"
                    }
                  `}
                />

                <span
                  className={`
                    whitespace-nowrap font-medium transition-all duration-300
                    ${
                      isHovered
                        ? "opacity-100 translate-x-0"
                        : "opacity-0 -translate-x-2 pointer-events-none"
                    }
                  `}
                >
                  {link.label}
                </span>

                {active && !isHovered && (
                  <div className="absolute left-0 h-6 w-1 rounded-r-full bg-indigo-500" />
                )}
              </Link>
            );
          })}

          {/* Âncoras da Home */}
          {anchors.length > 0 && isHovered && (
            <div className="mt-4 space-y-1 border-t border-white/5 pt-4">
              <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                Nesta página
              </p>

              {anchors.map((anchor) => (
                <button
                  key={anchor.anchor}
                  onClick={() =>
                    document
                      .getElementById(anchor.anchor)
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-zinc-500 transition-colors hover:bg-white/5 hover:text-indigo-300"
                >
                  <div className="h-1.5 w-1.5 rounded-full bg-current opacity-40" />
                  {anchor.label}
                </button>
              ))}
            </div>
          )}
        </nav>

        {/* User / Auth */}
        <div className="border-t border-white/5 p-3">
          {user ? (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex w-full items-center gap-3 rounded-xl p-2 text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 font-bold text-white shadow-inner">
                  {avatarLetter}
                </div>

                <div
                  className={`
                    flex min-w-0 flex-col text-left transition-all duration-300
                    ${
                      isHovered
                        ? "w-auto opacity-100 translate-x-0"
                        : "w-0 opacity-0 -translate-x-2 pointer-events-none"
                    }
                  `}
                >
                  <span className="truncate text-sm font-semibold text-white">
                    {displayName}
                  </span>
                  <span className="truncate text-[10px] text-zinc-500">
                    Minha Conta
                  </span>
                </div>
              </button>

              {userMenuOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#12121a] shadow-2xl backdrop-blur-xl">
                  <div className="border-b border-white/5 p-4">
                    <p className="text-xs text-zinc-500">Logado como</p>
                    <p className="truncate text-sm font-medium text-white">
                      {user.email}
                    </p>
                  </div>

                  <Link
                    href="/profile"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex w-full items-center gap-3 p-4 text-sm text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    <Library size={16} />
                    Minha Biblioteca
                  </Link>

                  <Link
                    href="/settings"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex w-full items-center gap-3 px-4 pb-4 text-sm text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    <Settings size={16} />
                    Configurações
                  </Link>

                  <div className="border-t border-white/5">
                    <button
                      onClick={handleLogout}
                      className="flex w-full items-center gap-3 p-4 text-sm text-red-400 transition-colors hover:bg-red-500/10"
                    >
                      <LogOut size={16} />
                      Sair
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setLoginOpen(true)}
              className="group flex w-full items-center gap-4 rounded-xl p-3 text-indigo-300 transition-all hover:bg-indigo-500/10 hover:text-indigo-200"
            >
              <User
                size={22}
                className="shrink-0 stroke-[1.9px] text-indigo-300 transition-colors group-hover:text-indigo-200"
              />

              <span
                className={`
                  whitespace-nowrap font-bold transition-all duration-300
                  ${
                    isHovered
                      ? "opacity-100 translate-x-0"
                      : "opacity-0 -translate-x-2 pointer-events-none"
                  }
                `}
              >
                Entrar
              </span>
            </button>
          )}
        </div>
      </aside>

      {/* ════════════════════════════════════════════════════════════
          MOBILE BOTTOM NAV
      ════════════════════════════════════════════════════════════ */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/5 bg-[#09090f]/90 px-2 pb-[env(safe-area-inset-bottom,8px)] pt-1.5 backdrop-blur-xl md:hidden">
        <div className="flex items-center justify-around">
          {NAV_LINKS.filter((l) => l.href !== "/profile").map((link) => {
            const active = pathname === link.href;

            return (
              <Link
                key={link.href}
                href={link.href}
                className={`
                  flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1 rounded-xl px-2 transition-colors
                  ${active ? "text-indigo-300" : "text-zinc-300"}
                `}
              >
                <link.icon
                  size={22}
                  className={active ? "stroke-[2.5px]" : "stroke-[1.9px]"}
                />
                <span className="text-[10px] font-bold uppercase tracking-tighter">
                  {link.label}
                </span>
              </Link>
            );
          })}

          <button
            onClick={() => user ? setMobileUserMenuOpen(true) : setLoginOpen(true)}
            className={`flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1 rounded-xl px-2 transition-colors ${
              pathname === "/profile" ? "text-indigo-300" : "text-zinc-300 hover:text-white"
            }`}
          >
            {user ? (
              <div className={`flex h-[22px] w-[22px] items-center justify-center rounded-full text-[10px] font-bold text-white ${
                pathname === "/profile" ? "bg-indigo-400" : "bg-indigo-500"
              }`}>
                {avatarLetter}
              </div>
            ) : (
              <User size={22} className="stroke-[1.9px]" />
            )}

            <span className="text-[10px] font-bold uppercase tracking-tighter">
              {user ? "Conta" : "Entrar"}
            </span>
          </button>
        </div>
      </nav>

      {/* Mobile user menu overlay */}
      {mobileUserMenuOpen && user && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/60 md:hidden"
            onClick={() => setMobileUserMenuOpen(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-[70] rounded-t-3xl border-t border-white/10 bg-[#0e0e1a] px-4 pb-[env(safe-area-inset-bottom,24px)] pt-5 md:hidden">
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-white/20" />

            <div className="mb-4 flex items-center gap-3 px-1">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 text-sm font-bold text-white">
                {avatarLetter}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{displayName}</p>
                <p className="truncate text-xs text-zinc-500">{user.email}</p>
              </div>
            </div>

            <Link
              href="/profile"
              onClick={() => setMobileUserMenuOpen(false)}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-sm text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <Library size={18} />
              Minha Biblioteca
            </Link>

            <Link
              href="/settings"
              onClick={() => setMobileUserMenuOpen(false)}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-sm text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <Settings size={18} />
              Configurações
            </Link>

            <div className="mt-2 border-t border-white/5 pt-2">
              <button
                onClick={() => { handleLogout(); setMobileUserMenuOpen(false); }}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-sm text-red-400 transition-colors hover:bg-red-500/10"
              >
                <LogOut size={18} />
                Sair da conta
              </button>
            </div>
          </div>
        </>
      )}

      <LoginDrawer open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}