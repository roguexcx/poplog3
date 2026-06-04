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

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const mediaType = request.nextUrl.searchParams.get("mediaType");
    const debugSource = request.nextUrl.searchParams.get("debugSource") === "1";

    if (!isValidMediaType(mediaType)) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 });
    }

    const identity = await resolveUserStateIdentity({
      mediaType,
      poplogId: request.nextUrl.searchParams.get("poplogId"),
      tmdbId: request.nextUrl.searchParams.get("tmdbId"),
      imdbId: request.nextUrl.searchParams.get("imdbId"),
      slug: request.nextUrl.searchParams.get("slug"),
    });

    if (!identity?.tmdbId) {
      return NextResponse.json({
        error: "Unable to resolve legacy user-state alias",
        ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
      }, { status: 400 });
    }

    const title = await getUserTitleStatus(user.id, identity.tmdbId, mediaType);

    return NextResponse.json({
      success: true,
      data: title,
      ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
    });
  } catch (error) {
    console.error("[LIBRARY_TITLE_GET_ERROR]", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
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

    if (!identity?.tmdbId) {
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

    return NextResponse.json({
      success: true,
      data: title,
      ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
    });
  } catch (error) {
    console.error("[LIBRARY_TITLE_POST_ERROR]", error);

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
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    const mediaType = body.mediaType;
    const favorite = body.favorite;
    const debugSource = body.debugSource === true;

    if (!isValidMediaType(mediaType) || typeof favorite !== "boolean") {
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

    if (!identity?.tmdbId) {
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

    return NextResponse.json({
      success: true,
      data: title,
      ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
    });
  } catch (error) {
    console.error("[LIBRARY_TITLE_PATCH_ERROR]", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    const mediaType = body.mediaType;
    const debugSource = body.debugSource === true;

    if (!isValidMediaType(mediaType)) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const identity = await resolveUserStateIdentity({
      mediaType,
      poplogId: body.poplogId,
      tmdbId: body.tmdbId,
      imdbId: body.imdbId,
      slug: body.slug,
    });

    if (!identity?.tmdbId) {
      return NextResponse.json({
        error: "Unable to resolve legacy user-state alias",
        ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
      }, { status: 400 });
    }

    await removeUserTitle(user.id, identity.tmdbId, mediaType);

    return NextResponse.json({
      success: true,
      ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
    });
  } catch (error) {
    console.error("[LIBRARY_TITLE_DELETE_ERROR]", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
