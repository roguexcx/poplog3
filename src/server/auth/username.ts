import { Prisma } from "@prisma/client";

import { db } from "@/server/db/client";

const MAX_USERNAME_LENGTH = 64;

function normalizeUsername(candidate: string): string {
  return candidate
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_USERNAME_LENGTH);
}

function usernameBase(input: {
  id: string;
  email?: string | null;
  name?: string | null;
}): string {
  const emailBase = input.email ? normalizeUsername(input.email.split("@")[0] ?? "") : "";
  if (emailBase) return emailBase;
  const nameBase = input.name ? normalizeUsername(input.name) : "";
  if (nameBase) return nameBase;
  return normalizeUsername(`user-${input.id.slice(0, 8)}`) || "user";
}

function candidateWithSuffix(base: string, suffix: number): string {
  if (suffix === 1) return base;
  const tail = `-${suffix}`;
  return `${base.slice(0, MAX_USERNAME_LENGTH - tail.length)}${tail}`;
}

/** Garante username para usuários novos sem tornar a coluna obrigatória nesta fase. */
export async function ensureUserUsername(input: {
  userId: string;
  email?: string | null;
  name?: string | null;
}): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { username: true, email: true, name: true },
  });
  if (!user) return null;
  if (user.username) return user.username;

  const base = usernameBase({
    id: input.userId,
    email: input.email ?? user.email,
    name: input.name ?? user.name,
  });

  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const username = candidateWithSuffix(base, suffix);
    try {
      const updated = await db.user.updateMany({
        where: { id: input.userId, username: null },
        data: { username },
      });
      if (updated.count === 1) return username;
      return (await db.user.findUnique({
        where: { id: input.userId },
        select: { username: true },
      }))?.username ?? null;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Could not generate a unique username for user ${input.userId}`);
}
