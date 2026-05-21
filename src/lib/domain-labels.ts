import type { MediaType } from "@/types/user";

export const GENRE_LABEL_BY_ID: Record<number, string> = {
  28: "Ação",
  12: "Aventura",
  16: "Animação",
  35: "Comédia",
  80: "Crime",
  99: "Documentário",
  18: "Drama",
  10751: "Família",
  14: "Fantasia",
  36: "História",
  27: "Terror",
  10402: "Música",
  9648: "Mistério",
  10749: "Romance",
  878: "Ficção científica",
  10770: "Cinema TV",
  53: "Suspense",
  10752: "Guerra",
  37: "Faroeste",
  10759: "Ação & aventura",
  10762: "Infantil",
  10763: "Notícias",
  10764: "Reality",
  10765: "Sci-fi & fantasia",
  10766: "Novela",
  10767: "Talk show",
  10768: "Guerra & política",
};

export const GENRE_TRANSLATION_BY_NAME: Record<string, string> = {
  "Sci-Fi & Fantasy": "Ficção científica e fantasia",
  "Action & Adventure": "Ação e aventura",
  Action: "Ação",
  Adventure: "Aventura",
  Animation: "Animação",
  Comedy: "Comédia",
  Crime: "Crime",
  Documentary: "Documentário",
  Drama: "Drama",
  Family: "Família",
  Fantasy: "Fantasia",
  History: "História",
  Horror: "Terror",
  Mystery: "Mistério",
  Romance: "Romance",
  "Science Fiction": "Ficção científica",
  Soap: "Novela",
  Thriller: "Suspense",
  War: "Guerra",
  Western: "Faroeste",
  Kids: "Infantil",
  News: "Notícias",
  Reality: "Reality",
  Talk: "Talk show",
  "War & Politics": "Guerra e política",
};

export const MEDIA_TYPE_LABEL: Record<MediaType, string> = {
  movie: "Filme",
  tv: "Série",
};

export const STREAM_STATUS_LABEL: Record<string, string> = {
  streaming: "Disponível no streaming",
  chegando: "Chegando ao streaming",
  cinemas: "Em cartaz / cinemas",
  confirmado: "Disponibilidade confirmada",
  unavailable: "Indisponível",
};

export type RuntimeLabelOptions = {
  estimated?: boolean;
  suffix?: string;
  fallback?: string | null;
  spaced?: boolean;
};

export function translateGenreName(name?: string | null): string | null {
  if (!name) return null;
  return GENRE_TRANSLATION_BY_NAME[name] ?? name;
}

export function genreLabelFromIds(ids: number[]): string[] {
  return ids.map((id) => GENRE_LABEL_BY_ID[id]).filter(Boolean);
}

export function getContentTypeLabel(
  type: string,
  genreIds: number[] = []
): string {
  const genres = new Set(genreIds);

  if (type === "movie") {
    if (genres.has(99)) return "Documentário";
    if (genres.has(16)) return "Animação";
    if (genres.has(10770)) return "Filme para TV";
    return MEDIA_TYPE_LABEL.movie;
  }

  if (type === "tv") {
    if (genres.has(10764)) return "Reality";
    if (genres.has(99)) return "Documentário";
    if (genres.has(10766)) return "Novela";
    if (genres.has(10767)) return "Talk show";
    if (genres.has(10763)) return "Notícias";
    if (genres.has(10762)) return "Infantil";
    if (genres.has(16)) return "Série animada";
    return MEDIA_TYPE_LABEL.tv;
  }

  return "Título";
}

function normalizeRuntimeMinutes(minutes?: number | null): number | null {
  if (typeof minutes !== "number") return null;
  if (!Number.isFinite(minutes)) return null;

  const rounded = Math.round(minutes);
  if (rounded <= 0) return null;

  return rounded;
}

export function formatRuntimeLabel(
  minutes?: number | null,
  options: RuntimeLabelOptions = {}
): string | null {
  const value = normalizeRuntimeMinutes(minutes);

  if (value == null) {
    return options.fallback ?? null;
  }

  const prefix = options.estimated ? "~" : "";
  const separator = options.spaced ? " " : "";

  if (value < 60) {
    return `${prefix}${value}${separator}min${options.suffix ?? ""}`;
  }

  const hours = Math.floor(value / 60);
  const remainingMinutes = value % 60;

  const runtime =
    remainingMinutes > 0
      ? `${hours}h${separator}${remainingMinutes}${separator}min`
      : `${hours}h`;

  return `${prefix}${runtime}${options.suffix ?? ""}`;
}

export function formatEpisodeRuntimeLabel(
  minutes?: number | null,
  options: Omit<RuntimeLabelOptions, "suffix"> = {}
): string | null {
  return formatRuntimeLabel(minutes, {
    ...options,
    suffix: "/ep",
  });
}

export function formatRemainingRuntimeLabel(
  minutes?: number | null,
  options: RuntimeLabelOptions = {}
): string | null {
  const runtime = formatRuntimeLabel(minutes, options);
  return runtime ? `${runtime} restantes` : options.fallback ?? null;
}

export function parseYearLabel(
  releaseDate?: string | null,
  firstAirDate?: string | null
): string | null {
  return releaseDate?.split("-")[0] ?? firstAirDate?.split("-")[0] ?? null;
}