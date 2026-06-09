import type { ApiSourceDefinition, ApiSourceId } from "./types";

export const API_SOURCES: Record<ApiSourceId, ApiSourceDefinition> = {
  tmdb: {
    id: "tmdb",
    name: "TMDB",
    role:
      "Metadados, imagens, posters, backdrops, elenco, temporadas, episódios, recomendações, tendências e providers.",
    officialUrl: "https://www.themoviedb.org/",
    logoUrl:
      "https://www.themoviedb.org/assets/2/v4/logos/v2/blue_long_1-5bf0a8e3a0d5f2bb5f39a34c8d5e6a933dd67c0d8f6e4f18298e61f4782bc8c3.svg",
    legalNotice:
      "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    contexts: ["metadata", "images", "availability", "ratings", "community"],
    alwaysInGlobalCredits: true,
  },
  watchmode: {
    id: "watchmode",
    name: "Watchmode",
    role: "Disponibilidade complementar e validação de streaming.",
    officialUrl: "https://www.watchmode.com/",
    contexts: ["availability"],
  },
  omdb: {
    id: "omdb",
    name: "OMDb",
    role: "Ratings externos, prêmios e informações complementares.",
    officialUrl: "https://www.omdbapi.com/",
    contexts: ["ratings"],
  },
  trakt: {
    id: "trakt",
    name: "Trakt",
    role: "Comentários, reviews e atividade da comunidade.",
    officialUrl: "https://trakt.tv/",
    contexts: ["community"],
  },
  movieofthenight: {
    id: "movieofthenight",
    name: "Movie of the Night",
    shortName: "MotN",
    role: "Radar editorial de catálogo, disponibilidade e eventos digitais.",
    officialUrl: "https://www.movieofthenight.com/",
    contexts: ["availability", "catalogRadar"],
  },
  bancodeseries: {
    id: "bancodeseries",
    name: "Banco de Séries",
    role: "Calendário externo usado como sinal auxiliar de agenda.",
    officialUrl: "https://www.bancodeseries.com.br/",
    contexts: ["calendar"],
  },
  balloonerismm: {
    id: "balloonerismm",
    name: "JustWatch",
    shortName: "JustWatch",
    role: "Disponibilidade de streaming, aluguel e compra no Brasil.",
    officialUrl: "https://www.justwatch.com/",
    contexts: ["availability"],
  },
};

export const GLOBAL_CREDIT_SOURCE_IDS = Object.values(API_SOURCES)
  .filter((source) => source.alwaysInGlobalCredits)
  .map((source) => source.id);
