// Supabase foi removido do projeto. Use Prisma via @/server/db/client.
// Este arquivo é um stub de compatibilidade — qualquer acesso lançará erro.
export const supabaseAdmin = new Proxy({} as Record<string, unknown>, {
  get(_target, prop) {
    throw new Error(
      `supabaseAdmin.${String(prop)}: Supabase foi removido. Use Prisma (@/server/db/client).`,
    );
  },
});
