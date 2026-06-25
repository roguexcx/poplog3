import "dotenv/config";

import assert from "node:assert/strict";

type Check = {
  name: string;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  expectedStatuses?: number[];
  assert?: (response: Response, text: string) => void | Promise<void>;
};

const baseUrl = (process.env.LOCAL_REGRESSION_BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

function url(path: string) {
  return `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const checks: Check[] = [
  {
    name: "Home",
    path: "/",
    assert: (_response, text) => assert.ok(text.includes("<html") || text.includes("<!DOCTYPE"), "Home renderiza HTML"),
  },
  {
    name: "Busca localizada pt-BR/BR",
    path: "/api/search?q=superman&language=pt-BR&region=BR",
    assert: (_response, text) => assert.ok(text.length > 50, "busca retorna payload"),
  },
  {
    name: "Busca localizada en-US/US",
    path: "/api/search?q=superman&language=en-US&region=US",
    assert: (_response, text) => assert.ok(text.length > 50, "busca en-US retorna payload separado"),
  },
  {
    name: "Redirect 308 titulo legado",
    path: "/title/movie/tt0993846",
    expectedStatuses: [308],
    assert: (response) => assert.equal(response.headers.get("location"), "/the-wolf-of-wall-street-2013", "redirect aponta para slug limpo"),
  },
  {
    name: "Pagina de titulo filme",
    path: "/the-wolf-of-wall-street-2013",
    assert: (_response, text) => {
      assert.ok(text.includes("canonical"), "filme possui canonical");
      assert.ok(text.includes("application/ld+json"), "filme possui structured data");
    },
  },
  {
    name: "Pagina de titulo serie",
    path: "/title/tv/tt0903747",
    assert: (_response, text) => assert.ok(text.includes("Breaking") || text.includes("canonical"), "serie renderiza pagina de titulo"),
  },
  {
    name: "Providers por titulo",
    path: "/api/poplog3/providers?id=tt0993846&media_type=movie&region=BR&language=pt-BR&debug=1",
    assert: (_response, text) => {
      const json = parseJson(text) as { ok?: boolean; providers?: unknown[]; debug?: unknown; result?: { hasProviders?: boolean }; cache?: unknown } | null;
      assert.ok(json, "providers retorna JSON");
      assert.ok(Array.isArray(json?.providers) || json?.debug || json?.result || json?.cache, "providers contem dados ou debug");
    },
  },
  {
    name: "Radar atual minimo",
    path: "/radar",
    assert: (_response, text) => assert.ok(text.length > 100, "Radar nao quebra"),
  },
  {
    name: "API Radar minima",
    path: "/api/radar?language=pt-BR&region=BR",
    assert: (_response, text) => assert.ok(text.length > 20, "API Radar responde"),
  },
  {
    name: "Para Voce",
    path: "/api/user/for-you",
    method: "POST",
    body: { titles: [], surface: "page", mode: "full", language: "pt-BR", region: "BR" },
    assert: (_response, text) => assert.ok(text.length > 10, "Para Voce retorna payload"),
  },
  {
    name: "Biblioteca",
    path: "/api/library",
    expectedStatuses: [200, 401],
    assert: (response) => assert.ok([200, 401].includes(response.status), "Biblioteca responde ou protege anonimo"),
  },
  {
    name: "Sorteio",
    path: "/api/sorteio/draw",
    method: "POST",
    body: { mode: "discovery", type: "all", vibe: "all", language: "pt-BR", region: "BR" },
    expectedStatuses: [200, 401],
    assert: (response, text) => {
      assert.ok([200, 401].includes(response.status), "Sorteio responde ou protege anonimo");
      if (response.status === 200) assert.ok(text.includes("local_db") || text.length > 10, "Sorteio usa payload local");
    },
  },
  {
    name: "Admin",
    path: "/admin",
    expectedStatuses: [200, 302, 401],
    assert: (response) => assert.ok([200, 302, 401].includes(response.status), "Admin carrega ou protege acesso"),
  },
  {
    name: "OG image dinamica",
    path: "/api/og/title?mediaType=movie&id=tt0993846&language=pt-BR&region=BR",
    assert: (response) => assert.equal(response.headers.get("content-type")?.startsWith("image/png"), true, "OG image retorna PNG"),
  },
];

async function main() {
  const health = await fetch(url("/api/debug/health")).catch((error) => {
    throw new Error(`Servidor local indisponivel em ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
  });
  assert.ok(health.ok, `healthcheck local falhou: HTTP ${health.status}`);

  const rows: Array<{ name: string; status: number; bytes: number; elapsedMs: number }> = [];
  for (const check of checks) {
    const startedAt = performance.now();
    const response = await fetch(url(check.path), {
      method: check.method ?? "GET",
      redirect: check.expectedStatuses?.includes(308) ? "manual" : "follow",
      headers: check.body ? { "Content-Type": "application/json" } : undefined,
      body: check.body ? JSON.stringify(check.body) : undefined,
    });
    const text = await response.text();
    const expected = check.expectedStatuses ?? [200];
    assert.ok(expected.includes(response.status), `${check.name}: HTTP ${response.status}, esperado ${expected.join("/")}`);
    await check.assert?.(response, text);
    rows.push({
      name: check.name,
      status: response.status,
      bytes: Buffer.byteLength(text),
      elapsedMs: Math.round(performance.now() - startedAt),
    });
  }

  console.table(rows);
  console.log("[smoke:local-http] ok", { baseUrl, checks: rows.length });
}

main().catch((error) => {
  console.error("[smoke:local-http] failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
