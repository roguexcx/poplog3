"use client";

/**
 * POPLOG usa português brasileiro (pt-BR) como idioma oficial e único.
 * Seleção de idioma por usuário foi removida do perfil — todos os conteúdos
 * textuais são servidos em pt-BR quando disponível, ou no título original
 * quando não há tradução confiável.
 *
 * O tipo `TitleLanguagePreference` é mantido apenas para compatibilidade
 * com código legado. Novos componentes não devem usar este arquivo.
 */

/** @deprecated O POPLOG usa pt-BR fixo. Esta preferência não tem mais efeito. */
export type TitleLanguagePreference = "auto" | "pt" | "en" | "original";

/** @deprecated */
export const TITLE_LANGUAGE_STORAGE_KEY = "poplog:title-language";
/** @deprecated */
export const TITLE_LANGUAGE_COOKIE = "poplog_title_language";
/** @deprecated */
export const TITLE_LANGUAGE_CHANGED_EVENT = "poplog:title-language-changed";

const VALID_TITLE_LANGUAGE_PREFERENCES = new Set<TitleLanguagePreference>([
  "auto",
  "pt",
  "en",
  "original",
]);

/** @deprecated */
export function isTitleLanguagePreference(
  value: unknown,
): value is TitleLanguagePreference {
  return (
    typeof value === "string" &&
    VALID_TITLE_LANGUAGE_PREFERENCES.has(value as TitleLanguagePreference)
  );
}

/**
 * @deprecated Sempre retorna "pt" — idioma fixo.
 * A preferência armazenada é ignorada; o POPLOG é pt-BR.
 */
export function getStoredTitleLanguagePreference(): TitleLanguagePreference {
  return "pt";
}

/**
 * @deprecated No-op — idioma fixo em pt-BR.
 * Preservado para compatibilidade; não persiste nada.
 */
export function setStoredTitleLanguagePreference(
  _preference: TitleLanguagePreference,
): void {
  // O idioma do POPLOG é fixo em pt-BR. Esta função não tem efeito.
}

/**
 * @deprecated Sempre retorna "pt" — idioma fixo.
 */
export function resolveTitleLanguagePreference(
  _preference: TitleLanguagePreference,
): Exclude<TitleLanguagePreference, "auto"> {
  return "pt";
}
