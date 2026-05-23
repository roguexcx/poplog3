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
  parsePositiveInteger,
} from "@/server/library/validators";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tmdbId = parsePositiveInteger(
      request.nextUrl.searchParams.get("tmdbId")
    );
    const mediaType = request.nextUrl.searchParams.get("mediaType");

    if (!tmdbId || !isValidMediaType(mediaType)) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 });
    }

    const title = await getUserTitleStatus(user.id, tmdbId, mediaType);

    return NextResponse.json({
      success: true,
      data: title,
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

    const tmdbId = parsePositiveInteger(body.tmdbId);
    const mediaType = body.mediaType;
    const status = body.status;

    if (
      !tmdbId ||
      !isValidMediaType(mediaType) ||
      !isValidLibraryStatus(status)
    ) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    // liked and favorite are managed exclusively via /api/user/feedback
    // (central feedback engine). Ignoring them here prevents bypassing the
    // editorial engine and ensures raw feedback is never overwritten outside it.
    const title = await upsertUserTitleStatus({
      userId: user.id,
      tmdbId,
      mediaType,
      status,
      rating: body.rating ?? null,
      notes: body.notes ?? null,
    });

    return NextResponse.json({
      success: true,
      data: title,
    });
  } catch (error) {
    console.error("[LIBRARY_TITLE_POST_ERROR]", error);

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

    const tmdbId = parsePositiveInteger(body.tmdbId);
    const mediaType = body.mediaType;

    if (!tmdbId || !isValidMediaType(mediaType)) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    await removeUserTitle(user.id, tmdbId, mediaType);

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("[LIBRARY_TITLE_DELETE_ERROR]", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}