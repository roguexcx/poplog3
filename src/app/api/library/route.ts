import { NextRequest, NextResponse } from "next/server";

// Força renderização dinâmica — sem cache de rota (dados são user-specific).
export const dynamic = "force-dynamic";

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

    return NextResponse.json(
      { success: true, data: library },
      {
        headers: {
          // Sem cache público — dados são user-specific. O browser pode reter por
          // até 30s para evitar chamadas duplicadas no mesmo ciclo de navegação.
          "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
        },
      },
    );
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