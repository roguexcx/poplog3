import { NextRequest, NextResponse } from "next/server";

import { refreshQueueConfig } from "@/server/workers/refresh-queue";
import { runRefreshQueueBatch } from "@/server/workers/refresh-queue-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function configuredSecret(): string | null {
  return process.env.POPLOG_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim() || null;
}

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization")?.trim();
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function isCronRequest(request: NextRequest): boolean {
  const expected = configuredSecret();
  if (!expected) return false;
  return bearerToken(request) === expected || request.headers.get("x-cron-secret")?.trim() === expected;
}

function parsedLimit(request: NextRequest): number | undefined {
  const raw = request.nextUrl.searchParams.get("limit");
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

async function handleCron(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized_cron" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const config = refreshQueueConfig();
  const result = await runRefreshQueueBatch({
    source: "http-cron",
    recordHeartbeat: true,
    limit: parsedLimit(request) ?? Number(process.env.POPLOG_WORKER_CRON_LIMIT ?? config.maxConcurrency),
  });

  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}
