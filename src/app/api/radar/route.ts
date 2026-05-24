// -- /api/radar ─────────────────────────────────────────────────────────────────
// Endpoint unificado do Radar:
//
//   GET /api/radar?mode=general    -> Radar Geral: feed ICS + TMDB, sem personalização.
//   GET /api/radar?mode=personal   -> Radar Personalizado: AgendaEngine com dados do usuario.
// ──────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/server/supabase/admin";
import type { IcsAgendaResponse, RadarSections } from "@/app/api/ics/agenda/route";
import type { AgendaV2CompatResponse } from "@/server/agenda/types";
import { agendaEngine } from "@/server/agenda/agenda-engine";
import { getCurrentUser } from "@/server/auth/get-current-user";

// Não usar cache do Next.js — gerenciamos o cache manualmente no Supabase
export const revalidate = 0;

export type RadarMode = "general" | "personal";

export interface RadarResponse {
  mode: RadarMode;
  /** Presente no modo general */
  general?: IcsAgendaResponse;
  /** Presente no modo personal */
  personal?: AgendaV2CompatResponse;
  generatedAt: string;
  /** Espelha general.cacheVersion para inspeção rápida */
  cacheVersion?: number;
  /** Espelha general.fromCache para inspeção rápida */
  fromCache?: boolean;
  /** Sempre false — RAW_BDS_MODE removido, pipeline e unico */
  rawBdsMode?: boolean;
  /** Espelha general.sections para acesso direto sem navegar por general.sections */
  sections?: RadarSections;
}

const CACHE_ID   = "main";
const CACHE_TTL_H = 24;
const CACHE_SCHEMA_VERSION = 10; // deve ser igual ao de agenda/route.ts

// ── Lê cache Supabase do pipeline ICS (modo geral) ────────────────────────────

async function readIcsCache(): Promise<IcsAgendaResponse | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("ics_agenda_cache")
      .select("payload, cached_at")
      .eq("id", CACHE_ID)
      .single();

    if (error || !data) return null;

    const cachedAt = new Date(data.cached_at as string);
    const ageHours = (Date.now() - cachedAt.getTime()) / 3_600_000;
    if (ageHours >= CACHE_TTL_H) return null;

    const payload = data.payload as unknown as IcsAgendaResponse;
    if (payload.cacheVersion !== CACHE_SCHEMA_VERSION) return null;

    return payload;
  } catch {
    return null;
  }
}

// ── Modo Geral: busca do cache ICS ou dispara rebuild ────────────────────────

async function buildGeneralPayload(): Promise<IcsAgendaResponse> {
  const cached = await readIcsCache();
  if (cached) return { ...cached, fromCache: true };

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const res = await fetch(`${origin}/api/ics/agenda`, {
    cache: "no-store",
    headers: { "x-internal-request": "1" },
  });

  if (!res.ok) {
    throw new Error(`ICS agenda pipeline returned ${res.status}`);
  }

  const fresh = await res.json() as IcsAgendaResponse;
  return { ...fresh, fromCache: false };
}

// ── Modo Personalizado: AgendaEngine com dados do usuário ────────────────────

async function buildPersonalPayload(userId: string | null): Promise<AgendaV2CompatResponse> {
  return agendaEngine.compose(userId, { region: "BR" });
}

// ── Handler GET ───────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawMode = searchParams.get("mode") ?? "general";
    const mode: RadarMode = rawMode === "personal" ? "personal" : "general";

    if (mode === "personal") {
      // Modo personalizado — requer usuário autenticado (ou funciona anonimamente com dados limitados)
      const user = await getCurrentUser().catch(() => null);
      const personal = await buildPersonalPayload(user?.id ?? null);

      const response: RadarResponse = {
        mode: "personal",
        personal,
        generatedAt: new Date().toISOString(),
      };

      return NextResponse.json(response, {
        headers: {
          "Cache-Control": user
            ? "private, max-age=120, stale-while-revalidate=60"
            : "public, max-age=300, stale-while-revalidate=120",
        },
      });
    }

    // Modo geral (padrão)
    const general = await buildGeneralPayload();

    // Campos de topo espelham o payload interno para inspeção rápida sem navegar por general.*
    // Objeto literal explícito — garante serialização correta independente de cache do Next.js.
    return NextResponse.json({
      mode:          "general" as const,
      cacheVersion:  general.cacheVersion  ?? null,
      fromCache:     general.fromCache     ?? false,
      rawBdsMode:    false,
      sections:      general.sections      ?? null,
      generatedAt:   new Date().toISOString(),
      general,
    }, {
      headers: {
        // no-store: garante resposta fresca — sem cache na CDN ou no Next.js
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/radar] error:", err);
    return NextResponse.json(
      { error: "Radar engine error", detail: String(err) },
      { status: 500 },
    );
  }
}
