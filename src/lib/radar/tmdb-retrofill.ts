// ── src/lib/radar/tmdb-retrofill.ts ─────────────────────────────────────────
// Preenchimento retroativo de episódios via TMDB — RAW_BDS_MODE.
//
// Regra central:
//   Para cada grupo com tmdb_id, para cada episódio vindo do Banco de Séries,
//   procura apenas o episódio imediatamente anterior (N-1) da mesma temporada.
//   Se não houver, usa fallback: último episódio com air_date < data BDS e dentro
//   da janela de interesse (ultimos 7-14 dias).
//
//   No maximo 1 episodio retroativo adicionado por grupo/temporada por execucao.
//
// Deduplicacao:
//   Apos o retrofill, deduplica por (season + episode). BDS vence TMDB em duplicatas.
//   Recalcula episodeCount, nextAirDate e lastAirDate.
//
// Protecoes:
//   - Cache em memoria por tmdb_id+season (evita consultas repetidas)
//   - MAX_SEASONS_PER_RUN limita o total de consultas TMDB por pipeline
//   - Delay entre requests para nao estourar rate-limit
//   - Fallback silencioso em erros HTTP
// ────────────────────────────────────────────────────────────────────────────

import type { IcsSeriesGroup, SeriesEpisodeWindow } from "@/lib/ics-engine";

const TMDB_BASE = "https://api.themoviedb.org/3";

// Janela: episodio anterior aceitavel se air_date >= hoje - RETRO_WINDOW_DAYS
const RETRO_WINDOW_DAYS     = 14;
// Limite de grupos processados por execucao
const MAX_SEASONS_PER_RUN = Number(process.env.RADAR_RETROFILL_MAX_SEASONS ?? 600);
// Delay entre requests TMDB (ms)
const TMDB_REQUEST_DELAY_MS = 120;

// Cache em memoria — valido apenas durante a execucao do pipeline
const seasonCache = new Map<string, TmdbSeasonEpisode[]>();

interface TmdbSeasonEpisode {
  episode_number: number;
  season_number:  number;
  name:           string | null;
  air_date:       string | null;
  overview:       string | null;
  still_path:     string | null;
  runtime:        number | null;
}

interface TmdbSeasonResponse {
  episodes?: TmdbSeasonEpisode[];
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateAddDays(days: number, base?: string): string {
  const d = base ? new Date(base) : new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function epLabel(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

function epKey(season: number, episode: number): string {
  return `s${season}e${episode}`;
}

// ── Fetch de temporada via TMDB ───────────────────────────────────────────────

async function fetchSeasonEpisodes(
  tmdbId: number,
  seasonNumber: number,
  accessToken: string,
): Promise<TmdbSeasonEpisode[]> {
  const key = `${tmdbId}_s${seasonNumber}`;
  if (seasonCache.has(key)) {
    console.log(
      `[radar-retrofill] cache-hit tmdbId=${tmdbId} season=${seasonNumber}` +
      ` episodes=${seasonCache.get(key)!.length}`,
    );
    return seasonCache.get(key)!;
  }

  try {
    const res = await fetch(
      `${TMDB_BASE}/tv/${tmdbId}/season/${seasonNumber}?language=pt-BR`,
      {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        cache: "no-store",
      },
    );
    if (!res.ok) {
      console.log(
        `[radar-retrofill] skipped tmdbId=${tmdbId} season=${seasonNumber}` +
        ` reason="http_${res.status}"`,
      );
      seasonCache.set(key, []);
      return [];
    }
    const data = await res.json() as TmdbSeasonResponse;
    const episodes = data.episodes ?? [];
    seasonCache.set(key, episodes);
    console.log(
      `[radar-retrofill] fetched tmdbId=${tmdbId} season=${seasonNumber}` +
      ` episodes=${episodes.length}`,
    );
    return episodes;
  } catch {
    console.log(
      `[radar-retrofill] skipped tmdbId=${tmdbId} season=${seasonNumber}` +
      ` reason="fetch_error"`,
    );
    seasonCache.set(key, []);
    return [];
  }
}

// ── Deduplicacao pos-retrofill ────────────────────────────────────────────────
//
// Por (season + episode): BDS vence TMDB.
// Remove duplicatas, recalcula episodeCount / nextAirDate / lastAirDate.

function deduplicateEpisodes(group: IcsSeriesGroup, title: string): void {
  const isBds   = (ep: SeriesEpisodeWindow) => !ep.uid.startsWith("tmdb_retro_");
  const isRetro = (ep: SeriesEpisodeWindow) =>  ep.uid.startsWith("tmdb_retro_");

  // Chaves dos episodios BDS
  const bdsKeys = new Set<string>();
  for (const ep of group.episodes) {
    if (isBds(ep) && ep.season > 0 && ep.episode > 0) {
      bdsKeys.add(epKey(ep.season, ep.episode));
    }
  }

  // Filtrar retroativos: remover os que colidem com BDS
  const filtered: SeriesEpisodeWindow[] = [];
  for (const ep of group.episodes) {
    if (isRetro(ep) && ep.season > 0 && ep.episode > 0) {
      const k = epKey(ep.season, ep.episode);
      if (bdsKeys.has(k)) {
        console.log(
          `[radar-retrofill] deduped title="${title}"` +
          ` episode=${epLabel(ep.season, ep.episode)} kept="bds" removed="tmdb_retrofill"`,
        );
        continue;
      }
    }
    filtered.push(ep);
  }

  // Deduplicacao BDS+BDS (mesmo s+e, mantém o primeiro)
  const seen = new Set<string>();
  const deduped: SeriesEpisodeWindow[] = [];
  for (const ep of filtered) {
    const k = ep.season > 0 && ep.episode > 0 ? epKey(ep.season, ep.episode) : ep.uid;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(ep);
  }

  // Ordenar por startAt, depois season, depois episode
  deduped.sort((a, b) => {
    const da = a.startAt.slice(0, 10);
    const db = b.startAt.slice(0, 10);
    if (da !== db) return da.localeCompare(db);
    if (a.season !== b.season) return a.season - b.season;
    return a.episode - b.episode;
  });

  group.episodes = deduped;

  // Recalcular contagens e datas
  group.episodeCount = deduped.length;

    const today = todayStr();
  const allDates = deduped
    .map((e) => e.startAt.slice(0, 10))
    .filter(Boolean)
    .sort();

  const futureDates = allDates.filter((d) => d >= today);

  if (futureDates.length > 0) {
    group.nextAirDate = `${futureDates[0]}T00:00:00`;
  } else if (allDates.length > 0) {
    group.nextAirDate = `${allDates[allDates.length - 1]}T00:00:00`;
  }

  if (allDates.length > 0) {
    group.lastAirDate = `${allDates[allDates.length - 1]}T00:00:00`;
  }
}

// ── Logica principal de retrofill ─────────────────────────────────────────────
//
// Para cada grupo:
//   1. Identificar episodios BDS com season+episode validos
//   2. Para cada temporada, consultar TMDB uma vez
//   3. Para o episodio BDS de maior numero na temporada, procurar o N-1
//   4. Fallback: ultimo episodio com air_date < data BDS dentro da janela
//   5. Adicionar no maximo 1 episodio retroativo por grupo/temporada

export async function applyRetrofill(
  groups: IcsSeriesGroup[],
  accessToken: string,
): Promise<void> {
  if (!accessToken) return;

  const today       = todayStr();
  const windowStart = dateAddDays(-RETRO_WINDOW_DAYS);

  // Coletar targets unicos: um por (tmdbId, seasonNumber)
  type Target = { group: IcsSeriesGroup; tmdbId: number; seasonNumber: number };
  const targets: Target[]  = [];
  const targetKeys          = new Set<string>();

  for (const group of groups) {
    const tmdbId = group.tmdb?.tmdb_id;
    if (!tmdbId) continue;

    const bdsEps = group.episodes.filter(
      (ep) => !ep.uid.startsWith("tmdb_retro_") && ep.season > 0,
    );
    if (bdsEps.length === 0) continue;

    const seasons = [...new Set(bdsEps.map((ep) => ep.season))];

    for (const seasonNumber of seasons) {
      const key = `${tmdbId}_s${seasonNumber}`;
      if (targetKeys.has(key)) continue;
      targetKeys.add(key);
      targets.push({ group, tmdbId, seasonNumber });

      const bdsInSeason = bdsEps.filter((ep) => ep.season === seasonNumber);
      const minEp = Math.min(...bdsInSeason.map((ep) => ep.episode));
const refEp = bdsInSeason.find((ep) => ep.episode === minEp)!;
const bdsDate = refEp.startAt.slice(0, 10);

console.log(
  `[radar-retrofill] inspect title="${group.rawTitle}"` +
  ` tmdbId=${tmdbId} season=${seasonNumber}` +
  ` anchor=${epLabel(seasonNumber, minEp)}` +
  ` previous=${epLabel(seasonNumber, minEp - 1)}` +
  ` sourceDate=${bdsDate}`,
);

      if (targets.length >= MAX_SEASONS_PER_RUN) break;
    }
    if (targets.length >= MAX_SEASONS_PER_RUN) break;
  }

  console.log(
    `[radar-retrofill] starting retrofill for ${targets.length} targets` +
    ` (max ${MAX_SEASONS_PER_RUN}) windowStart=${windowStart}`,
  );

  for (let i = 0; i < targets.length; i++) {
    const { group, tmdbId, seasonNumber } = targets[i];

    const tmdbEpisodes = await fetchSeasonEpisodes(tmdbId, seasonNumber, accessToken);
    if (tmdbEpisodes.length === 0) {
      console.log(
        `[radar-retrofill] skipped title="${group.rawTitle}"` +
        ` reason="season_not_found" season=${seasonNumber}`,
      );
      if (i < targets.length - 1) await sleep(TMDB_REQUEST_DELAY_MS);
      continue;
    }

    const bdsInSeason = group.episodes.filter(
      (ep) => !ep.uid.startsWith("tmdb_retro_") && ep.season === seasonNumber && ep.episode > 0,
    );
    if (bdsInSeason.length === 0) {
      if (i < targets.length - 1) await sleep(TMDB_REQUEST_DELAY_MS);
      continue;
    }

    const minBdsEpisode = Math.min(...bdsInSeason.map((ep) => ep.episode));
const refBdsEp      = bdsInSeason.find((ep) => ep.episode === minBdsEpisode)!;
const bdsDate       = refBdsEp.startAt.slice(0, 10);

    const existingKeys = new Set<string>(
      group.episodes.map((ep) =>
        ep.season > 0 && ep.episode > 0 ? epKey(ep.season, ep.episode) : ep.uid,
      ),
    );

    // Candidatos: episodios da mesma temporada com numero < maxBdsEpisode
    const candidates = tmdbEpisodes.filter(
  (ep) => ep.season_number === seasonNumber && ep.episode_number < minBdsEpisode,
);

    if (candidates.length === 0) {
  console.log(
    `[radar-retrofill] skipped title="${group.rawTitle}"` +
    ` reason="no_previous_episodes" season=${seasonNumber}` +
    ` minBdsEp=${minBdsEpisode}`,
  );
      if (i < targets.length - 1) await sleep(TMDB_REQUEST_DELAY_MS);
      continue;
    }

    // 1a opcao: episodio imediatamente anterior (N-1)
    const immediatelyPrev = candidates.find(
  (ep) => ep.episode_number === minBdsEpisode - 1,
);

    // Fallback: ultimo com air_date valido dentro da janela e anterior ao BDS
    const fallback = [...candidates]
      .filter((ep) => ep.air_date && ep.air_date >= windowStart && ep.air_date < bdsDate)
      .sort((a, b) => (b.air_date ?? "").localeCompare(a.air_date ?? ""))[0];

    const chosen = immediatelyPrev ?? fallback;

    if (!chosen) {
      console.log(
        `[radar-retrofill] skipped title="${group.rawTitle}"` +
        ` reason="previous_episode_outside_window" season=${seasonNumber}` +
        ` windowStart=${windowStart} bdsDate=${bdsDate}`,
      );
      if (i < targets.length - 1) await sleep(TMDB_REQUEST_DELAY_MS);
      continue;
    }

    if (!chosen.air_date) {
      console.log(
        `[radar-retrofill] skipped title="${group.rawTitle}"` +
        ` episode=${epLabel(seasonNumber, chosen.episode_number)}` +
        ` reason="missing_air_date"`,
      );
      if (i < targets.length - 1) await sleep(TMDB_REQUEST_DELAY_MS);
      continue;
    }

    const chosenKey = epKey(chosen.season_number, chosen.episode_number);

    if (existingKeys.has(chosenKey)) {
      console.log(
        `[radar-retrofill] skipped title="${group.rawTitle}"` +
        ` episode=${epLabel(chosen.season_number, chosen.episode_number)}` +
        ` reason="already_exists_from_bds"`,
      );
      if (i < targets.length - 1) await sleep(TMDB_REQUEST_DELAY_MS);
      continue;
    }

    if (chosen.air_date < windowStart) {
      console.log(
        `[radar-retrofill] skipped title="${group.rawTitle}"` +
        ` episode=${epLabel(chosen.season_number, chosen.episode_number)}` +
        ` reason="previous_episode_outside_window"` +
        ` airDate=${chosen.air_date} windowStart=${windowStart}`,
      );
      if (i < targets.length - 1) await sleep(TMDB_REQUEST_DELAY_MS);
      continue;
    }

    console.log(
      `[radar-retrofill] previous-found title="${group.rawTitle}"` +
      ` episode=${epLabel(chosen.season_number, chosen.episode_number)}` +
      ` airDate=${chosen.air_date}`,
    );

    const retroEp: SeriesEpisodeWindow = {
      uid:         `tmdb_retro_${tmdbId}_${chosenKey}`,
      season:      chosen.season_number,
      episode:     chosen.episode_number,
      episodeName: chosen.name ?? `Episodio ${chosen.episode_number}`,
      startAt:     `${chosen.air_date}T00:00:00`,
      endAt:       `${chosen.air_date}T01:00:00`,
    };

    group.episodes.push(retroEp);

    console.log(
      `[radar-retrofill] added title="${group.rawTitle}"` +
      ` episode=${epLabel(chosen.season_number, chosen.episode_number)}` +
      ` airDate=${chosen.air_date} source=tmdb_retrofill`,
    );

    if (i < targets.length - 1) await sleep(TMDB_REQUEST_DELAY_MS);
  }

  // ── Deduplicacao + recalculo de datas para todos os grupos processados ────────
  const processedTmdbIds = new Set(targets.map((t) => t.tmdbId));
  for (const group of groups) {
    const tmdbId = group.tmdb?.tmdb_id;
    if (!tmdbId || !processedTmdbIds.has(tmdbId)) continue;
    deduplicateEpisodes(group, group.tmdb?.name ?? group.rawTitle);
  }

  // Suprimir aviso de variavel nao usada (today usado em deduplicateEpisodes via closure)
  void today;

  console.log(`[radar-retrofill] done. processed=${targets.length}`);
}
