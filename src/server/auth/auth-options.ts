import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";

import { db } from "@/server/db/client";

function googleProvider() {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;

  if (!clientId || !clientSecret) return null;

  return Google({ clientId, clientSecret, allowDangerousEmailAccountLinking: true });
}

export function isAuthJsConfigured(): boolean {
  return Boolean(process.env.AUTH_SECRET && process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

const providers = [googleProvider()].filter(
  (provider): provider is NonNullable<typeof provider> => provider !== null,
);

export const authOptions = {
  adapter: PrismaAdapter(db),
  providers,
  session: {
    strategy: "database",
  },
  trustHost: true,
  pages: {
    signIn: "/",
  },
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }

      return session;
    },
  },
} satisfies NextAuthConfig;
