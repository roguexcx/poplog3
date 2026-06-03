"use client";

// Supabase foi removido do projeto.
export function createClient(): never {
  throw new Error(
    "createClient: Supabase foi removido. Use signIn/signOut de next-auth/react.",
  );
}
