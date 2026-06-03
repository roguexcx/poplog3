"use client";

// Supabase foi removido do projeto. Use Auth.js/NextAuth.
export function createClient(): never {
  throw new Error(
    "createClient: Supabase foi removido. Use signIn/signOut de next-auth/react.",
  );
}
