/**
 * Dados estruturais (neutros de idioma) da explicação "Para você" + render localizado.
 *
 * Princípio: o motor de recomendação produz apenas DADOS (code + seedTitle + counts),
 * nunca a string final. A frase de interface ("Porque você favoritou X") é montada na
 * borda — no client via `ui()` ou no servidor via `uiMessageFor()` — usando o
 * interfaceLanguage corrente. Assim trocar o idioma da interface re-renderiza o texto
 * sem refazer a recomendação, e o pool cacheado não fica preso a um idioma.
 *
 * - `seedTitle`/`genrePrefix` são METADADOS DE CATÁLOGO já localizados (catalogLanguage)
 *   resolvidos no payload — não dependem do interfaceLanguage.
 * - `code`/`moreCount` são estruturais; a tradução vive nas chaves `for_you.reason.*`.
 */

export type ForYouReasonCode =
  | "because_favorited"
  | "because_watching"
  | "based_on_watched"
  | "from_watchlist"
  | "based_on_library"
  | "library_match";

export type ForYouReasonData = {
  code: ForYouReasonCode;
  /** Título da semente, já localizado no catálogo (catalogLanguage). */
  seedTitle?: string | null;
  /** "+N outros títulos que você gostou" — 0/ausente = sem sufixo. */
  moreCount?: number;
  /** Prefixo de gênero (catalogLanguage), prepended como "{gênero} · {frase}". */
  genrePrefix?: string | null;
};

/** Assinatura compatível com `useLocale().ui` e `uiMessageFor(lang, ...)`/`uiMessage`. */
export type ForYouTranslate = (
  key: string,
  params?: Record<string, string | number | null | undefined>,
) => string;

const FALLBACK_TITLE_KEY = "for_you.reason.fallback_title";

/** Monta a frase final da explicação a partir dos dados neutros + tradutor de UI. */
export function renderForYouReason(data: ForYouReasonData, translate: ForYouTranslate): string {
  const title = data.seedTitle?.trim() || translate(FALLBACK_TITLE_KEY);
  let text = translate(`for_you.reason.${data.code}`, { title });

  if (data.moreCount && data.moreCount > 0) {
    const suffixKey =
      data.moreCount === 1 ? "for_you.reason.more_suffix_one" : "for_you.reason.more_suffix_other";
    text += translate(suffixKey, { count: data.moreCount });
  }

  if (data.genrePrefix) {
    text = `${data.genrePrefix} · ${text}`;
  }

  return text;
}

/** Rótulo de mídia (Filme/Série) — texto de interface, montado via interfaceLanguage. */
export function renderForYouMediaLabel(mediaType: "movie" | "tv", translate: ForYouTranslate): string {
  return translate(`for_you.media.${mediaType}`);
}
