import { PrismaClient } from "@prisma/client";
import { isEnvFlagEnabled } from "@/server/logging/logger";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isEnvFlagEnabled("PRISMA_QUERY_LOGS") ? ["query", "error", "warn"] : ["warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

export type DbClient = typeof db;
