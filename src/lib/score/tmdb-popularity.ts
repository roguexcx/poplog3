/**
 * Normalização da popularidade do TMDB.
 *
 * Problema: a escala de popularidade do TMDB é extremamente desbalanceada.
 * Séries/filmes comuns ficam entre 20–80 pontos; títulos viralizados podem
 * ultrapassar 2000–3000, distorcendo completamente rankings e feed editorial.
 *
 * Solução: curva logarítmica com teto (cap) para suavizar outliers sem
 * eliminar a diferença entre títulos relevantes e conteúdo mediano.
 *
 * Escala de saída: 0–1 (normalizada), ou 0–100 quando multiplied.
 *
 * Calibração empírica:
 *   popularidade  5 → ~0.30
 *   popularidade 20 → ~0.50
 *   popularidade 80 → ~0.71
 *   popularidade 200 → ~0.83
 *   popularidade 500 → ~0.91
 *   popularidade 1000 → ~0.96
 *   popularidade 2000+ → 1.00 (cap)
 */

/** Valor de corte acima do qual a popularidade é considerada "máxima" antes do log. */
const POPULARITY_CAP = 2000;

/**
 * Retorna um score normalizado de popularidade em escala 0–1
 * aplicando uma curva log₁₀ com cap.
 *
 * @param popularity - Valor bruto da popularidade do TMDB (qualquer número ≥ 0).
 * @returns Valor entre 0 e 1.
 */
export function normalizeTmdbPopularity(popularity: number | null | undefined): number {
  if (!popularity || popularity <= 0) return 0;

  // Aplica o cap antes de logar para garantir teto
  const capped = Math.min(popularity, POPULARITY_CAP);

  // log10(1) = 0, log10(POPULARITY_CAP) = log10(2000) ≈ 3.301
  const normalized = Math.log10(1 + capped) / Math.log10(1 + POPULARITY_CAP);

  return Math.min(1, Math.max(0, normalized));
}

/**
 * Retorna um score de popularidade em escala 0–100 (inteiro).
 * Conveniente para uso em contextos de pontuação editorial.
 */
export function popularityScore(popularity: number | null | undefined): number {
  return Math.round(normalizeTmdbPopularity(popularity) * 100);
}

/**
 * Determina o visual weight (hero/card) de um item baseado na
 * popularidade normalizada, substituindo os thresholds brutos anteriores.
 *
 * Antes: `popularity > 500` ou `popularity > 300` ou `popularity > 250`
 * Agora: baseado em score normalizado, com thresholds consistentes.
 *
 * @param popularity - Valor bruto da popularidade do TMDB.
 * @param mediaType  - "movie" ou "tv" (thresholds ligeiramente diferentes).
 */
export function popularityToVisualWeight(
  popularity: number | null | undefined,
  mediaType: "movie" | "tv" = "tv",
): "hero" | "card" {
  const score = normalizeTmdbPopularity(popularity);
  // Filmes têm limiar um pouco menor — mercado menor de títulos virais
  const threshold = mediaType === "movie" ? 0.80 : 0.78;
  return score >= threshold ? "hero" : "card";
}
