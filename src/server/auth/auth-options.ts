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

function isKnownHarmlessAuthError(error: Error): boolean {
  // Session cookie exists but DB session is gone (expired/reset) — not a real error.
  if (error.name === "AdapterError") return true;
  // Session token can't be decoded — stale cookie from another env or changed secret.
  if (error.name === "SessionTokenError") return true;
  // DB connectivity — not suppressible but harmless noise during local dev.
  const parts = [
    error?.message ?? "",
    String((error as { cause?: unknown })?.cause ?? ""),
  ].join(" ");
  return (
    parts.includes("PrismaClientInitializationError") ||
    parts.includes("Can't reach database") ||
    parts.includes("ECONNREFUSED")
  );
}

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
  logger: {
    error(error: Error) {
      if (isKnownHarmlessAuthError(error)) return;
      console.error("[auth]", error);
    },
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
