import { NextResponse } from "next/server";
import { isAdminSecretConfigured, isValidAdminSecret } from "@/lib/env";
import {
  refreshManyStreamingAvailability,
  refreshSingleTitleAvailability,
  type StreamingRefreshProfile,
} from "@/lib/streaming-sync";

type RefreshPayload = {
  tmdbId?: unknown;
  mediaType?: unknown;
  country?: unknown;
  force?: unknown;
  dryRun?: unknown;
  limit?: unknown;
  profile?: unknown;
};

const MAX_REFRESH_LIMIT = 50;
const REFRESH_PROFILES = new Set(["quick", "normal", "deep", "single", "dryRun"]);

function parseBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function parseCountry(value: unknown): string {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value) ? value : "BR";
}

function parseLimit(value: unknown): number {
  const limit = typeof value === "number" ? value : Number(value ?? 10);
  if (!Number.isFinite(limit)) return 10;
  return Math.max(1, Math.min(Math.floor(limit), MAX_REFRESH_LIMIT));
}

function parseProfile(value: unknown): StreamingRefreshProfile {
  if (typeof value === "string" && REFRESH_PROFILES.has(value)) {
    return value as StreamingRefreshProfile;
  }
  return "normal";
}

function unauthorized(message = "Admin secret invalido ou ausente.") {
  return NextResponse.json({ error: message }, { status: 401 });
}

function validateAdmin(request: Request) {
  if (!isAdminSecretConfigured()) {
    return unauthorized("ADMIN_SECRET nao configurado.");
  }
  if (!isValidAdminSecret(request.headers.get("x-admin-secret"))) {
    return unauthorized();
  }
  return null;
}

export async function POST(request: Request) {
  const authError = validateAdmin(request);
  if (authError) return authError;

  let payload: RefreshPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload JSON invalido." }, { status: 400 });
  }

  const country = parseCountry(payload.country);
  const force = parseBoolean(payload.force);
  const profile = parseProfile(payload.profile);
  const dryRun = parseBoolean(payload.dryRun) || profile === "dryRun";

  if (profile === "single" || payload.tmdbId !== undefined || payload.mediaType !== undefined) {
    const tmdbId = Number(payload.tmdbId);
    const mediaType = payload.mediaType;

    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      return NextResponse.json({ error: "tmdbId invalido." }, { status: 400 });
    }
    if (mediaType !== "movie" && mediaType !== "tv") {
      return NextResponse.json({ error: "mediaType deve ser movie ou tv." }, { status: 400 });
    }

    const result = await refreshSingleTitleAvailability({
      tmdbId,
      mediaType,
      country,
      force,
      dryRun,
      profile,
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }

  const result = await refreshManyStreamingAvailability({
    country,
    force,
    dryRun,
    profile,
    limit: parseLimit(payload.limit),
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
