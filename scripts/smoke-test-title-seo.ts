import assert from "node:assert/strict";

const BASE_URL = (process.env.POPLOG_SEO_SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

function absolute(path: string) {
  return /^https?:\/\//i.test(path) ? path : `${BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

function metaContent(html: string, selector: "property" | "name", key: string): string {
  const pattern = new RegExp(`<meta ${selector}="${key}" content="([^"]+)"`, "i");
  return pattern.exec(html)?.[1]?.replace(/&amp;/g, "&") ?? "";
}

function canonicalHref(html: string): string {
  return /<link rel="canonical" href="([^"]+)"/i.exec(html)?.[1] ?? "";
}

async function fetchText(path: string, init?: RequestInit): Promise<{ html: string; url: string; status: number }> {
  const response = await fetch(absolute(path), init);
  const html = await response.text();
  return { html, url: response.url, status: response.status };
}

async function assertImage(pathOrUrl: string, label: string) {
  const response = await fetch(absolute(pathOrUrl));
  assert.equal(response.status, 200, `${label}: status 200`);
  assert.equal(response.headers.get("content-type")?.startsWith("image/png"), true, `${label}: image/png`);
  const buffer = await response.arrayBuffer();
  assert.equal(buffer.byteLength > 10_000, true, `${label}: png com conteudo`);
}

async function main() {
  const legacy = await fetch(absolute("/title/movie/tt0993846"), { redirect: "manual" });
  assert.equal(legacy.status, 308, "rota antiga redireciona permanentemente");
  assert.equal(legacy.headers.get("location"), "/the-wolf-of-wall-street-2013", "redirect aponta para slug limpo");

  const movie = await fetchText("/the-wolf-of-wall-street-2013");
  assert.equal(movie.status, 200, "slug de filme responde 200");
  assert.equal(canonicalHref(movie.html), `${BASE_URL}/the-wolf-of-wall-street-2013`, "canonical do filme aponta para slug limpo");
  assert.equal(movie.html.includes('"@type":"Movie"'), true, "JSON-LD de filme presente");
  assert.equal(movie.html.includes("application/ld+json"), true, "script JSON-LD presente");

  const movieOgImage = metaContent(movie.html, "property", "og:image");
  const movieTwitterImage = metaContent(movie.html, "name", "twitter:image");
  assert.equal(movieOgImage.includes("/api/og/title?"), true, "og:image usa imagem dinamica");
  assert.equal(movieTwitterImage.includes("/api/og/title?"), true, "twitter:image usa imagem dinamica");
  await assertImage(movieOgImage, "imagem social do filme");

  const localized = await fetchText("/the-wolf-of-wall-street-2013", {
    headers: { cookie: "poplog_catalog_language=en-US; poplog_region=US" },
  });
  assert.equal(metaContent(localized.html, "property", "og:locale"), "en_US", "metadata respeita locale do cookie");
  assert.equal(metaContent(localized.html, "property", "og:image").includes("language=en-US"), true, "imagem social carrega idioma localizado");

  const tv = await fetchText("/title/tv/tt0903747");
  assert.equal(tv.status, 200, "pagina de serie responde 200 seguindo redirect");
  assert.equal(canonicalHref(tv.html).endsWith("/breaking-bad"), true, "canonical da serie aponta para slug limpo");
  assert.equal(tv.html.includes('"@type":"TVSeries"'), true, "JSON-LD de serie presente");
  const tvOgImage = metaContent(tv.html, "property", "og:image");
  assert.equal(tvOgImage.includes("/api/og/title?"), true, "og:image da serie usa imagem dinamica");
  await assertImage(tvOgImage, "imagem social da serie");

  await assertImage("/api/og/title?fallback=1&title=POPLOG", "fallback social");

  console.log("[smoke:seo:title] ok", {
    movieCanonical: canonicalHref(movie.html),
    tvCanonical: canonicalHref(tv.html),
    movieOgImage: movieOgImage.slice(0, 96),
  });
}

main().catch((error) => {
  console.error("[smoke:seo:title] failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
