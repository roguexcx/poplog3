import { NextResponse } from "next/server";
import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";
import {
  asArray,
  asRecord,
  buildMissingKeyResponse,
  compact,
  jsonHeaders,
  limitText,
  readNumber,
  readString,
  responseEnvelope,
  timedJson,
  unique,
  type DebugCard,
  type DebugSection,
} from "../_shared";

const BASE_URL = "https://api.watchmode.com/v1";

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return adminUnauthorizedResponse();

  const apiKey = process.env.WATCHMODE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(buildMissingKeyResponse("Watchmode", "WATCHMODE_API_KEY"), {
      headers: jsonHeaders(),
    });
  }

  const startedAt = Date.now();
  const search = await watchmode("Autocomplete search", "/autocomplete-search/", apiKey, {
    search_value: "The Last of Us",
    search_type: "2",
  });
  const firstId = findWatchmodeId(search.data);

  const baseCalls = await Promise.all([
    watchmode("Sources / providers", "/sources/", apiKey, { regions: "US,BR" }),
    watchmode("Regions", "/regions/", apiKey, {}),
    watchmode("Genres", "/genres/", apiKey, {}),
    watchmode("Networks", "/networks/", apiKey, {}),
  ]);

  const titleCalls = firstId
    ? await Promise.all([
        watchmode("Title details + sources", `/title/${firstId}/details/`, apiKey, {
          append_to_response: "sources",
        }),
        watchmode("Title sources BR/US", `/title/${firstId}/sources/`, apiKey, {
          regions: "BR,US",
        }),
      ])
    : [];

  const endpoints = [search, ...baseCalls, ...titleCalls];
  const sources = asArray(baseCalls[0]?.data);
  const regions = asArray(baseCalls[1]?.data);
  const genres = asArray(baseCalls[2]?.data);
  const networks = asArray(baseCalls[3]?.data);
  const details = asRecord(titleCalls[0]?.data);
  const titleSources = asArray(titleCalls[1]?.data);

  const sections: DebugSection[] = [
    {
      title: "Busca e mapeamento de IDs",
      description: "Watchmode pode funcionar como camada de ponte entre nome, IMDb, TMDB e ID proprio.",
      cards: cardsFromSearch(search.data),
      bullets: compact([
        firstId ? `Primeiro ID Watchmode encontrado: ${firstId}.` : "Nenhum ID Watchmode encontrado na busca.",
        "O endpoint de busca e especialmente util para reconciliar IDs externos.",
      ]),
    },
    {
      title: "Detalhes e disponibilidade do titulo",
      description: "Amostra de metadata, ratings proprietarios e fontes por regiao quando o titulo e encontrado.",
      cards: details.title ? [detailCard(details)] : [],
      tables: [
        sourcesTable("Fontes do titulo por regiao", titleSources),
        sourcesCatalogTable(sources),
      ],
    },
    {
      title: "Mapa de cobertura",
      description: "Endpoints de apoio para construir filtros, seletores e diagnostico de cobertura.",
      tables: [
        simpleObjectTable("Regioes suportadas", regions, ["country", "name"], 12),
        simpleObjectTable("Generos", genres, ["id", "name"], 12),
        simpleObjectTable("Networks", networks, ["id", "name"], 12),
      ],
      bullets: [
        `Sources retornados na amostra: ${sources.length}.`,
        `Regioes retornadas: ${regions.length}.`,
        `Generos retornados: ${genres.length}.`,
        `Networks retornadas: ${networks.length}.`,
      ],
    },
  ];

  return NextResponse.json(responseEnvelope({
    api: "Watchmode",
    configured: true,
    startedAt,
    summary: {
      description: "API focada em disponibilidade de streaming, providers, regioes, fontes e metadados de exibicao.",
      bestFor: ["where to watch", "providers", "regioes", "mapeamento de IDs", "fontes por titulo"],
      dataTypes: ["title", "sources", "regions", "genres", "networks", "external IDs"],
      impression: "Parece forte como camada de disponibilidade e provider catalog, com boa utilidade para reconciliar IDs.",
    },
    capabilities: [
      "search/autocomplete",
      "title details",
      "streaming sources",
      "providers",
      "regions",
      "genres",
      "networks",
      "external IDs",
      "ratings proprietarios",
    ],
    sections,
    observations: [
      "A lista de sources e regioes ajuda a construir filtros confiaveis antes de modelar banco.",
      "Detalhes por titulo podem complementar TMDB com disponibilidade e scores proprietarios.",
      "Alguns recursos avancados podem variar por plano e por pais autorizado na conta.",
    ],
    endpoints,
  }), { headers: jsonHeaders() });
}

function watchmode(label: string, path: string, apiKey: string, params: Record<string, string>) {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("apiKey", apiKey);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return timedJson(label, url.toString());
}

function findWatchmodeId(data: unknown): number | undefined {
  const results = asArray(asRecord(data).results);
  for (const item of results) {
    const id = readNumber(asRecord(item).id);
    if (id) return id;
  }
  return undefined;
}

function cardsFromSearch(data: unknown): DebugCard[] {
  return asArray(asRecord(data).results).slice(0, 8).map((item) => {
    const record = asRecord(item);
    return {
      title: readString(record.name) ?? "Sem titulo",
      subtitle: compact([
        readString(record.type),
        readNumber(record.year)?.toString(),
        readString(record.imdb_id),
        readNumber(record.tmdb_id) ? `tmdb ${readNumber(record.tmdb_id)}` : undefined,
      ]).join(" | "),
      image: null,
      badges: compact([
        readNumber(record.id) ? `wm ${readNumber(record.id)}` : undefined,
        readString(record.type),
      ]),
    };
  });
}

function detailCard(record: Record<string, unknown>): DebugCard {
  return {
    title: readString(record.title) ?? "Titulo Watchmode",
    subtitle: limitText(record.plot_overview, "Sem sinopse.", 180),
    image: readString(record.poster),
    badges: compact([
      readString(record.type),
      readNumber(record.year)?.toString(),
      readNumber(record.runtime_minutes) ? `${readNumber(record.runtime_minutes)} min` : undefined,
      readNumber(record.user_rating)?.toFixed(1),
      readNumber(record.critic_score) ? `crit ${readNumber(record.critic_score)}` : undefined,
    ]),
    meta: unique([
      ...asArray(record.genre_names).map((genre) => readString(genre) ?? ""),
      readString(record.imdb_id) ?? "",
      readNumber(record.tmdb_id) ? `tmdb ${readNumber(record.tmdb_id)}` : "",
    ], 8),
  };
}

function sourcesTable(title: string, sources: unknown[]) {
  return {
    title,
    columns: ["Provider", "Tipo", "Regiao", "Formato"],
    rows: sources.slice(0, 16).map((item) => {
      const record = asRecord(item);
      return [
        readString(record.name) ?? readString(record.source_name) ?? "-",
        readString(record.type) ?? "-",
        readString(record.region) ?? "-",
        readString(record.format) ?? "-",
      ];
    }),
  };
}

function sourcesCatalogTable(sources: unknown[]) {
  return {
    title: "Catalogo de providers",
    columns: ["ID", "Nome", "Tipo", "Regioes"],
    rows: sources.slice(0, 14).map((item) => {
      const record = asRecord(item);
      return [
        String(readNumber(record.id) ?? "-"),
        readString(record.name) ?? "-",
        readString(record.type) ?? "-",
        asArray(record.regions).map((region) => readString(region) ?? "").filter(Boolean).slice(0, 6).join(", ") || "-",
      ];
    }),
  };
}

function simpleObjectTable(title: string, items: unknown[], keys: string[], limit: number) {
  return {
    title,
    columns: keys,
    rows: items.slice(0, limit).map((item) => {
      const record = asRecord(item);
      return keys.map((key) => String(readString(record[key]) ?? readNumber(record[key]) ?? "-"));
    }),
  };
}
