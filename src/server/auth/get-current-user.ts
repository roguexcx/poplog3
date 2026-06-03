import { isLocalAuthEnabled } from "@/server/runtime/local-db-flags";
import { getLocalAuthUser } from "@/server/auth/local-user";
import { auth } from "@/server/auth/next-auth";
import type { AuthUser } from "@/server/auth/types";
import type { Session } from "next-auth";

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (isLocalAuthEnabled()) {
    return getLocalAuthUser();
  }

  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  if (session?.user?.id) {
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
      authProvider: "authjs",
      user_metadata: {
        full_name: session.user.name,
        name: session.user.name,
        avatar_url: session.user.image,
      },
      app_metadata: {
        provider: "google",
        providers: ["google"],
      },
    };
  }

  return null;
}
