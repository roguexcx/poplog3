import {
  isRedisConfigured,
  redisDeleteByPattern,
  redisGetJson,
  redisPing,
  redisSetJson,
} from "@/server/cache/redis-client";

async function main() {
  if (!isRedisConfigured()) {
    console.log("[redis-smoke] skipped REDIS_URL not configured");
    return;
  }

  const ping = await redisPing();
  if (!ping) throw new Error("Redis PING failed");

  const key = `smoke:${Date.now()}`;
  const payload = { ok: true, ts: new Date().toISOString() };
  const wrote = await redisSetJson(key, payload, 10_000);
  if (!wrote) throw new Error("Redis SET failed");

  const read = await redisGetJson<typeof payload>(key);
  if (!read?.ok || read.ts !== payload.ts) throw new Error("Redis GET payload mismatch");

  const deleted = await redisDeleteByPattern(key);
  if (deleted < 1) throw new Error("Redis DEL failed");

  console.log("[redis-smoke] ok");
}

main().catch((error) => {
  console.error("[redis-smoke] failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
