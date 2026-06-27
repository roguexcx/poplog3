import generatedMessages from "./generated-ui-messages.json";
import {
  normalizeInterfaceMessageLanguage,
  type InterfaceLanguage,
} from "./interface-messages";

type GeneratedCatalog = Record<string, Partial<Record<InterfaceLanguage, string>>>;

const catalog = generatedMessages as GeneratedCatalog;
let serverLanguage: InterfaceLanguage = "pt-BR";

export function setServerUiMessageLanguage(language: string | null | undefined) {
  serverLanguage = normalizeInterfaceMessageLanguage(language);
}

function currentLanguage(): InterfaceLanguage {
  if (typeof document !== "undefined") {
    return normalizeInterfaceMessageLanguage(
      document.documentElement.dataset.interfaceLanguage ||
        document.documentElement.lang ||
        window.localStorage?.getItem("poplog_interface_language"),
    );
  }
  return serverLanguage;
}

export function uiMessageFor(
  language: string | null | undefined,
  key: string,
  replacements: Record<string, string | number | null | undefined> = {},
): string {
  const normalized = normalizeInterfaceMessageLanguage(language);
  const entry = catalog[key];
  let message = entry?.[normalized] ?? entry?.["pt-BR"] ?? key;
  for (const [name, value] of Object.entries(replacements)) {
    message = message.replaceAll(`{${name}}`, String(value ?? ""));
  }
  return message;
}

export function uiMessage(
  key: string,
  replacements: Record<string, string | number | null | undefined> = {},
): string {
  return uiMessageFor(currentLanguage(), key, replacements);
}
