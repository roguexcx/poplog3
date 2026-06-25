// Feature toggles — flip a flag here to enable/disable a feature globally.
// This file is imported by both server and client components.
export const FEATURES = {
  // ── RADAR ─────────────────────────────────────────────────────────────────
  // NEXT_PUBLIC_FEATURE_RADAR=false oculta página, links, prefetch e API.
  // Por padrão local, o Radar fica ativo para validar a arquitetura POPLOG V2.
  RADAR: process.env.NEXT_PUBLIC_FEATURE_RADAR !== "false",
} as const;
