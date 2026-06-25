import net from "node:net";
import tls from "node:tls";

type RedisScalar = string | number | null;
type RedisValue = RedisScalar | RedisValue[];

const DEFAULT_TIMEOUT_MS = 300;

function redisUrl(): URL | null {
  const raw = process.env.REDIS_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "redis:" && url.protocol !== "rediss:") return null;
    return url;
  } catch {
    return null;
  }
}

export function isRedisConfigured(): boolean {
  return Boolean(redisUrl());
}

export function redisNamespace(): string {
  return (process.env.POPLOG_REDIS_PREFIX ?? "poplog:v2").replace(/:+$/, "");
}

export function namespacedRedisKey(key: string): string {
  const clean = key.replace(/^:+/, "");
  return `${redisNamespace()}:${clean}`;
}

function encodeCommand(args: Array<string | number>): Buffer {
  const parts = [`*${args.length}\r\n`];
  for (const arg of args) {
    const value = String(arg);
    parts.push(`$${Buffer.byteLength(value)}\r\n${value}\r\n`);
  }
  return Buffer.from(parts.join(""));
}

function readLine(buffer: Buffer, offset: number): [string, number] {
  const end = buffer.indexOf("\r\n", offset, "utf8");
  if (end === -1) throw new Error("RESP_INCOMPLETE");
  return [buffer.subarray(offset, end).toString("utf8"), end + 2];
}

function parseResp(buffer: Buffer, offset = 0): [RedisValue, number] {
  if (offset >= buffer.length) throw new Error("RESP_INCOMPLETE");
  const prefix = String.fromCharCode(buffer[offset]);

  if (prefix === "+" || prefix === "-" || prefix === ":") {
    const [line, next] = readLine(buffer, offset + 1);
    if (prefix === "-") throw new Error(line || "Redis error");
    return [prefix === ":" ? Number(line) : line, next];
  }

  if (prefix === "$") {
    const [line, payloadOffset] = readLine(buffer, offset + 1);
    const length = Number(line);
    if (length === -1) return [null, payloadOffset];
    const end = payloadOffset + length;
    if (buffer.length < end + 2) throw new Error("RESP_INCOMPLETE");
    return [buffer.subarray(payloadOffset, end).toString("utf8"), end + 2];
  }

  if (prefix === "*") {
    const [line, nextOffset] = readLine(buffer, offset + 1);
    const count = Number(line);
    if (count === -1) return [null, nextOffset];
    const values: RedisValue[] = [];
    let cursor = nextOffset;
    for (let i = 0; i < count; i += 1) {
      const [value, next] = parseResp(buffer, cursor);
      values.push(value);
      cursor = next;
    }
    return [values, cursor];
  }

  throw new Error(`Unsupported Redis response prefix: ${prefix}`);
}

function parseAll(buffer: Buffer): RedisValue[] {
  const values: RedisValue[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const [value, next] = parseResp(buffer, offset);
    values.push(value);
    offset = next;
  }
  return values;
}

async function sendRedisCommand(args: Array<string | number>): Promise<RedisValue> {
  const url = redisUrl();
  if (!url) throw new Error("REDIS_URL not configured");

  const timeoutMs = Math.max(50, Number(process.env.POPLOG_REDIS_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS));
  const port = Number(url.port || (url.protocol === "rediss:" ? 6380 : 6379));
  const host = url.hostname || "127.0.0.1";
  const password = url.password ? decodeURIComponent(url.password) : "";
  const username = url.username ? decodeURIComponent(url.username) : "";
  const dbIndex = url.pathname.replace("/", "").trim();

  const commandList: Buffer[] = [];
  let expectedResponses = 1;
  if (password) {
    commandList.push(username ? encodeCommand(["AUTH", username, password]) : encodeCommand(["AUTH", password]));
    expectedResponses += 1;
  }
  if (dbIndex) {
    commandList.push(encodeCommand(["SELECT", dbIndex]));
    expectedResponses += 1;
  }
  commandList.push(encodeCommand(args));

  return new Promise<RedisValue>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const socket =
      url.protocol === "rediss:"
        ? tls.connect({ host, port, servername: host })
        : net.connect({ host, port });

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };

    socket.setTimeout(timeoutMs);
    socket.on(url.protocol === "rediss:" ? "secureConnect" : "connect", () => {
      socket.write(Buffer.concat(commandList));
    });
    socket.on("timeout", () => settle(() => reject(new Error("Redis timeout"))));
    socket.on("error", (error) => settle(() => reject(error)));
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      try {
        const values = parseAll(Buffer.concat(chunks));
        if (values.length >= expectedResponses) {
          settle(() => resolve(values[values.length - 1] ?? null));
        }
      } catch (error) {
        if (error instanceof Error && error.message === "RESP_INCOMPLETE") return;
        settle(() => reject(error));
      }
    });
  });
}

export async function redisPing(): Promise<boolean> {
  if (!isRedisConfigured()) return false;
  const result = await sendRedisCommand(["PING"]);
  return result === "PONG";
}

export async function redisGetJson<T>(key: string): Promise<T | null> {
  if (!isRedisConfigured()) return null;
  const result = await sendRedisCommand(["GET", namespacedRedisKey(key)]);
  if (typeof result !== "string" || !result) return null;
  return JSON.parse(result) as T;
}

export async function redisSetJson<T>(key: string, value: T, ttlMs: number): Promise<boolean> {
  if (!isRedisConfigured()) return false;
  const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
  const result = await sendRedisCommand([
    "SET",
    namespacedRedisKey(key),
    JSON.stringify(value),
    "EX",
    ttlSeconds,
  ]);
  return result === "OK";
}

export async function redisDeleteByPattern(pattern: string): Promise<number> {
  if (!isRedisConfigured()) return 0;
  const namespacedPattern = namespacedRedisKey(pattern);
  const keys = await sendRedisCommand(["KEYS", namespacedPattern]);
  if (!Array.isArray(keys) || keys.length === 0) return 0;
  const stringKeys = keys.filter((key): key is string => typeof key === "string");
  if (!stringKeys.length) return 0;
  const result = await sendRedisCommand(["DEL", ...stringKeys]);
  return typeof result === "number" ? result : 0;
}

export async function redisKeysByPattern(pattern: string): Promise<string[]> {
  if (!isRedisConfigured()) return [];
  const namespacedPattern = namespacedRedisKey(pattern);
  const keys = await sendRedisCommand(["KEYS", namespacedPattern]);
  if (!Array.isArray(keys)) return [];
  return keys.filter((key): key is string => typeof key === "string");
}

export async function redisTtlSeconds(key: string): Promise<number | null> {
  if (!isRedisConfigured()) return null;
  const result = await sendRedisCommand(["TTL", key]);
  return typeof result === "number" ? result : null;
}
