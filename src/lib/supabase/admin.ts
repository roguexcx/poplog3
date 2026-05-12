import { createClient } from "@supabase/supabase-js";

function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error("Supabase admin client so pode ser usado no servidor.");
  }
}

export function createSupabaseAdminClient() {
  assertServerRuntime();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY ou NEXT_PUBLIC_SUPABASE_URL nao configurados.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
