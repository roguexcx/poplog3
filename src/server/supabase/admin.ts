import { createClient } from "@supabase/supabase-js";

// Não lança erro em init — permite que módulos com import estático carreguem em modo local
// sem precisar de credenciais Supabase. Erros de conexão ocorrem apenas na primeira chamada.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "placeholder-service-role-key";

export const supabaseAdmin = createClient(
  supabaseUrl,
  serviceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);