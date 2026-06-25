import { PrismaClient } from "@prisma/client";
import { isEnvFlagEnabled } from "@/server/logging/logger";
import { sourceEngineLog } from "@/server/source-engine/source-log";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const SLOW_QUERY_MS = Number(process.env.PRISMA_SLOW_QUERY_MS ?? 350);

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: isEnvFlagEnabled("PRISMA_QUERY_LOGS")
      ? [
          { emit: "event", level: "query" },
          { emit: "stdout", level: "error" },
          { emit: "stdout", level: "warn" },
        ]
      : [{ emit: "stdout", level: "warn" }],
  });

  if (isEnvFlagEnabled("PRISMA_QUERY_LOGS")) {
    (client as unknown as {
      $on: (event: "query", listener: (query: { duration: number; model?: string }) => void) => void;
    }).$on("query", (query) => {
      if (query.duration >= SLOW_QUERY_MS) {
        sourceEngineLog("db_query_slow", {
          model: query.model ?? "unknown",
          duration: `${query.duration}ms`,
        }, "warn");
      }
    });
  }

  return client;
}

export function getDb(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

export const db = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = client[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
  set(_target, prop, value) {
    const client = getDb() as unknown as Record<PropertyKey, unknown>;
    client[prop] = value;
    return true;
  },
});

export type DbClient = typeof db;
