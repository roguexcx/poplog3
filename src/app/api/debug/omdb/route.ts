import { NextResponse } from "next/server";
import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";
import {
  asArray,
  asRecord,
  buildMissingKeyResponse,
  compact,
  jsonHeaders,
  limitText,
  readString,
  responseEnvelope,
  timedJson,
  type DebugCard,
  type DebugSection,
} from "../_shared";

const BASE_URL = "http://www.omdbapi.com/";

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return adminUnauthorizedResponse();

  const apiKey = process.env.OMDB_API_KEY;
  if (!apiKey) {
    return NextResponse.json(buildMissingKeyResponse("OMDb", "OMDB_API_KEY"), {
      headers: jsonHeaders(),
    });
  }

  const startedAt = Date.now();
  const endpoints = await Promise.all([
    omdb("Title search", apiKey, { s: "Blade Runner", type: "movie" }),
    omdb("IMDb lookup completo", apiKey, { i: "tt0083658", plot: "full" }),
    omdb("Text lookup serie", apiKey, { t: "The Last of Us", type: "series", plot: "short" }),
  ]);

  const search = asRecord(endpoints[0]?.data);
  const movie = asRecord(endpoints[1]?.data);
  const series = asRecord(endpoints[2]?.data);

  const sections: DebugSection[] = [
    {
      title: "Busca textual",
      description: "OMDb retorna uma busca simples e barata baseada em IMDb, util como fallback ou reconciliacao.",
      cards: asArray(search.Search).slice(0, 8).map(searchCard),
      bullets: [
        `Total informado pela busca: ${readString(search.totalResults) ?? "N/D"}.`,
      ],
    },
    {
      title: "Lookup por IMDb e titulo",
      description: "A forca da API aparece em ratings, metadados compactos, plot e campos IMDb-friendly.",
      cards: [detailCard(movie), detailCard(series)],
      tables: [
        ratingsTable(movie, series),
        metadataTable(movie, series),
      ],
    },
  ];

  return NextResponse.json(responseEnvelope({
    api: "OMDb",
    configured: true,
    startedAt,
    summary: {
      description: "API simples centrada em IMDb com busca, lookup por ID/titulo, ratings agregados e metadados textuais.",
      bestFor: ["ratings", "IMDb lookup", "plot", "metadata compacto", "fallback de poster"],
      dataTypes: ["search results", "ratings", "plot", "cast", "runtime", "genre", "poster", "awards"],
      impression: "Parece complementar: pequena, direta e boa para enriquecer ratings/metadados, nao para catalogo visual principal.",
    },
    capabilities: [
      "title search",
      "IMDb ID lookup",
      "title lookup",
      "ratings",
      "plot curto/completo",
      "cast",
      "runtime",
      "genre",
      "poster",
      "awards",
    ],
    sections,
    observations: [
      "OMDb e excelente para cruzar ratings externos em uma tela de detalhe.",
      "A busca e simples; para descoberta visual rica, TMDB parece superior.",
      "O retorno textual e muito facil de transformar em UI de ficha tecnica.",
    ],
    endpoints,
  }), { headers: jsonHeaders() });
}

function omdb(label: string, apiKey: string, params: Record<string, string>) {
  const url = new URL(BASE_URL);
  url.searchParams.set("apikey", apiKey);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return timedJson(label, url.toString());
}

function searchCard(item: unknown): DebugCard {
  const record = asRecord(item);
  return {
    title: readString(record.Title) ?? "Sem titulo",
    subtitle: compact([
      readString(record.Year),
      readString(record.Type),
      readString(record.imdbID),
    ]).join(" | "),
    image: readString(record.Poster) === "N/A" ? null : readString(record.Poster),
    badges: compact([readString(record.Type), readString(record.Year)]),
  };
}

function detailCard(record: Record<string, unknown>): DebugCard {
  return {
    title: readString(record.Title) ?? "Titulo OMDb",
    subtitle: limitText(record.Plot, "Sem plot.", 170),
    image: readString(record.Poster) === "N/A" ? null : readString(record.Poster),
    badges: compact([
      readString(record.Year),
      readString(record.Rated),
      readString(record.Runtime),
      readString(record.imdbRating) ? `IMDb ${readString(record.imdbRating)}` : undefined,
    ]),
    meta: compact([
      readString(record.Genre),
      readString(record.Director),
      readString(record.Actors),
    ]),
  };
}

function ratingsTable(movie: Record<string, unknown>, series: Record<string, unknown>) {
  const row = (label: string, item: Record<string, unknown>) => [
    label,
    readString(item.imdbRating) ?? "-",
    readString(item.imdbVotes) ?? "-",
    asArray(item.Ratings).map((rating) => {
      const record = asRecord(rating);
      return `${readString(record.Source) ?? "Fonte"}: ${readString(record.Value) ?? "-"}`;
    }).join(" | ") || "-",
  ];
  return {
    title: "Ratings agregados",
    columns: ["Titulo", "IMDb", "Votos", "Outras fontes"],
    rows: [row("Filme", movie), row("Serie", series)],
  };
}

function metadataTable(movie: Record<string, unknown>, series: Record<string, unknown>) {
  const row = (label: string, item: Record<string, unknown>) => [
    label,
    readString(item.Genre) ?? "-",
    readString(item.Director) ?? "-",
    readString(item.Writer) ?? "-",
    readString(item.Awards) ?? "-",
  ];
  return {
    title: "Ficha tecnica textual",
    columns: ["Titulo", "Genero", "Direcao", "Roteiro", "Premios"],
    rows: [row("Filme", movie), row("Serie", series)],
  };
}
