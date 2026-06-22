import { AsyncLocalStorage } from "async_hooks";
import type { Origin } from "./types";

type RequestCtx = { origin: Origin };

// Singleton no globalThis para sobreviver ao HMR do Next.js dev.
const g = globalThis as typeof globalThis & { __engineCtx?: AsyncLocalStorage<RequestCtx> };
if (!g.__engineCtx) g.__engineCtx = new AsyncLocalStorage<RequestCtx>();
const storage = g.__engineCtx;

export function withOrigin<T>(origin: Origin, fn: () => Promise<T>): Promise<T> {
  return storage.run({ origin }, fn);
}

export function getOrigin(): Origin {
  return storage.getStore()?.origin ?? "unknown";
}
