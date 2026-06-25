import generatedMessages from "./generated-ui-messages.json";
import {
  normalizeInterfaceMessageLanguage,
  type InterfaceLanguage,
} from "./interface-messages";

type GeneratedCatalog = Record<string, Partial<Record<InterfaceLanguage, string>>>;

const catalog = generatedMessages as GeneratedCatalog;

function currentLanguage(): InterfaceLanguage {
  if (typeof document !== "undefined") {
    return normalizeInterfaceMessageLanguage(
      document.documentElement.lang ||
        window.localStorage?.getItem("poplog_interface_language"),
    );
  }
  return "pt-BR";
}

export function uiMessage(
  key: string,
  replacements: Record<string, string | number | null | undefined> = {},
): string {
  const language = currentLanguage();
  const entry = catalog[key];
  let message = entry?.[language] ?? entry?.["pt-BR"] ?? key;
  for (const [name, value] of Object.entries(replacements)) {
    message = message.replaceAll(`{${name}}`, String(value ?? ""));
  }
  return message;
}
