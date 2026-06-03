import { createSupabaseServerClient } from "@/server/supabase/server";
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name:
      typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : typeof user.user_metadata?.name === "string"
          ? user.user_metadata.name
          : null,
    image:
      typeof user.user_metadata?.avatar_url === "string"
        ? user.user_metadata.avatar_url
        : null,
    created_at: user.created_at,
    user_metadata: user.user_metadata,
    app_metadata: user.app_metadata,
    authProvider: "supabase",
  };
}
