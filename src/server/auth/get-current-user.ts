import { isLocalAuthEnabled } from "@/server/runtime/local-db-flags";
import { getLocalAuthUser } from "@/server/auth/local-user";
import { auth } from "@/server/auth/next-auth";
import { db } from "@/server/db/client";
import type { AuthUser } from "@/server/auth/types";
import type { Session } from "next-auth";

async function isBlockedUser(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { accessStatus: true },
  }).catch(() => null);
  return user?.accessStatus === "blocked";
}

async function userAccessFields(userId: string) {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      accessStatus: true,
      adminPermissions: true,
    },
  }).catch(() => null);
}

function permissionsFromJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (isLocalAuthEnabled()) {
    return getLocalAuthUser();
  }

  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  if (session?.user?.id) {
    const access = await userAccessFields(session.user.id);
    if (access?.accessStatus === "blocked") return null;

    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
      role: access?.role ?? "user",
      accessStatus: access?.accessStatus ?? "active",
      adminPermissions: permissionsFromJson(access?.adminPermissions),
      authProvider: "authjs",
      user_metadata: {
        full_name: session.user.name,
        name: session.user.name,
        avatar_url: session.user.image,
      },
      app_metadata: {
        provider: "google",
        providers: ["google"],
      },
    };
  }

  return null;
}
