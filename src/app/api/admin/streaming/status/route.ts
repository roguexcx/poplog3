import { NextResponse } from "next/server";
import {
  getServerEnv,
  isAdminSecretConfigured,
  isValidAdminSecret,
} from "@/lib/env";
import { getStreamingSyncStatus } from "@/lib/streaming-sync";

function safeFlags() {
  const env = getServerEnv();
  return {
    adminSecretConfigured: Boolean(env.adminSecret),
    watchmodeEnabled: env.watchmodeEnabled,
    movieOfTheNightEnabled: env.movieOfTheNightEnabled,
    streamingSyncEnabled: env.streamingSyncEnabled,
    streamingDebugLogs: env.streamingDebugLogs,
  };
}

export async function GET(request: Request) {
  if (!isAdminSecretConfigured()) {
    return NextResponse.json({
      ok: true,
      flags: safeFlags(),
      database: "unavailable_without_admin_secret",
    });
  }

  if (!isValidAdminSecret(request.headers.get("x-admin-secret"))) {
    return NextResponse.json({ error: "Admin secret invalido ou ausente." }, { status: 401 });
  }

  const status = await getStreamingSyncStatus();
  return NextResponse.json({
    ...status,
    flags: safeFlags(),
  });
}
