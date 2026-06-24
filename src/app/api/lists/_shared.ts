import { NextResponse } from "next/server";
import type { MediaType } from "@prisma/client";

import { getCurrentUser } from "@/server/auth/get-current-user";
import type { AuthUser } from "@/server/auth/types";
import { ListServiceError } from "@/server/lists/list-service";
import { logRouteResult } from "@/server/logging/route-logger";
import { resolveUserStateIdentity } from "@/server/user-state/poplog-user-state-identity";

export type RouteLogContext = {
  method: string;
  path: string;
  startedAt: number;
};

export function jsonSuccess(
  context: RouteLogContext,
  data: unknown,
  status = 200,
): NextResponse {
  logRouteResult({ ...context, status });
  return NextResponse.json({ success: true, data }, { status });
}

export function jsonError(context: RouteLogContext, error: unknown): NextResponse {
  const status = error instanceof ListServiceError ? error.status : 500;
  const message = error instanceof ListServiceError ? error.message : "Internal server error";
  logRouteResult({ ...context, status, reason: message });
  if (!(error instanceof ListServiceError)) console.error(`[lists] ${context.method} ${context.path}`, error);
  return NextResponse.json({ error: message }, { status });
}

export async function requireListUser(
  context: RouteLogContext,
): Promise<{ user: AuthUser; response?: never } | { user?: never; response: NextResponse }> {
  const user = await getCurrentUser();
  if (user) return { user };
  return { response: jsonError(context, new ListServiceError("Unauthorized", 401)) };
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ListServiceError("Request body must be a JSON object", 400);
  }
  return body as Record<string, unknown>;
}

export function stringIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ListServiceError(`${label} must be an array of strings`, 400);
  }
  return value as string[];
}

export async function resolveTitleFromPayload(payload: Record<string, unknown>): Promise<{
  tmdbId: number;
  mediaType: MediaType;
}> {
  const mediaType = payload.mediaType ?? payload.media_type;
  if (mediaType !== "movie" && mediaType !== "tv") {
    throw new ListServiceError("mediaType must be movie or tv", 400);
  }

  const identity = await resolveUserStateIdentity({
    mediaType,
    poplogId: payload.poplogId,
    tmdbId: payload.tmdbId ?? payload.tmdb_id,
    imdbId: payload.imdbId,
    slug: payload.slug,
    title: payload.title,
    year: payload.year,
  });
  if (!identity?.tmdbId) {
    throw new ListServiceError("A valid title identity is required", 400);
  }
  return { tmdbId: identity.tmdbId, mediaType };
}

export function parseMembershipTitles(value: string | null): Array<{
  tmdbId: number;
  mediaType: MediaType;
}> {
  if (!value) return [];
  return value.split(",").map((entry) => {
    const [rawId, rawMediaType, ...rest] = entry.trim().split(":");
    const tmdbId = Number(rawId);
    if (
      rest.length > 0 ||
      !Number.isInteger(tmdbId) ||
      tmdbId === 0 ||
      (rawMediaType !== "movie" && rawMediaType !== "tv")
    ) {
      throw new ListServiceError("titles must use the format tmdbId:movie,tmdbId:tv", 400);
    }
    return { tmdbId, mediaType: rawMediaType };
  });
}
