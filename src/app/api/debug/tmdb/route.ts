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

const BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w342";

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return adminUnauthorizedResponse();

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    return NextResponse.json(buildMissingKeyResponse("TMDB", "TMDB_API_KEY"), {
      headers: jsonHeaders(),
    });
  }

  const startedAt = Date.now();
  const endpoints = await Promise.all([
    tmdb("Search multi", "/search/multi", apiKey, { query: "The Last of Us", language: "pt-BR" }),
    tmdb("Trending semana", "/trending/all/week", apiKey, { language: "pt-BR" }),
    tmdb("Discover filmes BR Netflix", "/discover/movie", apiKey, {
      language: "pt-BR",
      sort_by: "popularity.desc",
      watch_region: "BR",
      with_watch_providers: "8",
    }),
    tmdb("Movie details consolidado", "/movie/550", apiKey, {
      language: "pt-BR",
      append_to_response: "credits,images,videos,external_ids,watch/providers,recommendations,release_dates",
      include_image_language: "pt,en,null",
    }),
    tmdb("TV details consolidado", "/tv/1399", apiKey, {
      language: "pt-BR",
      append_to_response: "credits,images,videos,external_ids,watch/providers,recommendations,content_ratings",
      include_image_language: "pt,en,null",
    }),
  ]);

  const search = asRecord(endpoints[0]?.data);
  const trending = asRecord(endpoints[1]?.data);
  const discover = asRecord(endpoints[2]?.data);
  const movie = asRecord(endpoints[3]?.data);
  const tv = asRecord(endpoints[4]?.data);

  const movieCards = [
    ...cardsFromResults(asArray(search.results), 6),
    ...cardsFromResults(asArray(trending.results), 6),
  ].slice(0, 10);
  const discoverCards = cardsFromResults(asArray(discover.results), 8);

  const sections: DebugSection[] = [
    {
      title: "Busca e trending",
      description: "Mostra como a API cobre busca textual, mídia mista e sinais de popularidade.",
      cards: movieCards,
      bullets: [
        `Busca retornou ${asArray(search.results).length} itens na primeira pagina.`,
        `Trending retornou ${asArray(trending.results).length} itens na semana.`,
      ],
    },
    {
      title: "Discover com filtro regional",
      description: "Amostra de discover por provider e regiao, util para testar filtros editoriais.",
      cards: discoverCards,
    },
    {
      title: "Detalhes consolidados por append_to_response",
      description: "Uma unica chamada por titulo agregando creditos, imagens, videos, IDs externos, providers, recomendacoes e datas.",
      cards: [detailCard(movie), detailCard(tv)],
      tables: [
        providerTable("Providers filme", movie),
        providerTable("Providers serie", tv),
        externalIdsTable(movie, tv),
        mediaAssetsTable(movie, tv),
      ],
    },
  ];

  return NextResponse.json(responseEnvelope({
    api: "TMDB",
    configured: true,
    startedAt,
    summary: {
      description: "Catalogo cinematografico amplo com busca, discovery, imagens, videos, creditos, IDs externos e metadados editoriais.",
      bestFor: ["catalogo principal", "imagens", "creditos", "busca", "descoberta", "IDs externos"],
      dataTypes: ["movie", "tv", "person", "images", "videos", "credits", "release_dates", "watch/providers"],
      impression: "Parece a melhor base canônica para identidade, pagina de titulo e navegacao editorial.",
    },
    capabilities: [
      "search multi",
      "trending",
      "discover regional",
      "movie details",
      "tv details",
      "append_to_response",
      "credits",
      "images",
      "videos",
      "external IDs",
      "watch providers",
      "recommendations",
      "release dates",
    ],
    sections,
    observations: [
      "append_to_response reduz varias chamadas em telas de detalhe.",
      "Providers do TMDB existem, mas parecem mais adequados como sinal de disponibilidade do que como fonte unica de verdade.",
      "A API oferece excelente material visual e estrutural para UI final do POPLOG.",
    ],
    endpoints,
  }), { headers: jsonHeaders() });
}

function tmdb(label: string, path: string, apiKey: string, params: Record<string, string>) {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("api_key", apiKey);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return timedJson(label, url.toString());
}

function cardsFromResults(results: unknown[], limit: number): DebugCard[] {
  return results.slice(0, limit).map((item) => {
    const record = asRecord(item);
    const title = readString(record.title) ?? readString(record.name) ?? "Sem titulo";
    const year = (readString(record.release_date) ?? readString(record.first_air_date) ?? "").slice(0, 4);
    const posterPath = readString(record.poster_path);
    return {
      title,
      subtitle: limitText(record.overview, "Sem sinopse curta.", 110),
      image: posterPath ? `${IMAGE_BASE}${posterPath}` : null,
      badges: compact([
        readString(record.media_type) ?? "movie",
        year,
        readNumber(record.vote_average)?.toFixed(1),
      ]),
      meta: compact([
        readNumber(record.id) ? `tmdb ${readNumber(record.id)}` : undefined,
        readNumber(record.popularity) ? `pop ${Math.round(readNumber(record.popularity) ?? 0)}` : undefined,
      ]),
    };
  });
}

function detailCard(record: Record<string, unknown>): DebugCard {
  const posterPath = readString(record.poster_path);
  const genres = asArray(record.genres).map((genre) => readString(asRecord(genre).name) ?? "").filter(Boolean);
  return {
    title: readString(record.title) ?? readString(record.name) ?? "Titulo detalhado",
    subtitle: limitText(record.overview, "Sem overview.", 160),
    image: posterPath ? `${IMAGE_BASE}${posterPath}` : null,
    badges: compact([
      readString(record.release_date)?.slice(0, 4) ?? readString(record.first_air_date)?.slice(0, 4),
      readNumber(record.vote_average)?.toFixed(1),
      readNumber(record.runtime) ? `${readNumber(record.runtime)} min` : undefined,
      readNumber(record.number_of_seasons) ? `${readNumber(record.number_of_seasons)} temporadas` : undefined,
    ]),
    meta: unique(genres, 4),
  };
}

function providerTable(title: string, detail: Record<string, unknown>) {
  const providers = asRecord(asRecord(asRecord(detail["watch/providers"]).results).BR);
  const rows = ["flatrate", "rent", "buy", "ads", "free"].map((kind) => {
    const names = asArray(providers[kind]).map((provider) => readString(asRecord(provider).provider_name) ?? "").filter(Boolean);
    return [kind, names.length ? names.join(", ") : "Nao retornado"];
  });
  return { title, columns: ["Tipo", "Providers BR"], rows };
}

function externalIdsTable(movie: Record<string, unknown>, tv: Record<string, unknown>) {
  const movieIds = asRecord(movie.external_ids);
  const tvIds = asRecord(tv.external_ids);
  return {
    title: "IDs externos",
    columns: ["Titulo", "IMDb", "TVDb", "Facebook/Wikidata"],
    rows: [
      [readString(movie.title) ?? "Filme", readString(movieIds.imdb_id) ?? "-", readString(movieIds.tvdb_id) ?? "-", readString(movieIds.wikidata_id) ?? "-"],
      [readString(tv.name) ?? "Serie", readString(tvIds.imdb_id) ?? "-", readString(tvIds.tvdb_id) ?? "-", readString(tvIds.wikidata_id) ?? "-"],
    ],
  };
}

function mediaAssetsTable(movie: Record<string, unknown>, tv: Record<string, unknown>) {
  const row = (label: string, detail: Record<string, unknown>) => {
    const images = asRecord(detail.images);
    const videos = asRecord(detail.videos);
    const credits = asRecord(detail.credits);
    const recommendations = asRecord(detail.recommendations);
    return [
      label,
      String(asArray(images.posters).length),
      String(asArray(images.backdrops).length),
      String(asArray(videos.results).length),
      String(asArray(credits.cast).length),
      String(asArray(recommendations.results).length),
    ];
  };
  return {
    title: "Volume de dados anexados",
    columns: ["Titulo", "Posters", "Backdrops", "Videos", "Cast", "Recomendacoes"],
    rows: [row("Filme", movie), row("Serie", tv)],
  };
}
