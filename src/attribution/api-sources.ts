import type { ApiSourceDefinition, ApiSourceId } from "./types";

/**
 * Fontes de dados efetivamente usadas e creditadas pelo POPLOG.
 *
 * Atualizado para refletir a arquitetura real (POPLOG-first, IMDb-first):
 * TMDB, Watchmode, Movie of the Night e Banco de Series foram REMOVIDOS da
 * operacao e nao devem mais aparecer nos creditos ao usuario. As entradas vivas
 * sao Trakt (catalogo + comunidade + calendario do Radar) e JustWatch (camada
 * de disponibilidade, servida via proxy Balloonerismm).
 *
 * Atribuicoes ainda pendentes na UI (ver POPLOG_GLOBAL_UNIFICATION_PLAN.md):
 * Wikidata, Wikipedia e OMDb. Adiciona-las exige ampliar `ApiSourceId`.
 */
export const API_SOURCES: Partial<Record<ApiSourceId, ApiSourceDefinition>> = {
  trakt: {
    id: "trakt",
    name: "Trakt",
    role:
      "Catalogo de filmes e series, trending, descoberta, relacionados, episodios, traducoes pt-BR, comentarios da comunidade e calendario do Radar.",
    officialUrl: "https://trakt.tv/",
    contexts: ["metadata", "community", "catalogRadar", "calendar"],
    alwaysInGlobalCredits: true,
  },
  balloonerismm: {
    id: "balloonerismm",
    name: "JustWatch",
    shortName: "JustWatch",
    role: "Disponibilidade de streaming, aluguel e compra por regiao.",
    officialUrl: "https://www.justwatch.com/",
    legalNotice:
      "Dados de disponibilidade via JustWatch. POPLOG nao hospeda nem distribui conteudo.",
    contexts: ["availability"],
    alwaysInGlobalCredits: true,
  },
  wikidata: {
    id: "wikidata",
    name: "Wikidata",
    role: "Dados financeiros (orcamento e bilheteria) por IMDb e relacoes de franquia/universo.",
    officialUrl: "https://www.wikidata.org/",
    legalNotice: "Dados sob licenca CC0.",
    contexts: ["metadata"],
    alwaysInGlobalCredits: true,
  },
  wikipedia: {
    id: "wikipedia",
    name: "Wikipedia",
    role: "Fallback de dados financeiros (infobox de orcamento e bilheteria).",
    officialUrl: "https://www.wikipedia.org/",
    legalNotice: "Conteudo sob licenca CC BY-SA.",
    contexts: ["metadata"],
    alwaysInGlobalCredits: true,
  },
};

export const GLOBAL_CREDIT_SOURCE_IDS = Object.values(API_SOURCES)
  .filter((source): source is ApiSourceDefinition =>
    Boolean(source?.alwaysInGlobalCredits),
  )
  .map((source) => source.id);
