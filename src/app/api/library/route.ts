import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { getUserLibrary } from "@/server/library/library-service";
import { isValidLibraryStatus } from "@/server/library/validators";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
        }
      );
    }

    const status = request.nextUrl.searchParams.get("status");

    if (status && !isValidLibraryStatus(status)) {
      return NextResponse.json(
        {
          error: "Invalid status",
        },
        {
          status: 400,
        }
      );
    }

    const library = await getUserLibrary(user.id, status ?? undefined);

    return NextResponse.json({
      success: true,
      data: library,
    });
  } catch (error) {
    console.error("[LIBRARY_GET_ERROR]", error);

    return NextResponse.json(
      {
        error: "Internal server error",
      },
      {
        status: 500,
      }
    );
  }
}