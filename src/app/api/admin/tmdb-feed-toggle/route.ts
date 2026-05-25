// ── GET|POST /api/admin/tmdb-feed-toggle ─────────────────────────────────────
// Controla o feed TMDB Trending em runtime, sem reiniciar o servidor.
//
// GET  → retorna o estado atual { enabled, source }
// POST → alterna ou define o flag { enabled: boolean }
//
// Autenticação: header x-admin-secret === process.env.ADMIN_SECRET
//
// ⚠️  Runtime-only: em ambientes serverless (Vercel Lambda) o override dura
//     enquanto o processo viver (cold-start apaga). Para persistência, use
//     ENABLE_TMDB_TRENDING_FEED=true no .env.
// ──────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import {
  isTmdbFeedEnabled,
  setTmdbFeedEnabled,
  resetTmdbFeedOverride,
  TMDB_TRENDING_FEED_ENABLED_BY_ENV,
} from "@/lib/radar/tmdb-trending-feed";

function isAuthorized(req: Request): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  return req.headers.get("x-admin-secret") === secret;
}

/** GET — retorna o estado atual do flag. */
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const enabled = isTmdbFeedEnabled();
  const envValue = TMDB_TRENDING_FEED_ENABLED_BY_ENV;

  return NextResponse.json({
    ok: true,
    enabled,
    envEnabled: envValue,
    source: enabled === envValue ? "env" : "runtime_override",
    token: process.env.TMDB_ACCESS_TOKEN ? "configurado" : "ausente",
  });
}

/** POST — define o flag. Body: { enabled: boolean } ou { reset: true } */
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { enabled?: boolean; reset?: boolean } = {};
  try {
    body = await req.json() as { enabled?: boolean; reset?: boolean };
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (body.reset) {
    resetTmdbFeedOverride();
    return NextResponse.json({
      ok: true,
      enabled: isTmdbFeedEnabled(),
      source: "env",
      message: "Override removido — usando valor do .env",
    });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "Campo 'enabled' deve ser boolean" }, { status: 400 });
  }

  setTmdbFeedEnabled(body.enabled);

  return NextResponse.json({
    ok: true,
    enabled: body.enabled,
    source: "runtime_override",
    message: `Feed TMDB ${body.enabled ? "ligado" : "desligado"} (runtime)`,
  });
}
