// Supabase foi removido do projeto. Use Auth.js/NextAuth + Prisma.
export async function createSupabaseServerClient(): Promise<never> {
  throw new Error(
    "createSupabaseServerClient: Supabase foi removido. Use Auth.js (@/server/auth/next-auth) + Prisma.",
  );
}
