import type { AgendaEvent, MonitoredTitleState } from "@/server/agenda/types";
import { classifyAirDate, daysBetweenDates } from "@/server/agenda/temporal-layer-engine";
import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { CACHE_TTL } from "@/server/cache/cache-config";
import { logUserEvent } from "@/server/state/user-title-state";

type TmdbTvDetails = {
  id: number;
  name: string;
  poster_path: string | null;
  backdrop_path: string | null;
  status: string | null;
  next_episode_to_air?: {
    air_date?: string | null;
    season_number?: number | null;
    episode_number?: number | null;
    name?: string | null;
    still_path?: string | null;
    runtime?: number | null;
  } | null;
};

export class PriorityMonitorService {
  async checkMonitoredTitle(
    userId: string,
    state: MonitoredTitleState,
  ): Promise<AgendaEvent[]> {
    if (state.mediaType !== "tv") return [];

    const details = await tmdbFetch<TmdbTvDetails>(`/tv/${state.tmdbId}`, {
      params: { append_to_response: "watch/providers,content_ratings,keywords" },
      revalidate: CACHE_TTL.tmdb.agendaPriority,
    });

    const nextEpisode = details.next_episode_to_air ?? null;
    const nextAirDate = nextEpisode?.air_date ?? null;
    const events: AgendaEvent[] = [];

    if (nextAirDate && nextAirDate !== state.lastKnownNextEpisode) {
      events.push({
        id: `priority-new-episode-tv-${details.id}-${nextAirDate}`,
        type: "episode_new",
        tmdbId: details.id,
        mediaType: "tv",
        title: details.name,
        posterPath: details.poster_path,
        backdropPath: details.backdrop_path,
        layer: classifyAirDate(nextAirDate),
        airDate: nextAirDate,
        daysUntil: daysBetweenDates(nextAirDate),
        seasonNumber: nextEpisode?.season_number ?? undefined,
        episodeNumber: nextEpisode?.episode_number ?? undefined,
        episodeName: nextEpisode?.name ?? null,
        episodeStillPath: nextEpisode?.still_path ?? null,
        runtime: nextEpisode?.runtime ?? null,
        visualWeight: "card",
        score: 120,
      });

      logUserEvent({
        userId,
        tmdbId: details.id,
        mediaType: "tv",
        eventType: "availability_synced",
        payload: {
          agendaEvent: "new_episode",
          nextAirDate,
          seasonNumber: nextEpisode?.season_number ?? null,
          episodeNumber: nextEpisode?.episode_number ?? null,
        },
      });
    }

    if (details.status && details.status !== state.lastKnownStatus) {
      logUserEvent({
        userId,
        tmdbId: details.id,
        mediaType: "tv",
        eventType: "availability_synced",
        payload: {
          agendaEvent: "status_changed",
          previousStatus: state.lastKnownStatus,
          currentStatus: details.status,
        },
      });
    }

    return events;
  }
}

export const priorityMonitorService = new PriorityMonitorService();
