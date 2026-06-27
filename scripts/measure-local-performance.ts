import "dotenv/config";

type Endpoint = {
  name: string;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  expectedStatuses?: number[];
  note?: string;
};

const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

const endpoints: Endpoint[] = [
  { name: "Home", path: "/" },
  { name: "Trending", path: "/api/trending?includeProviders=0&fast=1&language=pt-BR&region=BR" },
  { name: "Busca", path: "/api/search?q=superman&language=pt-BR&region=BR" },
  { name: "Providers tt0993846", path: "/api/providers?id=tt0993846&media_type=movie&region=BR&debug=1&force_live=1" },
  { name: "Radar", path: "/api/radar?language=pt-BR&region=BR" },
  {
    name: "Para Você",
    path: "/api/user/for-you",
    method: "POST",
    body: { titles: [], surface: "page", mode: "full", language: "pt-BR", region: "BR" },
  },
  { name: "Biblioteca", path: "/api/library", expectedStatuses: [200, 401], note: "401 esperado sem sessão" },
  {
    name: "Sorteio draw",
    path: "/api/sorteio/draw",
    method: "POST",
    body: { mode: "discovery", type: "all", vibe: "all", language: "pt-BR", region: "BR" },
    expectedStatuses: [200, 401],
    note: "401 esperado sem sessão",
  },
];

async function measure(endpoint: Endpoint) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${endpoint.path}`, {
    method: endpoint.method ?? "GET",
    headers: endpoint.body ? { "Content-Type": "application/json" } : undefined,
    body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
  });
  const text = await response.text();
  const elapsedMs = Math.round(performance.now() - startedAt);
  return {
    name: endpoint.name,
    status: response.status,
    ok: response.ok || (endpoint.expectedStatuses ?? []).includes(response.status),
    elapsedMs,
    bytes: Buffer.byteLength(text),
    cacheStatus: response.headers.get("x-vercel-cache") ?? response.headers.get("x-nextjs-cache") ?? null,
    note: endpoint.note ?? "",
  };
}

async function main() {
  console.log(`[perf-local] base=${baseUrl}`);
  const rows = [];
  for (const endpoint of endpoints) {
    try {
      rows.push(await measure(endpoint));
    } catch (error) {
      rows.push({
        name: endpoint.name,
        status: 0,
        ok: false,
        elapsedMs: 0,
        bytes: 0,
        cacheStatus: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  console.table(rows);
}

main().catch((error) => {
  console.error("[perf-local] failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
