import {
  formatEpisodeRuntimeLabel,
  formatRuntimeLabel,
  parseYearLabel,
  translateGenreName,
} from "@/lib/domain-labels";

import { resolveRuntimeByMediaType } from "@/lib/runtime";

const HEADLINES: Record<string, [string, string, string][]> = {
  madrugada: [
    ["Ainda acordado?", "Temos algo", "pra você."],
    ["Insônia é melhor", "com um bom", "filme."],
    ["Noite funda.", "Escolha algo", "marcante."],
  ],
  manha: [
    ["Bom dia.", "O que vamos", "assistir hoje?"],
    ["Café pronto?", "Falta escolher", "a série."],
    ["Começa bem", "o dia com", "boa ficção."],
  ],
  tarde: [
    ["Tarde livre?", "Aproveite com", "um bom filme."],
    ["Descubra algo", "incrível para", "mais tarde."],
    ["Relaxa.", "A curadoria", "chegou."],
  ],
  noite: [
    ["Descubra o", "próximo título", "da sua noite."],
    ["Pipoca pronta?", "Escolha o", "filme de hoje."],
    ["Noite de", "cinema", "começa aqui."],
  ],
};

function getBrasiliaHour(): number {
  return (new Date().getUTCHours() - 3 + 24) % 24;
}

export function getHeroHeadline(): [string, string, string] {
  const hour = getBrasiliaHour();

  let pool: [string, string, string][];

  if (hour >= 6 && hour < 12) {
    pool = HEADLINES.manha;
  } else if (hour >= 12 && hour < 18) {
    pool = HEADLINES.tarde;
  } else if (hour >= 18 && hour < 24) {
    pool = HEADLINES.noite;
  } else {
    pool = HEADLINES.madrugada;
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

export function translateGenres(
  genres: Array<string | { name: string }>,
  limit = 2
): string {
  return genres
    .slice(0, limit)
    .map((g) => {
      const name = typeof g === "string" ? g : (typeof g === "object" && g !== null ? g.name : String(g));
      return translateGenreName(name) ?? name;
    })
    .join(" • ");
}

export function formatRuntime(
  mediaType: "movie" | "tv",
  runtime?: number | null,
  episodeRuntime?: number[] | null
): string | null {
  const runtimeResolution = resolveRuntimeByMediaType({
    mediaType,
    runtimeMinutes: runtime,
    episodeRunTime: episodeRuntime,
  });

  if (runtimeResolution.minutes === null) {
    return null;
  }

  if (mediaType === "tv") {
    return formatEpisodeRuntimeLabel(runtimeResolution.minutes, {
      estimated: runtimeResolution.estimated,
    });
  }

  return formatRuntimeLabel(runtimeResolution.minutes, {
    estimated: runtimeResolution.estimated,
  });
}

export function parseYear(
  releaseDate?: string | null,
  firstAirDate?: string | null
): string | null {
  return parseYearLabel(releaseDate, firstAirDate);
}
