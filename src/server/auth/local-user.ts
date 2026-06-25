/**
 * Helper de auth local — modo dev/desenvolvimento apenas.
 *
 * Ativado por POPLOG_LOCAL_AUTH_ENABLED=true.
 * Não substitui o auth de produção. Não implementa multiusuário.
 * Resolve o usuário a partir de LOCAL_USER_ID (padrão: "local-user").
 */
import { db } from "@/server/db/client";
import type { AuthUser } from "@/server/auth/types";
import { ensureUserUsername } from "@/server/auth/username";

const DEFAULT_LOCAL_USER_ID = "local-user";

export function getLocalUserId(): string {
  return process.env.LOCAL_USER_ID?.trim() || DEFAULT_LOCAL_USER_ID;
}

export async function getLocalAuthUser(): Promise<AuthUser | null> {
  const id = getLocalUserId();

  try {
    // upsert: não-op se já existir; cria com email único por ID se ausente
    const user = await db.user.upsert({
      where: { id },
      update: {},
      create: { id, email: `${id}@poplog.dev`, name: "POPLOG Local Dev" },
    });
    if (user.accessStatus === "blocked") return null;

    if (!user.username) {
      await ensureUserUsername({ userId: user.id, email: user.email, name: user.name });
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: user.role,
      accessStatus: user.accessStatus,
      adminPermissions: Array.isArray(user.adminPermissions)
        ? user.adminPermissions.filter((item): item is string => typeof item === "string")
        : [],
      created_at: user.createdAt.toISOString(),
      authProvider: "local",
      user_metadata: {
        name: user.name,
      },
      app_metadata: {
        provider: "local",
        providers: ["local"],
      },
    };
  } catch {
    return null;
  }
}
