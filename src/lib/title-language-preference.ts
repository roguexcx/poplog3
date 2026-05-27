"use client";

export type TitleLanguagePreference = "auto" | "pt" | "en" | "original";

export const TITLE_LANGUAGE_STORAGE_KEY = "poplog:title-language";
export const TITLE_LANGUAGE_COOKIE = "poplog_title_language";
export const TITLE_LANGUAGE_CHANGED_EVENT = "poplog:title-language-changed";

const VALID_TITLE_LANGUAGE_PREFERENCES = new Set<TitleLanguagePreference>([
  "auto",
  "pt",
  "en",
  "original",
]);

export function isTitleLanguagePreference(
  value: unknown,
): value is TitleLanguagePreference {
  return (
    typeof value === "string" &&
    VALID_TITLE_LANGUAGE_PREFERENCES.has(value as TitleLanguagePreference)
  );
}

function normalizePreference(value: unknown): TitleLanguagePreference {
  return isTitleLanguagePreference(value) ? value : "auto";
}

export function getStoredTitleLanguagePreference(): TitleLanguagePreference {
  if (typeof window === "undefined") return "auto";

  try {
    return normalizePreference(
      window.localStorage.getItem(TITLE_LANGUAGE_STORAGE_KEY),
    );
  } catch {
    return "auto";
  }
}

export function setStoredTitleLanguagePreference(
  preference: TitleLanguagePreference,
) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(TITLE_LANGUAGE_STORAGE_KEY, preference);
  } catch {
    // Ignora ambientes sem storage persistente.
  }

  document.cookie = `${TITLE_LANGUAGE_COOKIE}=${preference}; path=/; max-age=31536000; samesite=lax`;
  window.dispatchEvent(
    new CustomEvent<TitleLanguagePreference>(TITLE_LANGUAGE_CHANGED_EVENT, {
      detail: preference,
    }),
  );
}

export function resolveTitleLanguagePreference(
  preference: TitleLanguagePreference,
): Exclude<TitleLanguagePreference, "auto"> {
  if (preference !== "auto") return preference;

  if (typeof navigator !== "undefined") {
    const language = navigator.language.toLowerCase();
    if (language.startsWith("en")) return "en";
  }

  return "pt";
}
