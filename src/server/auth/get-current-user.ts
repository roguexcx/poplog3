import { createSupabaseServerClient } from "@/server/supabase/server";
import { isLocalAuthEnabled } from "@/server/runtime/local-db-flags";
import { getLocalAuthUser } from "@/server/auth/local-user";

export async function getCurrentUser() {
  if (isLocalAuthEnabled()) {
    return getLocalAuthUser();
  }

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}