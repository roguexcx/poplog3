// ── /api/radar ─────────────────────────────────────────────────────────────────
// Endpoint unificado do Radar com suporte a dois modos:
//
//   GET /api/radar?mode=general    → Radar Geral: feed ICS + TMDB, sem personalização.
//   GET /api/radar?mode=personal   → Radar Personalizado: AgendaEngine com dados do usuário.
//
// O cliente usa este endpoint para alternar entre os dois modos com um clique.
// A escolha do modo muda a origem e montagem dos dados, não apenas rótulos visuais.
//
// MODO BRUTO (ativo agora):
//   - Sem filtros editoriais de idioma, popularidade, gênero ou plataforma.
//   - Apenas deduplicação técnica e validação mínima.
//   - Pronto para receber filtros graduais no futuro.
// ──────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/server/supabase/admin";
import type { IcsAgendaResponse } from "@/app/api/ics/agenda/route";
import type { AgendaV2CompatResponse } from "@/server/agenda/types";
import { agendaEngine } from "@/server/agenda/agenda-engine";
import { getCurrentUser } from "@/server/auth/get-current-user";

export type RadarMode = "general" | "personal";

export interface RadarResponse {
  mode: RadarMode;
  /** Presente no modo general */
  general?: IcsAgendaResponse;
  /** Presente no modo personal */
  personal?: AgendaV2CompatResponse;
  generatedAt: string;
}

const CACHE_ID   = "main";
const CACHE_TTL_H = 24;

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

    return data.payload as unknown as IcsAgendaResponse;
  } catch {
    return null;
  }
}

// ── Modo Geral: busca do cache ICS ou dispara rebuild ────────────────────────

async function buildGeneralPayload(): Promise<IcsAgendaResponse> {
  // Tenta cache quente
  const cached = await readIcsCache();
  if (cached) return { ...cached, fromCache: true };

  // Cache stale — dispara rebuild via rota existente
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const res = await fetch(`${origin}/api/ics/agenda`, {
    cache: "no-store",
    headers: { "x-internal-request": "1" },
  });
  if (!res.ok) {
    throw new Error(`ICS agenda pipeline returned ${res.status}`);
  }
  return res.json() as Promise<IcsAgendaResponse>;
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

    const response: RadarResponse = {
      mode: "general",
      general,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
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
