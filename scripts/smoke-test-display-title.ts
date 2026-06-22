/**
 * Smoke test do resolvedor canônico de título de exibição.
 *
 * Garante que nenhum ID técnico (tt..., tmdb:..., cuid, synthetic negativo)
 * vaze como nome visível, e que títulos legítimos (inclusive numéricos como
 * "1917"/"300") sejam preservados.
 *
 * Uso: npx tsx -r tsconfig-paths/register scripts/smoke-test-display-title.ts
 */

import {
  resolveDisplayTitle,
  isTechnicalIdLike,
  sanitizeDisplayTitle,
} from "@/lib/titles/display-title";

let pass = 0;
let fail = 0;

function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    console.error(
      `✗ ${msg}\n    obtido:   ${JSON.stringify(actual)}\n    esperado: ${JSON.stringify(expected)}`,
    );
  }
}

// Caso do bug reportado: "Título tt10172266"
eq(
  resolveDisplayTitle({ title: "tt10172266", originalTitle: "Parasite", mediaType: "movie" }),
  "Parasite",
  "imdb id no title → cai para originalTitle",
);
eq(
  resolveDisplayTitle({ title: "tt10172266", mediaType: "movie" }),
  "Filme sem título",
  "imdb id sem alternativa → placeholder amigável",
);
eq(
  resolveDisplayTitle({ title: "Título tt10172266", originalTitle: "Dune", mediaType: "movie" }),
  "Dune",
  "prefixo de rótulo legado + imdb id → originalTitle",
);

// Títulos numéricos legítimos sobrevivem
eq(resolveDisplayTitle({ title: "1917", tmdbId: 530915 }), "1917", "título numérico 1917 preservado");
eq(resolveDisplayTitle({ title: "300", tmdbId: 1271 }), "300", "título numérico 300 preservado");

// title igual ao próprio id → rejeitado, usa fallback
eq(
  resolveDisplayTitle({ title: "530915", tmdbId: 530915, originalTitle: "1917" }),
  "1917",
  "title == tmdbId → rejeitado, usa originalTitle",
);

// Formas técnicas diversas
eq(sanitizeDisplayTitle("tmdb:12345"), null, "prefixo tmdb: rejeitado");
eq(sanitizeDisplayTitle("trakt-9988"), null, "prefixo trakt- rejeitado");
eq(sanitizeDisplayTitle("c1a2b3c4d5e6f7g8h9i0j1k2l"), null, "cuid (poplogId) rejeitado");
eq(sanitizeDisplayTitle("-10172266"), null, "tmdbId synthetic negativo rejeitado");
eq(sanitizeDisplayTitle("Duna"), "Duna", "nome válido preservado");

// Fallbacks e placeholders
eq(resolveDisplayTitle({ name: "Breaking Bad", mediaType: "tv" }), "Breaking Bad", "campo name (tv)");
eq(resolveDisplayTitle({ title: "", original_title: "The Office" }), "The Office", "fallback snake_case");
eq(resolveDisplayTitle({ mediaType: "tv" }), "Série sem título", "vazio → placeholder de série");
eq(
  resolveDisplayTitle({ title: "  ", originalTitle: "  ", mediaType: "movie" }),
  "Filme sem título",
  "tudo em branco → placeholder de filme",
);

// Não confundir títulos reais com IDs
eq(isTechnicalIdLike("Show Me a Hero"), false, "título começando com 'Show' não é técnico");
eq(isTechnicalIdLike("Filme"), false, "palavra 'Filme' sozinha não é técnica");

// Regressão: título de palavra única NÃO pode ser rejeitado por bater com o slug
eq(
  resolveDisplayTitle({ title: "Fargo", slug: "fargo", tmdbId: 60622, mediaType: "tv" }),
  "Fargo",
  "Fargo (slug 'fargo') sobrevive",
);
eq(
  resolveDisplayTitle({ title: "Severance", slug: "severance", mediaType: "tv" }),
  "Severance",
  "Severance sobrevive",
);
// Títulos com hífen/dígitos legítimos também sobrevivem
eq(
  resolveDisplayTitle({ title: "Spider-Noir", slug: "spider-noir", mediaType: "tv" }),
  "Spider-Noir",
  "Spider-Noir sobrevive",
);
eq(
  resolveDisplayTitle({ title: "9-1-1", slug: "9-1-1", tmdbId: 75219, mediaType: "tv" }),
  "9-1-1",
  "9-1-1 sobrevive",
);
eq(
  resolveDisplayTitle({ title: "WALL-E", slug: "wall-e", mediaType: "movie" }),
  "WALL-E",
  "WALL-E sobrevive",
);

console.log(`\n[display-title] ${pass} passaram, ${fail} falharam`);
if (fail > 0) process.exitCode = 1;
