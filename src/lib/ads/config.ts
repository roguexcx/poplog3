export type AdSlotPlacement =
  | "home_between_blocks"
  | "home_after_rankings"
  | "list_between_results"
  | "title_after_main_content"
  | "radar_between_groups"
  | "library_between_groups"
  | "sidebar_contextual";

export type AdPlacementConfig = {
  placement: AdSlotPlacement;
  envSlot: string;
  minHeight: number;
  mobileMinHeight: number;
  reservedByDefault: boolean;
  enabledByDefault: boolean;
  description: string;
};

export const AD_PLACEMENTS: Record<AdSlotPlacement, AdPlacementConfig> = {
  home_between_blocks: {
    placement: "home_between_blocks",
    envSlot: "NEXT_PUBLIC_ADSENSE_SLOT_HOME_BETWEEN_BLOCKS",
    minHeight: 120,
    mobileMinHeight: 90,
    reservedByDefault: true,
    enabledByDefault: false,
    description: "Entre blocos editoriais da Home, sem interromper hero, acoes ou navegacao.",
  },
  home_after_rankings: {
    placement: "home_after_rankings",
    envSlot: "NEXT_PUBLIC_ADSENSE_SLOT_HOME_AFTER_RANKINGS",
    minHeight: 120,
    mobileMinHeight: 90,
    reservedByDefault: true,
    enabledByDefault: false,
    description: "Abaixo de rankings e listas principais da Home.",
  },
  list_between_results: {
    placement: "list_between_results",
    envSlot: "NEXT_PUBLIC_ADSENSE_SLOT_LIST_BETWEEN_RESULTS",
    minHeight: 120,
    mobileMinHeight: 90,
    reservedByDefault: false,
    enabledByDefault: false,
    description: "Entre grupos longos de cards, nunca dentro de uma acao critica.",
  },
  title_after_main_content: {
    placement: "title_after_main_content",
    envSlot: "NEXT_PUBLIC_ADSENSE_SLOT_TITLE_AFTER_MAIN_CONTENT",
    minHeight: 120,
    mobileMinHeight: 90,
    reservedByDefault: true,
    enabledByDefault: false,
    description: "Final da pagina de titulo, depois de acoes, providers, episodios e conteudo principal.",
  },
  radar_between_groups: {
    placement: "radar_between_groups",
    envSlot: "NEXT_PUBLIC_ADSENSE_SLOT_RADAR_BETWEEN_GROUPS",
    minHeight: 120,
    mobileMinHeight: 90,
    reservedByDefault: false,
    enabledByDefault: false,
    description: "Entre grupos do Radar atual; revisao completa fica para o epico Radar V2.",
  },
  library_between_groups: {
    placement: "library_between_groups",
    envSlot: "NEXT_PUBLIC_ADSENSE_SLOT_LIBRARY_BETWEEN_GROUPS",
    minHeight: 120,
    mobileMinHeight: 90,
    reservedByDefault: false,
    enabledByDefault: false,
    description: "Entre grupos da Biblioteca/Watchlist, longe de botoes de estado.",
  },
  sidebar_contextual: {
    placement: "sidebar_contextual",
    envSlot: "NEXT_PUBLIC_ADSENSE_SLOT_SIDEBAR_CONTEXTUAL",
    minHeight: 280,
    mobileMinHeight: 0,
    reservedByDefault: false,
    enabledByDefault: false,
    description: "Area lateral apenas em layout largo, nunca em mobile.",
  },
};

export function areAdsEnabled() {
  return process.env.NEXT_PUBLIC_ADS_ENABLED === "true";
}

export function getAdSenseClientId() {
  return process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT?.trim() ?? "";
}

export function shouldReserveDisabledAdSpace() {
  return process.env.NEXT_PUBLIC_ADS_RESERVED_LAYOUT === "true";
}

export function getAdPlacementConfig(placement: AdSlotPlacement): AdPlacementConfig {
  return AD_PLACEMENTS[placement];
}

export function getAdSenseSlotId(placement: AdSlotPlacement): string {
  switch (placement) {
    case "home_between_blocks":
      return process.env.NEXT_PUBLIC_ADSENSE_SLOT_HOME_BETWEEN_BLOCKS?.trim() ?? "";
    case "home_after_rankings":
      return process.env.NEXT_PUBLIC_ADSENSE_SLOT_HOME_AFTER_RANKINGS?.trim() ?? "";
    case "list_between_results":
      return process.env.NEXT_PUBLIC_ADSENSE_SLOT_LIST_BETWEEN_RESULTS?.trim() ?? "";
    case "title_after_main_content":
      return process.env.NEXT_PUBLIC_ADSENSE_SLOT_TITLE_AFTER_MAIN_CONTENT?.trim() ?? "";
    case "radar_between_groups":
      return process.env.NEXT_PUBLIC_ADSENSE_SLOT_RADAR_BETWEEN_GROUPS?.trim() ?? "";
    case "library_between_groups":
      return process.env.NEXT_PUBLIC_ADSENSE_SLOT_LIBRARY_BETWEEN_GROUPS?.trim() ?? "";
    case "sidebar_contextual":
      return process.env.NEXT_PUBLIC_ADSENSE_SLOT_SIDEBAR_CONTEXTUAL?.trim() ?? "";
  }
}
