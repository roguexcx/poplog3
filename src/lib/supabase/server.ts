// Supabase foi removido do projeto.
export async function createSupabaseServerClient(): Promise<never> {
  throw new Error(
    "createSupabaseServerClient: Supabase foi removido. Use Auth.js + Prisma.",
  );
}
