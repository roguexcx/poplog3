import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import {
  getUserTitleStatus,
  removeUserTitle,
  upsertUserTitleStatus,
} from "@/server/library/library-service";
import {
  isValidLibraryStatus,
  isValidMediaType,
} from "@/server/library/validators";
import type { Poplog3LibraryStatus } from "@/server/library/types";
import {
  resolveUserStateIdentity,
  userStateIdentityDebug,
} from "@/server/user-state/poplog-user-state-identity";
import { compactError, logger } from "@/server/logging/logger";
import { logRouteResult } from "@/server/logging/route-logger";

const ROUTE_PATH = "/api/library/title";

function receivedTmdbId(request: NextRequest) {
  return request.nextUrl.searchParams.get("tmdbId");
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const user = await getCurrentUser();

    if (!user) {
      logRouteResult({ method: "GET", path: ROUTE_PATH, status: 401, startedAt, reason: "unauthorized" });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const mediaType = request.nextUrl.searchParams.get("mediaType");
    const debugSource = request.nextUrl.searchParams.get("debugSource") === "1";

    if (!isValidMediaType(mediaType)) {
      logRouteResult({ method: "GET", path: ROUTE_PATH, status: 400, startedAt, reason: "invalid mediaType", received: mediaType });
      return NextResponse.json({ error: "Invalid params" }, { status: 400 });
    }

    const identity = await resolveUserStateIdentity({
      mediaType,
      poplogId: request.nextUrl.searchParams.get("poplogId"),
      tmdbId: request.nextUrl.searchParams.get("tmdbId"),
      imdbId: request.nextUrl.searchParams.get("imdbId"),
      slug: request.nextUrl.searchParams.get("slug"),
    });

    if (identity?.tmdbId == null) {
      logRouteResult({
        method: "GET",
        path: ROUTE_PATH,
        status: 400,
        startedAt,
        reason: "invalid tmdbId",
        received: receivedTmdbId(request),
      });
      return NextResponse.json({
        error: "Unable to resolve legacy user-state alias",
        ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
      }, { status: 400 });
    }

    const title = await getUserTitleStatus(user.id, identity.tmdbId, mediaType);

    logRouteResult({ method: "GET", path: ROUTE_PATH, status: 200, startedAt });
    return NextResponse.json({
      success: true,
      data: title,
      ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
    });
  } catch (error) {
    logger.error(`[LIBRARY:ERROR] GET title | failed | reason=${compactError(error)}`);
    logRouteResult({ method: "GET", path: ROUTE_PATH, status: 500, startedAt, reason: compactError(error) });

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const user = await getCurrentUser();

    if (!user) {
      logRouteResult({ method: "POST", path: ROUTE_PATH, status: 401, startedAt, reason: "unauthorized" });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    const mediaType = body.mediaType;
    const status = body.status;
    const debugSource = body.debugSource === true;

    if (
      !isValidMediaType(mediaType) ||
      !isValidLibraryStatus(status)
    ) {
      logRouteResult({ method: "POST", path: ROUTE_PATH, status: 400, startedAt, reason: "invalid body" });
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const identity = await resolveUserStateIdentity({
      mediaType,
      poplogId: body.poplogId,
      tmdbId: body.tmdbId,
      imdbId: body.imdbId,
      slug: body.slug,
      title: body.title,
      year: body.releaseYear,
    });

    if (identity?.tmdbId == null) {
      logRouteResult({
        method: "POST",
        path: ROUTE_PATH,
        status: 400,
        startedAt,
        reason: "invalid tmdbId",
        received: body.tmdbId ?? null,
      });
      return NextResponse.json({
        error: "Unable to resolve legacy user-state alias",
        ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
      }, { status: 400 });
    }

    // liked and favorite are managed exclusively via /api/user/feedback
    // (central feedback engine). Ignoring them here prevents bypassing the
    // editorial engine and ensures raw feedback is never overwritten outside it.
    const title = await upsertUserTitleStatus({
      userId: user.id,
      tmdbId: identity.tmdbId,
      mediaType,
      status,
      rating: body.rating ?? null,
      notes: body.notes ?? null,
    });

    logger.debug(`[LIBRARY] title.${mediaType} ${identity.tmdbId} | status=${status} | ok`);
    logRouteResult({ method: "POST", path: ROUTE_PATH, status: 200, startedAt });
    return NextResponse.json({
      success: true,
      data: title,
      ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
    });
  } catch (error) {
    logger.error(`[LIBRARY:ERROR] POST title | failed | reason=${compactError(error)}`);
    logRouteResult({ method: "POST", path: ROUTE_PATH, status: 500, startedAt, reason: compactError(error) });

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/library/title
 * Alterna o campo `favorite` sem alterar o status atual — exceto quando
 * favorite=true, onde o título é automaticamente marcado como "watched".
 */
export async function PATCH(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const user = await getCurrentUser();

    if (!user) {
      logRouteResult({ method: "PATCH", path: ROUTE_PATH, status: 401, startedAt, reason: "unauthorized" });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    const mediaType = body.mediaType;
    const favorite = body.favorite;
    const debugSource = body.debugSource === true;

    if (!isValidMediaType(mediaType) || typeof favorite !== "boolean") {
      logRouteResult({ method: "PATCH", path: ROUTE_PATH, status: 400, startedAt, reason: "invalid body" });
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const identity = await resolveUserStateIdentity({
      mediaType,
      poplogId: body.poplogId,
      tmdbId: body.tmdbId,
      imdbId: body.imdbId,
      slug: body.slug,
      title: body.title,
      year: body.releaseYear,
    });

    if (identity?.tmdbId == null) {
      logRouteResult({
        method: "PATCH",
        path: ROUTE_PATH,
        status: 400,
        startedAt,
        reason: "invalid tmdbId",
        received: body.tmdbId ?? null,
      });
      return NextResponse.json({
        error: "Unable to resolve legacy user-state alias",
        ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
      }, { status: 400 });
    }

    let targetStatus: Poplog3LibraryStatus;

    if (favorite) {
      // Favoritar auto-marca como assistido
      targetStatus = "watched";
    } else {
      // Desfavoritar preserva status atual (ou "watched" como fallback seguro)
      const current = await getUserTitleStatus(user.id, identity.tmdbId, mediaType);
      const currentStatus = current?.status;
      targetStatus = isValidLibraryStatus(currentStatus) ? currentStatus : "watched";
    }

    const title = await upsertUserTitleStatus({
      userId: user.id,
      tmdbId: identity.tmdbId,
      mediaType,
      status: targetStatus,
      favorite,
    });

    logger.debug(`[LIBRARY] title.${mediaType} ${identity.tmdbId} | favorite=${favorite} | ok`);
    logRouteResult({ method: "PATCH", path: ROUTE_PATH, status: 200, startedAt });
    return NextResponse.json({
      success: true,
      data: title,
      ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
    });
  } catch (error) {
    logger.error(`[LIBRARY:ERROR] PATCH title | failed | reason=${compactError(error)}`);
    logRouteResult({ method: "PATCH", path: ROUTE_PATH, status: 500, startedAt, reason: compactError(error) });

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const user = await getCurrentUser();

    if (!user) {
      logRouteResult({ method: "DELETE", path: ROUTE_PATH, status: 401, startedAt, reason: "unauthorized" });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    const mediaType = body.mediaType;
    const debugSource = body.debugSource === true;

    if (!isValidMediaType(mediaType)) {
      logRouteResult({ method: "DELETE", path: ROUTE_PATH, status: 400, startedAt, reason: "invalid body" });
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const identity = await resolveUserStateIdentity({
      mediaType,
      poplogId: body.poplogId,
      tmdbId: body.tmdbId,
      imdbId: body.imdbId,
      slug: body.slug,
    });

    if (identity?.tmdbId == null) {
      logRouteResult({
        method: "DELETE",
        path: ROUTE_PATH,
        status: 400,
        startedAt,
        reason: "invalid tmdbId",
        received: body.tmdbId ?? null,
      });
      return NextResponse.json({
        error: "Unable to resolve legacy user-state alias",
        ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
      }, { status: 400 });
    }

    await removeUserTitle(user.id, identity.tmdbId, mediaType);

    logger.debug(`[LIBRARY] title.${mediaType} ${identity.tmdbId} | removed | ok`);
    logRouteResult({ method: "DELETE", path: ROUTE_PATH, status: 200, startedAt });
    return NextResponse.json({
      success: true,
      ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
    });
  } catch (error) {
    logger.error(`[LIBRARY:ERROR] DELETE title | failed | reason=${compactError(error)}`);
    logRouteResult({ method: "DELETE", path: ROUTE_PATH, status: 500, startedAt, reason: compactError(error) });

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
