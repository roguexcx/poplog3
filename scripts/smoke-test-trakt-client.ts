import assert from "node:assert/strict";

import {
  buildTraktHeaders,
  clearTraktClientRuntimeState,
  getTraktClientStatus,
  traktFetch,
  traktGet,
} from "@/server/api-clients/trakt/client";

type FetchCall = {
  url: string;
  init?: RequestInit & { next?: { revalidate: number } };
};

const originalFetch = globalThis.fetch;
const originalClientId = process.env.TRAKT_CLIENT_ID;
const originalActive = process.env.TRAKT_ACTIVE;

function response(body: unknown, init: ResponseInit = {}) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
  });
}

function installFetch(handler: (call: FetchCall, index: number) => Promise<Response> | Response) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const call = { url, init };
    calls.push(call);
    return handler(call, calls.length);
  }) as typeof fetch;
  return calls;
}

async function main() {
  process.env.TRAKT_ACTIVE = "true";
  process.env.TRAKT_CLIENT_ID = "client-id-for-smoke";

  const headers = buildTraktHeaders();
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers["User-Agent"], "POPLOG/1.0.0");
  assert.equal(headers["trakt-api-key"], "client-id-for-smoke");
  assert.equal(headers["trakt-api-version"], "2");
  assert.equal(headers.Authorization, undefined);

  clearTraktClientRuntimeState();
  delete process.env.TRAKT_CLIENT_ID;
  let calls = installFetch(() => response([{ title: "Should not be called" }]));
  assert.equal(await traktGet("/movies/trending"), null);
  assert.equal(calls.length, 0);
  assert.equal(getTraktClientStatus().hasClientId, false);

  clearTraktClientRuntimeState();
  process.env.TRAKT_CLIENT_ID = "client-id-for-smoke";
  calls = installFetch(() =>
    response({ error: "limited" }, {
      status: 429,
      headers: {
        "Retry-After": "2",
        "X-Ratelimit": "limit=1000, remaining=0, reset=soon",
      },
    }),
  );
  assert.equal(await traktGet("/shows/trending"), null);
  assert.equal(await traktGet("/shows/trending"), null);
  assert.equal(calls.length, 1);
  assert.equal(getTraktClientStatus().cooldowns.length, 1);

  clearTraktClientRuntimeState();
  let releaseFetch: (() => void) | null = null;
  calls = installFetch(
    () =>
      new Promise<Response>((resolve) => {
        releaseFetch = () => resolve(response([{ title: "Dedupe" }]));
      }),
  );
  const first = traktGet<Array<{ title: string }>>("/movies/popular", { ttlSeconds: 30 });
  const second = traktGet<Array<{ title: string }>>("/movies/popular", { ttlSeconds: 30 });
  releaseFetch?.();
  assert.deepEqual(await Promise.all([first, second]), [[{ title: "Dedupe" }], [{ title: "Dedupe" }]]);
  assert.equal(calls.length, 1);

  clearTraktClientRuntimeState();
  calls = installFetch((call) => {
    const requestHeaders = new Headers(call.init?.headers);
    assert.equal(requestHeaders.get("Authorization"), null);
    return response([{ title: "Public GET" }]);
  });
  assert.deepEqual(await traktGet("/search/movie", { params: { query: "heat" } }), [{ title: "Public GET" }]);
  assert.equal(calls.length, 1);

  clearTraktClientRuntimeState();
  calls = installFetch(() => response({ ok: true }));
  assert.equal(await traktFetch("/sync/watchlist", { method: "POST", body: { movies: [] } }), null);
  assert.equal(calls.length, 0);

  console.log("[smoke:trakt-client] ok");
}

main()
  .catch((error) => {
    console.error("[smoke:trakt-client] failed", error);
    process.exitCode = 1;
  })
  .finally(() => {
    globalThis.fetch = originalFetch;
    if (originalClientId === undefined) delete process.env.TRAKT_CLIENT_ID;
    else process.env.TRAKT_CLIENT_ID = originalClientId;
    if (originalActive === undefined) delete process.env.TRAKT_ACTIVE;
    else process.env.TRAKT_ACTIVE = originalActive;
    clearTraktClientRuntimeState();
  });
