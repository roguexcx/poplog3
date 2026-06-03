import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { isAuthJsConfigured } from "@/server/auth/auth-options";
import { isLocalAuthEnabled } from "@/server/runtime/local-db-flags";

export async function GET() {
  try {
    const user = await getCurrentUser();

    return NextResponse.json({
      ok: true,
      user,
      auth: {
        local: isLocalAuthEnabled(),
        authjsConfigured: isAuthJsConfigured(),
      },
    });
  } catch {
    return NextResponse.json({
      ok: true,
      user: null,
      auth: {
        local: isLocalAuthEnabled(),
        authjsConfigured: isAuthJsConfigured(),
      },
    });
  }
}
