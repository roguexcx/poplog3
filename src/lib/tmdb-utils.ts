// src/lib/tmdb-utils.ts
//
// Helpers de extração de metadados textuais de itens TMDB.
//
// As funções de imagem (`getImageUrl`, `getPosterUrl`, `getBackdropUrl`)
// agora delegam ao módulo central `@/lib/images`. Mantidas aqui para
// compatibilidade com call-sites legados — código novo deve importar
// `buildTmdbUrl` de `@/lib/images` ou usar o componente <TmdbImage />.

import type { TMDBItem, TMDBMediaType } from "@/types/tmdb";
import { buildTmdbUrlLoose } from "@/lib/images/url";

// ─── Texto ────────────────────────────────────────────────────────────────────

export function getTitle(item: TMDBItem): string {
  return item.title ?? item.name ?? "Título desconhecido";
}

export function getOriginalTitle(item: TMDBItem): string | null {
  return item.original_title ?? item.original_name ?? null;
}

export function getReleaseYear(item: TMDBItem): string {
  const date = item.release_date ?? item.first_air_date;
  return date ? date.slice(0, 4) : "----";
}

export function getRating(item: TMDBItem): string | null {
  if (typeof item.vote_average !== "number") return null;
  return item.vote_average.toFixed(1);
}

export function getVoteAverage(item: TMDBItem): number {
  return item.vote_average ?? 0;
}

// ─── Tipo de mídia ────────────────────────────────────────────────────────────

export function getMediaType(item: TMDBItem): TMDBMediaType {
  return item.media_type ?? "movie";
}

export function getMediaLabel(item: TMDBItem): string {
  return getMediaType(item) === "movie" ? "Filme" : "Série";
}

// ─── Imagens (delegam para @/lib/images) ──────────────────────────────────────

/**
 * @deprecated Use `buildTmdbUrl` de `@/lib/images` ou o componente
 * `<TmdbImage />` em `@/components/images/TmdbImage`.
 *
 * Mantido para compatibilidade — agora delega ao builder central
 * em vez de construir URLs manualmente.
 */
export function getImageUrl(path?: string | null, size = "w780"): string | null {
  // Heurística: tamanhos começando com "h" são profile (h45, h632);
  // resto cai em backdrop como default razoável de transição.
  const kind = size.startsWith("h") ? "profile" : "backdrop";
  return buildTmdbUrlLoose(kind, size, path);
}

/**
 * @deprecated Use `buildTmdbUrl("poster", "card" | "detail" | "hero", path)`.
 */
export function getPosterUrl(
  path?: string | null,
  size: "w342" | "w500" | "w780" = "w500",
): string | null {
  return buildTmdbUrlLoose("poster", size, path);
}

/**
 * @deprecated Use `buildTmdbUrl("backdrop", "medium" | "hero" | "full", path)`.
 */
export function getBackdropUrl(
  path?: string | null,
  size: "w780" | "w1280" | "original" = "w1280",
): string | null {
  return buildTmdbUrlLoose("backdrop", size, path);
}
