"use client";

import {
  interfaceMessage,
  type InterfaceMessageKey,
} from "@/lib/i18n/interface-messages";
import { useLocale } from "@/context/LocaleContext";

export function useInterfaceMessages() {
  const { locale } = useLocale();

  return {
    language: locale.interfaceLanguage,
    t: (key: InterfaceMessageKey, replacements?: Record<string, string | number>) =>
      interfaceMessage(locale.interfaceLanguage, key, replacements),
  };
}
