"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  interfaceMessage,
  normalizeInterfaceMessageLanguage,
  type InterfaceLanguage,
  type InterfaceMessageKey,
} from "@/lib/i18n/interface-messages";
import { setServerUiMessageLanguage, uiMessageFor } from "@/lib/i18n/ui-message";

export type PoplogLocale = {
  interfaceLanguage: InterfaceLanguage;
  catalogLanguage: InterfaceLanguage;
  region: "BR" | "US";
};

type LocalePayload = {
  ok: boolean;
  locale?: {
    interfaceLanguage?: string | null;
    catalogLanguage?: string | null;
    region?: string | null;
  };
};

type LocaleContextValue = {
  locale: PoplogLocale;
  setLocale: (locale: Partial<PoplogLocale>) => void;
  saveLocale: (locale: Partial<PoplogLocale>) => Promise<PoplogLocale | null>;
  ui: (key: string, replacements?: Record<string, string | number | null | undefined>) => string;
  t: (key: InterfaceMessageKey, replacements?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function normalizeRegion(value?: string | null): PoplogLocale["region"] {
  return value === "US" ? "US" : "BR";
}

type LocaleInput = {
  interfaceLanguage?: string | null;
  catalogLanguage?: string | null;
  region?: string | null;
};

function normalizeLocale(input?: LocaleInput | null): PoplogLocale {
  const interfaceLanguage = normalizeInterfaceMessageLanguage(input?.interfaceLanguage);
  const catalogLanguage = normalizeInterfaceMessageLanguage(input?.catalogLanguage ?? interfaceLanguage);
  const region = normalizeRegion(input?.region);

  return { interfaceLanguage, catalogLanguage, region };
}

function applyLocaleToDocument(locale: PoplogLocale) {
  if (typeof document === "undefined") return;

  document.documentElement.lang = locale.interfaceLanguage;
  document.documentElement.dataset.interfaceLanguage = locale.interfaceLanguage;
  document.documentElement.dataset.catalogLanguage = locale.catalogLanguage;
  document.documentElement.dataset.region = locale.region;
  window.localStorage?.setItem("poplog_interface_language", locale.interfaceLanguage);
  window.localStorage?.setItem("poplog_catalog_language", locale.catalogLanguage);
  window.localStorage?.setItem("poplog_region", locale.region);
}

function sameLocale(left: PoplogLocale, right: PoplogLocale) {
  return (
    left.interfaceLanguage === right.interfaceLanguage &&
    left.catalogLanguage === right.catalogLanguage &&
    left.region === right.region
  );
}

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale?: Partial<PoplogLocale> | null;
}) {
  const [locale, setLocaleState] = useState<PoplogLocale>(() => normalizeLocale(initialLocale));

  // Seed the client-bundle copy of the UI-message language synchronously during
  // render so descendant client components that call the bare `uiMessage()` helper
  // resolve the same language on the SSR pass as in the browser. Without this the
  // client bundle's module global defaults to "pt-BR" during SSR while the browser
  // reads `en-US` from the <html> dataset, producing a hydration mismatch.
  setServerUiMessageLanguage(locale.interfaceLanguage);

  const setLocale = useCallback((next: Partial<PoplogLocale>) => {
    setLocaleState((current) => normalizeLocale({ ...current, ...next }));
  }, []);

  useEffect(() => {
    applyLocaleToDocument(locale);
  }, [locale]);

  useEffect(() => {
    let active = true;
    fetch("/api/user/locale", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: LocalePayload) => {
        if (!active || !payload.ok || !payload.locale) return;
        const next = normalizeLocale({
          interfaceLanguage: payload.locale.interfaceLanguage ?? undefined,
          catalogLanguage: payload.locale.catalogLanguage ?? undefined,
          region: payload.locale.region === "US" ? "US" : "BR",
        });
        setLocaleState((current) => (sameLocale(current, next) ? current : next));
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  const saveLocale = useCallback(async (next: Partial<PoplogLocale>) => {
    const normalized = normalizeLocale({ ...locale, ...next });
    const response = await fetch("/api/user/locale", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalized),
    });
    const payload = (await response.json()) as LocalePayload;
    if (!payload.ok || !payload.locale) return null;

    const saved = normalizeLocale({
      interfaceLanguage: payload.locale.interfaceLanguage ?? undefined,
      catalogLanguage: payload.locale.catalogLanguage ?? undefined,
      region: payload.locale.region === "US" ? "US" : "BR",
    });
    setLocaleState(saved);
    return saved;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      saveLocale,
      ui: (key, replacements) => uiMessageFor(locale.interfaceLanguage, key, replacements),
      t: (key, replacements) => interfaceMessage(locale.interfaceLanguage, key, replacements),
    }),
    [locale, saveLocale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used inside <LocaleProvider>");
  return context;
}

