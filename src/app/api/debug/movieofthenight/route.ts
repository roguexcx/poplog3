import { NextResponse } from "next/server";
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

const BASE_URL = "https://api.movieofthenight.com/v4";

export async function GET() {
  const apiKey = process.env.MOVIEOFTHENIGHT_API_KEY;
  if (!apiKey) {
    return NextResponse.json(buildMissingKeyResponse("MovieOfTheNight", "MOVIEOFTHENIGHT_API_KEY"), {
      headers: jsonHeaders(),
    });
  }

  const startedAt = Date.now();
  const init = { headers: { "X-API-Key": apiKey } };
  const endpoints = await Promise.all([
    motn("Show by IMDb ID", "/shows/tt0068646", init),
    motn("Search title US", "/shows/search/title", init, { title: "The Godfather", country: "us" }),
    motn("Search filters BR popularity", "/shows/search/filters", init, {
      country: "br",
      show_type: "movie",
      order_by: "popularity_1week",
    }),
    motn("Top Netflix US", "/shows/top", init, {
      country: "us",
      service: "netflix",
      show_type: "series",
    }),
    motn("Countries", "/countries", init),
    motn("Changes Netflix US", "/changes", init, {
      country: "us",
      change_type: "new",
      item_type: "show",
      catalogs: "netflix",
      show_type: "movie",
    }),
  ]);

  const show = asRecord(endpoints[0]?.data);
  const titleSearch = showsFromMaybeList(endpoints[1]?.data);
  const filterSearch = showsFromMaybeList(endpoints[2]?.data);
  const topShows = showsFromMaybeList(endpoints[3]?.data);
  const countries = asRecord(endpoints[4]?.data);
  const changes = asRecord(endpoints[5]?.data);

  const sections: DebugSection[] = [
    {
      title: "Disponibilidade por titulo",
      description: "Mostra streamingOptions, links, tipos de acesso, idioma e granularidade regional.",
      cards: [showCard(show), ...titleSearch.slice(0, 5).map(showCard)],
      tables: [streamingOptionsTable("Streaming options do titulo", show)],
    },
    {
      title: "Catalogo regional e top lists",
      description: "Amostra de busca por filtros e top 10 para entender descoberta por pais e servico.",
      cards: [...filterSearch.slice(0, 6), ...topShows.slice(0, 6)].map(showCard),
      bullets: [
        `Busca por filtros BR retornou ${filterSearch.length} itens na amostra.`,
        `Top Netflix US retornou ${topShows.length} itens na amostra.`,
      ],
    },
    {
      title: "Paises, servicos e mudancas de catalogo",
      description: "Material importante para modelar providers, paises suportados e sincronizacao futura.",
      tables: [
        countriesTable(countries),
        changesTable(changes),
      ],
      bullets: [
        `Paises retornados: ${Object.keys(countries).length}.`,
        `Mudancas retornadas: ${asArray(changes.changes).length}.`,
      ],
    },
  ];

  return NextResponse.json(responseEnvelope({
    api: "MovieOfTheNight",
    configured: true,
    startedAt,
    summary: {
      description: "Streaming Availability API v4 com foco em disponibilidade real, catalogos por pais, servicos, top lists e mudancas.",
      bestFor: ["availability real", "streamingOptions", "catalogo regional", "mudancas de catalogo", "top 10 por servico"],
      dataTypes: ["shows", "streamingOptions", "countries", "services", "changes", "top lists", "links"],
      impression: "Parece a API mais direta para responder onde assistir e acompanhar entradas/saidas de catalogo.",
    },
    capabilities: [
      "show by IMDb/TMDB ID",
      "search by title",
      "search by filters",
      "top shows",
      "countries",
      "services",
      "changes",
      "streamingOptions",
      "catalogos regionais",
      "links profundos",
    ],
    sections,
    observations: [
      "streamingOptions e o campo mais importante: concentra provider, tipo de acesso, link, qualidade, audio, legenda e preco quando existe.",
      "Changes parece ideal para sincronizacao incremental futura, evitando varrer catalogos inteiros.",
      "Countries traz a estrutura de servicos por pais e pode virar base de configuracao visual de providers.",
    ],
    endpoints,
  }), { headers: jsonHeaders() });
}

function motn(
  label: string,
  path: string,
  init: RequestInit,
  params: Record<string, string> = {},
) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return timedJson(label, url.toString(), init);
}

function showsFromMaybeList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.map(asRecord);
  const record = asRecord(data);
  return asArray(record.shows).map(asRecord);
}

function showCard(record: Record<string, unknown>): DebugCard {
  const imageSet = asRecord(record.imageSet);
  const poster = asRecord(asRecord(imageSet.verticalPoster).w240);
  const genres = asArray(record.genres).map((genre) => readString(asRecord(genre).name) ?? readString(genre) ?? "").filter(Boolean);
  const streamingOptions = asRecord(record.streamingOptions);
  const countries = Object.keys(streamingOptions);
  return {
    title: readString(record.title) ?? readString(record.originalTitle) ?? "Show",
    subtitle: limitText(record.overview, "Sem overview.", 160),
    image: readString(poster.link),
    badges: compact([
      readString(record.showType),
      readNumber(record.releaseYear)?.toString(),
      readNumber(record.rating) ? `rating ${readNumber(record.rating)}` : undefined,
      countries.length ? `${countries.length} paises` : undefined,
    ]),
    meta: unique(genres, 5),
  };
}

function streamingOptionsTable(title: string, show: Record<string, unknown>) {
  const options = Object.entries(asRecord(show.streamingOptions))
    .flatMap(([country, entries]) => asArray(entries).map((entry) => ({ country, entry: asRecord(entry) })));
  return {
    title,
    columns: ["Pais", "Servico", "Tipo", "Qualidade", "Link"],
    rows: options.slice(0, 18).map(({ country, entry }) => {
      const service = asRecord(entry.service);
      return [
        country,
        readString(service.name) ?? readString(service.id) ?? "-",
        readString(entry.type) ?? "-",
        readString(entry.quality) ?? "-",
        readString(entry.link) ? "sim" : "-",
      ];
    }),
  };
}

function countriesTable(countries: Record<string, unknown>) {
  return {
    title: "Paises e servicos",
    columns: ["Pais", "Nome", "Servicos"],
    rows: Object.entries(countries).slice(0, 14).map(([code, value]) => {
      const record = asRecord(value);
      const services = asArray(record.services).map((service) => readString(asRecord(service).name) ?? "").filter(Boolean);
      return [code, readString(record.name) ?? "-", services.slice(0, 5).join(", ") || "-"];
    }),
  };
}

function changesTable(changes: Record<string, unknown>) {
  const shows = asRecord(changes.shows);
  return {
    title: "Mudancas de catalogo",
    columns: ["Tipo", "Item", "Show", "Servico"],
    rows: asArray(changes.changes).slice(0, 16).map((change) => {
      const record = asRecord(change);
      const show = asRecord(shows[readString(record.showId) ?? ""]);
      const service = asRecord(record.service);
      return [
        readString(record.changeType) ?? "-",
        readString(record.itemType) ?? "-",
        readString(show.title) ?? readString(record.showId) ?? "-",
        readString(service.name) ?? readString(service.id) ?? "-",
      ];
    }),
  };
}
