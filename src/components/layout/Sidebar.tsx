"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import LoginDrawer from "@/components/auth/LoginDrawer";
import { useAuth } from "@/hooks/useAuth";
import { FEATURES } from "@/lib/features";
import { Dice5, Film, Home, Library, LogIn, LogOut, Menu, PlayCircle, Radar, Search, Shield, Tv, UserCircle, X, } from "lucide-react";
import Link from "next/link";
import { signOut as signOutAuthJs } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
type NavLink = {
    href: string;
    label: string;
    icon: React.ComponentType<{
        size?: number;
        className?: string;
    }>;
    authRequired?: boolean;
    adminRequired?: boolean;
};
type NavGroup = {
    label: string;
    links: NavLink[];
};
const NAV_GROUPS: NavGroup[] = [
    {
        label: "Descobrir",
        links: [
            { href: "/", label: uiMessage("ui.fc2c74003cb1"), icon: Home },
            { href: "/buscar", label: uiMessage("ui.a62405e2cefb"), icon: Search },
        ],
    },
    {
        label: "Acompanhar",
        links: [
            { href: "/acompanhando", label: "Acompanhando", icon: PlayCircle, authRequired: true },
            ...(FEATURES.RADAR ? [{ href: "/radar", label: uiMessage("ui.aad82db2cb77"), icon: Radar } as NavLink] : []),
        ],
    },
    {
        label: "Organizar",
        links: [
            { href: "/library", label: uiMessage("ui.497ac5c11bf3"), icon: Library, authRequired: true },
        ],
    },
    {
        label: "Explorar",
        links: [
            { href: "/sorteio", label: uiMessage("ui.45a25136ea07"), icon: Dice5, authRequired: true },
        ],
    },
    {
        label: "Conta",
        links: [
            { href: "/profile", label: "Perfil", icon: UserCircle, authRequired: true },
            { href: "/admin", label: uiMessage("admin.nav.label"), icon: Shield, authRequired: true, adminRequired: true },
        ],
    },
];
const MOBILE_LINKS: NavLink[] = [
    { href: "/", label: uiMessage("ui.fc2c74003cb1"), icon: Home },
    { href: "/buscar", label: uiMessage("ui.a62405e2cefb"), icon: Search },
    { href: "/acompanhando", label: uiMessage("ui.3c8d6f0c2c9f"), icon: PlayCircle, authRequired: true },
    { href: "/library", label: uiMessage("ui.497ac5c11bf3"), icon: Library, authRequired: true },
];
const MOBILE_MORE_LINKS: NavLink[] = [
    ...(FEATURES.RADAR ? [{ href: "/radar", label: uiMessage("ui.aad82db2cb77"), icon: Radar } as NavLink] : []),
    { href: "/buscar?type=movie", label: "Filmes", icon: Film },
    { href: "/buscar?type=tv", label: uiMessage("ui.de212174bc0c"), icon: Tv },
    { href: "/sorteio", label: uiMessage("ui.45a25136ea07"), icon: Dice5, authRequired: true },
    { href: "/profile", label: "Perfil", icon: UserCircle, authRequired: true },
    { href: "/admin", label: uiMessage("admin.nav.label"), icon: Shield, authRequired: true, adminRequired: true },
];
export default function Sidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const [isHovered, setIsHovered] = useState(false);
    const [loginOpen, setLoginOpen] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const { user, loading: authLoading, refresh: refreshAuth, authjsConfigured } = useAuth();
    async function handleLogout() {
        if (user?.authProvider === "authjs") {
            try {
                await signOutAuthJs({ redirect: false });
            }
            catch {
                // Auth.js signout failed — estado local ainda será limpo
            }
        }
        await refreshAuth();
        setMobileMenuOpen(false);
        router.refresh();
    }
    function refreshUser() {
        void refreshAuth().then(() => router.refresh());
    }
    function isActive(href: string) {
        const hrefPath = href.split("?")[0];
        if (hrefPath === "/")
            return pathname === "/";
        return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
    }
    function isVisible(link: NavLink) {
        if (link.adminRequired) {
            return !authLoading && (user?.role === "admin" || user?.role === "master");
        }
        return !link.authRequired || (!authLoading && !!user);
    }
    return (<>
      <aside onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)} className={`peer/sidebar fixed left-0 top-0 z-50 hidden h-screen flex-col border-r border-white/5 bg-[#09090f]/85 backdrop-blur-xl transition-all duration-300 ease-in-out md:flex ${isHovered ? "w-64" : "w-20"}`}>
        <div className="flex items-center gap-4 px-5 py-5">
          <Link href="/" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-purple-700 shadow-lg shadow-indigo-500/20" aria-label={uiMessage("ui.cc85e897e2a5")}>
            <span className="text-xl font-black text-white">P</span>
          </Link>

          <p className={`whitespace-nowrap text-lg font-bold text-white transition-all duration-300 ${isHovered
            ? "translate-x-0 opacity-100"
            : "pointer-events-none -translate-x-2 opacity-0"}`}>
            Poplog
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4 no-scrollbar">
          <div className="space-y-5">
            {NAV_GROUPS.map((group) => {
            const visibleLinks = group.links.filter(isVisible);
            if (visibleLinks.length === 0)
                return null;
            return (<div key={group.label}>
                  <p className={`mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600 transition-all duration-300 ${isHovered
                    ? "opacity-100"
                    : "pointer-events-none opacity-0"}`}>
                    {group.label}
                  </p>

                  <div className="space-y-1.5">
                    {visibleLinks.map((link) => {
                    const active = isActive(link.href);
                    return (<Link key={link.href} href={link.href} title={!isHovered ? link.label : undefined} className={`group relative flex items-center gap-4 rounded-xl px-3 py-3 transition-all duration-200 ${active
                            ? "bg-indigo-600/10 text-indigo-300"
                            : "text-zinc-300 hover:bg-white/5 hover:text-white"}`}>
                          <link.icon size={22} className={`shrink-0 transition-colors duration-200 ${active
                            ? "text-indigo-300 stroke-[2.5px]"
                            : "text-zinc-300 stroke-[1.9px] group-hover:text-white"}`}/>

                          <span className={`whitespace-nowrap font-medium transition-all duration-300 ${isHovered
                            ? "translate-x-0 opacity-100"
                            : "pointer-events-none -translate-x-2 opacity-0"}`}>
                            {link.label}
                          </span>

                          {active && !isHovered && (<div className="absolute left-0 h-6 w-1 rounded-r-full bg-indigo-500"/>)}
                        </Link>);
                })}
                  </div>
                </div>);
        })}
          </div>
        </nav>

        <div className="border-t border-white/5 p-3">
          {user ? (<button type="button" onClick={handleLogout} className="group flex w-full items-center gap-3 rounded-xl p-2 text-left text-zinc-500 transition hover:bg-white/5 hover:text-white">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-indigo-500/40 to-purple-500/40 text-sm font-bold text-white">
                {user.email?.slice(0, 1).toUpperCase() ?? "U"}
              </div>

              <div className={`min-w-0 transition-all duration-300 ${isHovered
                ? "translate-x-0 opacity-100"
                : "pointer-events-none -translate-x-2 opacity-0"}`}>
                <p className="truncate text-sm font-semibold text-white">
                  {user.email}
                </p>

                <p className="flex items-center gap-1 truncate text-[10px] text-zinc-500">
                  <LogOut size={12}/>{uiMessage("ui.3b79237730c4")}</p>
              </div>
            </button>) : (<button type="button" onClick={() => setLoginOpen(true)} className="group flex w-full items-center gap-3 rounded-xl p-2 text-left text-zinc-500 transition hover:bg-white/5 hover:text-white">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-indigo-500/40 to-purple-500/40 font-bold text-white">
                <LogIn size={19}/>
              </div>

              <div className={`min-w-0 transition-all duration-300 ${isHovered
                ? "translate-x-0 opacity-100"
                : "pointer-events-none -translate-x-2 opacity-0"}`}>
                <p className="truncate text-sm font-semibold text-white">{uiMessage("ui.7573ba85155c")}</p>

                <p className="truncate text-[10px] text-zinc-500">{uiMessage("ui.9b63d74160ce")}</p>
              </div>
            </button>)}
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-[calc(100vw-100%)] z-50 border-t border-white/5 bg-[#09090f]/90 px-1.5 pb-[calc(env(safe-area-inset-bottom,0px)+0.35rem)] pt-1.5 backdrop-blur-xl md:hidden">
        <div className="grid grid-cols-5 items-center">
          {MOBILE_LINKS.filter(isVisible).map((link) => {
            const active = isActive(link.href);
            return (<Link key={link.href} href={link.href} className={`flex min-h-[44px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 transition-colors ${active ? "text-indigo-300" : "text-zinc-300"}`}>
                <link.icon size={22} className={active ? "stroke-[2.5px]" : "stroke-[1.9px]"}/>

                <span className="max-w-full truncate text-[9px] font-bold uppercase tracking-normal min-[380px]:text-[10px]">
                  {link.label}
                </span>
              </Link>);
        })}

          <button type="button" onClick={() => setMobileMenuOpen(true)} className="flex min-h-[44px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-zinc-300 transition-colors hover:text-white">
            <Menu size={22} className="stroke-[1.9px]"/>
            <span className="max-w-full truncate text-[9px] font-bold uppercase tracking-normal min-[380px]:text-[10px]">
              Mais
            </span>
          </button>
        </div>
      </nav>

      {/* Mobile sheet */}
      {mobileMenuOpen && (<div className="fixed inset-0 z-[60] md:hidden">
          <button type="button" aria-label={uiMessage("ui.9da31443718f")} onClick={() => setMobileMenuOpen(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm"/>

          <div className="absolute bottom-0 left-0 right-0 rounded-t-3xl border-t border-white/10 bg-[#09090f] p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-base font-bold text-white">{uiMessage("ui.8f453e63fe4d")}</p>
                <p className="text-xs text-zinc-500">{uiMessage("ui.3c2862f24d9f")}</p>
              </div>

              <button type="button" onClick={() => setMobileMenuOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-zinc-300 transition hover:bg-white/10 hover:text-white">
                <X size={20}/>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {MOBILE_MORE_LINKS.filter(isVisible).map((link) => {
                const active = isActive(link.href);
                return (<Link key={link.href} href={link.href} onClick={() => setMobileMenuOpen(false)} className={`flex items-center gap-3 rounded-2xl border p-3 transition ${active
                        ? "border-indigo-500/30 bg-indigo-600/10 text-indigo-300"
                        : "border-white/5 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06] hover:text-white"}`}>
                    <link.icon size={20} className={active ? "stroke-[2.5px]" : "stroke-[1.9px]"}/>

                    <span className="text-sm font-semibold">{link.label}</span>
                  </Link>);
            })}
            </div>

            <div className="mt-4 border-t border-white/5 pt-4">
              {user ? (<button type="button" onClick={handleLogout} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.03] p-3 text-left text-zinc-300 transition hover:bg-white/[0.06] hover:text-white">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-indigo-500/40 to-purple-500/40 text-sm font-bold text-white">
                    {user.email?.slice(0, 1).toUpperCase() ?? "U"}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">
                      {user.email}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-zinc-500">
                      <LogOut size={13}/>{uiMessage("ui.3b79237730c4")}</p>
                  </div>
                </button>) : (<button type="button" onClick={() => {
                    setMobileMenuOpen(false);
                    setLoginOpen(true);
                }} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.03] p-3 text-left text-zinc-300 transition hover:bg-white/[0.06] hover:text-white">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-indigo-500/40 to-purple-500/40 text-white">
                    <LogIn size={19}/>
                  </div>

                  <div>
                    <p className="text-sm font-semibold text-white">{uiMessage("ui.7573ba85155c")}</p>
                    <p className="text-xs text-zinc-500">{uiMessage("ui.9b63d74160ce")}</p>
                  </div>
                </button>)}
            </div>
          </div>
        </div>)}

      <LoginDrawer open={loginOpen} onClose={() => setLoginOpen(false)} onSuccess={refreshUser} oauthAvailable={authjsConfigured}/>
    </>);
}
