// Feature toggles — flip a flag here to enable/disable a feature globally.
// This file is imported by both server and client components.
export const FEATURES = {
  // ── RADAR ─────────────────────────────────────────────────────────────────
  // false → página oculta, links removidos da sidebar, prefetch desligado, API retorna 503.
  // true  → tudo volta ao normal — única linha a alterar.
  RADAR: false,
} as const;
