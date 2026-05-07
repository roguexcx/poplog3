"use client";

// src/components/layout/Sidebar.tsx
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useCallback } from "react";

import { useAuth } from "@/hooks/useAuth";
import LoginDrawer from "@/components/auth/LoginDrawer";
import { createClient } from "@/lib/supabase/client";

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconHome({ filled }: { filled?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M17 17l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconFilm({ filled }: { filled?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2" y="4" width="20" height="16" rx="2"
        fill={filled ? "currentColor" : "none"} fillOpacity={filled ? 0.15 : 0}
        stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 4v16M17 4v16M2 9h3M2 15h3M19 9h3M19 15h3"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconTV({ filled }: { filled?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2" y="3" width="20" height="14" rx="2"
        fill={filled ? "currentColor" : "none"} fillOpacity={filled ? 0.15 : 0}
        stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconBookmark({ filled }: { filled?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 3h14a1 1 0 0 1 1 1v17l-8-4-8 4V4a1 1 0 0 1 1-1z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 17l5-5-5-5M21 12H9"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Data ─────────────────────────────────────────────────────────────────────

type AnchorLink = { label: string; anchor: string };

const ROUTE_ANCHORS: Record<string, AnchorLink[]> = {
  "/": [
    { label: "Continue Assistindo", anchor: "continue-watching" },
    { label: "Para Você",           anchor: "for-you"           },
    { label: "Em Alta",             anchor: "trending"          },
    { label: "Minha Watchlist",     anchor: "watchlist"         },
  ],
};

const NAV_LINKS = [
  { href: "/",       label: "Início", icon: IconHome   },
  { href: "/buscar", label: "Buscar", icon: IconSearch  },
  { href: "/filmes", label: "Filmes", icon: IconFilm   },
  { href: "/series", label: "Séries", icon: IconTV     },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  const [loginOpen,    setLoginOpen]    = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const anchors = ROUTE_ANCHORS[pathname] ?? [];

  const handleLogout = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUserMenuOpen(false);
  }, []);

  function scrollTo(anchor: string) {
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const displayName =
    user?.user_metadata?.full_name ??
    user?.email?.split("@")[0] ??
    "Usuário";
  const avatarLetter = displayName[0]?.toUpperCase() ?? "U";

  return (
    <>
      {/*
        position: fixed + left: 0 + top: 0
        Nenhum pai deve ter transform, filter ou will-change
        que criaria um novo containing block e quebraria o fixed.
      */}
      <aside
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: 200,
          height: "100vh",
          zIndex: 40,
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#08080f",
          borderRight: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        {/* ── Logo ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, height: 64, padding: "0 20px", flexShrink: 0 }}>
          <span style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: 8,
            backgroundColor: "#4f46e5",
            fontSize: 12, fontWeight: 900, color: "white",
            flexShrink: 0, userSelect: "none",
          }}>
            P
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em", color: "white" }}>
            Poplog
          </span>
        </div>

        <Divider />

        {/* ── Main nav ── */}
        <nav style={{ display: "flex", flexDirection: "column", gap: 2, padding: "12px 10px 0", flexShrink: 0 }}>
          {NAV_LINKS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  height: 40,
                  padding: "0 12px",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 500,
                  textDecoration: "none",
                  color: active ? "white" : "rgb(113 113 122)",
                  backgroundColor: active ? "rgba(255,255,255,0.07)" : "transparent",
                  transition: "background-color 120ms, color 120ms",
                }}
                onMouseEnter={e => {
                  if (!active) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.04)";
                    (e.currentTarget as HTMLElement).style.color = "rgb(212 212 216)";
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                    (e.currentTarget as HTMLElement).style.color = "rgb(113 113 122)";
                  }
                }}
              >
                {active && (
                  <span style={{
                    position: "absolute", left: 0, top: "50%",
                    transform: "translateY(-50%)",
                    width: 2, height: 16, borderRadius: 2,
                    backgroundColor: "#6366f1",
                  }} />
                )}
                <Icon filled={active} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* ── Contextual anchors ── */}
        {anchors.length > 0 && (
          <>
            <Divider style={{ marginTop: 20 }} />
            <div style={{ display: "flex", flexDirection: "column", padding: "12px 10px 0", flexShrink: 0 }}>
              <span style={{
                display: "block", padding: "0 12px", marginBottom: 6,
                fontSize: 10, fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "0.16em",
                color: "rgb(63 63 70)",
              }}>
                Nesta página
              </span>
              {anchors.map(({ label, anchor }) => (
                <button
                  key={anchor}
                  type="button"
                  onClick={() => scrollTo(anchor)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    height: 32, padding: "0 12px",
                    borderRadius: 8, border: "none",
                    backgroundColor: "transparent",
                    fontSize: 12, fontWeight: 500,
                    color: "rgb(82 82 91)",
                    cursor: "pointer", textAlign: "left",
                    transition: "background-color 120ms, color 120ms",
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.03)";
                    (e.currentTarget as HTMLElement).style.color = "rgb(161 161 170)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                    (e.currentTarget as HTMLElement).style.color = "rgb(82 82 91)";
                  }}
                >
                  <span style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: "currentColor", flexShrink: 0 }} />
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        <div style={{ flex: 1 }} />

        {/* ── Watchlist ── */}
        <div style={{ padding: "0 10px 8px", flexShrink: 0 }}>
          <Link
            href="/watchlist"
            style={{
              display: "flex", alignItems: "center", gap: 10,
              height: 40, padding: "0 12px", borderRadius: 10,
              fontSize: 14, fontWeight: 500, textDecoration: "none",
              color: pathname === "/watchlist" ? "white" : "rgb(113 113 122)",
              backgroundColor: pathname === "/watchlist" ? "rgba(255,255,255,0.07)" : "transparent",
              transition: "background-color 120ms, color 120ms",
            }}
            onMouseEnter={e => {
              if (pathname !== "/watchlist") {
                (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.04)";
                (e.currentTarget as HTMLElement).style.color = "rgb(212 212 216)";
              }
            }}
            onMouseLeave={e => {
              if (pathname !== "/watchlist") {
                (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                (e.currentTarget as HTMLElement).style.color = "rgb(113 113 122)";
              }
            }}
          >
            <IconBookmark filled={pathname === "/watchlist"} />
            Watchlist
          </Link>
        </div>

        <Divider />

        {/* ── Auth ── */}
        <div style={{ position: "relative", padding: "12px 10px", flexShrink: 0 }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, height: 48, padding: "0 12px" }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", backgroundColor: "rgba(255,255,255,0.06)", flexShrink: 0 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                <div style={{ height: 10, width: "60%", borderRadius: 4, backgroundColor: "rgba(255,255,255,0.06)" }} />
                <div style={{ height: 8, width: "80%", borderRadius: 4, backgroundColor: "rgba(255,255,255,0.04)" }} />
              </div>
            </div>
          ) : user ? (
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setUserMenuOpen(v => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  width: "100%", padding: "8px 12px", borderRadius: 10,
                  border: "none", backgroundColor: "transparent",
                  cursor: "pointer", textAlign: "left",
                  transition: "background-color 120ms",
                }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)")}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                {/* Avatar */}
                <span style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 32, height: 32, borderRadius: "50%",
                  backgroundColor: "rgba(79,70,229,0.25)",
                  fontSize: 12, fontWeight: 700, color: "#a5b4fc",
                  boxShadow: "0 0 0 1px rgba(99,102,241,0.25)",
                  flexShrink: 0,
                }}>
                  {avatarLetter}
                </span>
                {/* Info */}
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: "rgb(212 212 216)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {displayName}
                  </span>
                  <span style={{ display: "block", fontSize: 10, color: "rgb(82 82 91)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {user.email}
                  </span>
                </span>
                {/* Chevron */}
                <span style={{ color: "rgb(82 82 91)", flexShrink: 0, transform: userMenuOpen ? "rotate(180deg)" : "none", transition: "transform 200ms" }}>
                  <IconChevronDown />
                </span>
              </button>

              {/* Dropdown */}
              {userMenuOpen && (
                <div style={{
                  position: "absolute", bottom: "100%", left: 0, right: 0,
                  marginBottom: 4, borderRadius: 10, overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.06)",
                  backgroundColor: "#0d0d18",
                  boxShadow: "0 -8px 32px rgba(0,0,0,0.5)",
                }}>
                  <button
                    type="button"
                    onClick={handleLogout}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      width: "100%", padding: "12px 16px",
                      border: "none", backgroundColor: "transparent",
                      fontSize: 13, color: "rgb(161 161 170)",
                      cursor: "pointer", textAlign: "left",
                      transition: "background-color 120ms, color 120ms",
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.04)";
                      (e.currentTarget as HTMLElement).style.color = "rgb(248 113 113)";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                      (e.currentTarget as HTMLElement).style.color = "rgb(161 161 170)";
                    }}
                  >
                    <IconLogout />
                    Sair da conta
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Logged out */
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "100%", padding: "10px 16px", borderRadius: 10,
                border: "none", backgroundColor: "#4f46e5",
                fontSize: 13, fontWeight: 600, color: "white",
                cursor: "pointer", transition: "background-color 120ms",
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6366f1")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#4f46e5")}
            >
              Entrar
            </button>
          )}
        </div>
      </aside>

      <LoginDrawer open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}

// ─── Divider ──────────────────────────────────────────────────────────────────

function Divider({ style }: { style?: React.CSSProperties }) {
  return (
    <div style={{
      height: 1,
      margin: "0 16px",
      backgroundColor: "rgba(255,255,255,0.05)",
      flexShrink: 0,
      ...style,
    }} />
  );
}