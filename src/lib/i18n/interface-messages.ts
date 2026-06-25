export type InterfaceLanguage = "pt-BR" | "en-US";

export const INTERFACE_MESSAGES = {
  "pt-BR": {
    "locale.switch": "Trocar idioma",
    "locale.portuguese": "Português",
    "locale.english": "English",
    "locale.saving": "Salvando",
    "title.progress.start": "Começar série",
    "title.progress.update": "Atualizar progresso",
    "title.progress.resume": "Retomar progresso",
    "title.progress.markCurrent": "Marcar em dia",
    "title.progress.current": "Em dia",
    "title.progress.none": "Nenhum episódio marcado ainda",
    "title.progress.one": "1 episódio marcado",
    "title.progress.many": "{count} episódios marcados",
    "title.progress.catalogTotal": "{count} no catálogo",
    "title.progress.hint": "Use \"Começar/Atualizar\" para escolher temporada e episódio.",
    "title.progress.modalTitle": "Atualizar progresso",
    "title.progress.modalEyebrow": "Progresso da série",
    "title.progress.modalHint": "Escolha o último episódio visto ou use as ações rápidas.",
    "title.progress.cancel": "Cancelar",
    "title.progress.markReleased": "Marcar lançados",
    "title.progress.markSeason": "Marcar T{season}",
    "title.progress.unmarkSeason": "Desmarcar temporada",
    "title.progress.markSeries": "Marcar série inteira",
    "title.progress.untilEpisode": "Até T{season}E{episode}",
    "title.progress.reset": "Resetar",
    "title.progress.abandon": "Abandonar",
    "title.progress.saving": "Salvando...",
  },
  "en-US": {
    "locale.switch": "Change language",
    "locale.portuguese": "Português",
    "locale.english": "English",
    "locale.saving": "Saving",
    "title.progress.start": "Start series",
    "title.progress.update": "Update progress",
    "title.progress.resume": "Resume progress",
    "title.progress.markCurrent": "Mark up to date",
    "title.progress.current": "Up to date",
    "title.progress.none": "No episodes marked yet",
    "title.progress.one": "1 episode marked",
    "title.progress.many": "{count} episodes marked",
    "title.progress.catalogTotal": "{count} in catalog",
    "title.progress.hint": "Use \"Start/Update\" to choose season and episode.",
    "title.progress.modalTitle": "Update progress",
    "title.progress.modalEyebrow": "Series progress",
    "title.progress.modalHint": "Choose the last episode watched or use quick actions.",
    "title.progress.cancel": "Cancel",
    "title.progress.markReleased": "Mark released",
    "title.progress.markSeason": "Mark S{season}",
    "title.progress.unmarkSeason": "Unmark season",
    "title.progress.markSeries": "Mark full series",
    "title.progress.untilEpisode": "Through S{season}E{episode}",
    "title.progress.reset": "Reset",
    "title.progress.abandon": "Abandon",
    "title.progress.saving": "Saving...",
  },
} as const;

export type InterfaceMessageKey = keyof typeof INTERFACE_MESSAGES["pt-BR"];

export function normalizeInterfaceMessageLanguage(value?: string | null): InterfaceLanguage {
  return value === "en-US" ? "en-US" : "pt-BR";
}

export function interfaceMessage(
  language: string | null | undefined,
  key: InterfaceMessageKey,
  replacements: Record<string, string | number> = {},
) {
  const normalized = normalizeInterfaceMessageLanguage(language);
  let message: string = INTERFACE_MESSAGES[normalized][key] ?? INTERFACE_MESSAGES["pt-BR"][key] ?? key;
  for (const [name, value] of Object.entries(replacements)) {
    message = message.replaceAll(`{${name}}`, String(value));
  }
  return message;
}
