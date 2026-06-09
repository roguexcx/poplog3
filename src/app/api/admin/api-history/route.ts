/**
 * GET /api/admin/api-history?days=30
 *
 * Historico geral de uso de todas as APIs externas do POPLOG.
 * Combina logs raw (ultimos 90 dias) + agregados diarios (mais antigos).
 * Protegido por x-admin-secret.
 */
import { NextRequest, NextResponse } from "next/server";
import { getApiHistory, compactApiCallLogs } from "@/server/engine-logger";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  return req.headers.get("x-admin-secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const daysParam = req.nextUrl.searchParams.get("days");
  const days = Math.min(Math.max(Number(daysParam ?? 30) || 30, 1), 365);

  const data = await getApiHistory(days);

  if (!data) {
    return NextResponse.json(
      { ok: false, error: "Historico indisponivel. Verifique a conexao com o banco." },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, ...data }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/admin/api-history/compact
 * Compacta logs raw antigos em api_usage_daily e remove os que excederam 90 dias.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await compactApiCallLogs(90);

  return NextResponse.json({ ok: result.ok, detail: result.detail });
}
