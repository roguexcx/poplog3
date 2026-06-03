/**
 * Helper de auth local — modo dev/desenvolvimento apenas.
 *
 * Ativado por POPLOG_LOCAL_AUTH_ENABLED=true.
 * Não substitui Supabase Auth em produção. Não implementa multiusuário.
 * Resolve o usuário a partir de LOCAL_USER_ID (padrão: "local-user").
 */
import { db } from "@/server/db/client";

const DEFAULT_LOCAL_USER_ID = "local-user";

export function getLocalUserId(): string {
  return process.env.LOCAL_USER_ID?.trim() || DEFAULT_LOCAL_USER_ID;
}

export async function getLocalAuthUser(): Promise<{ id: string } | null> {
  const id = getLocalUserId();

  try {
    // upsert: não-op se já existir; cria com email único por ID se ausente
    const user = await db.user.upsert({
      where: { id },
      update: {},
      create: { id, email: `${id}@poplog.dev`, name: "POPLOG Local Dev" },
    });
    return { id: user.id };
  } catch {
    return null;
  }
}
