"use client";

import { useEffect, useState } from "react";

import {
  interfaceMessage,
  normalizeInterfaceMessageLanguage,
  type InterfaceLanguage,
  type InterfaceMessageKey,
} from "@/lib/i18n/interface-messages";

type LocalePayload = {
  ok: boolean;
  locale?: {
    interfaceLanguage?: string | null;
  };
};

export function useInterfaceMessages() {
  const [language, setLanguage] = useState<InterfaceLanguage>("pt-BR");

  useEffect(() => {
    let active = true;
    fetch("/api/user/locale", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: LocalePayload) => {
        if (!active || !payload.ok) return;
        const next = normalizeInterfaceMessageLanguage(payload.locale?.interfaceLanguage);
        setLanguage(next);
        document.documentElement.lang = next;
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return {
    language,
    t: (key: InterfaceMessageKey, replacements?: Record<string, string | number>) =>
      interfaceMessage(language, key, replacements),
  };
}
