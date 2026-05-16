import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getHeroCandidates } from "@/server/continuity/hero-candidates";
import { recordHeroImpressions } from "@/server/continuity/hero-impressions";
import { getCachedEpisode } from "@/server/cache/season-cache";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Usuário não autenticado." },
        { status: 401 },
      );
    }

    const result = await getHeroCandidates(user.id, {
      limit: 5,
      region: "BR",
    });

    // Fire-and-forget: analytics não bloqueia a resposta
    if (result && result.candidates && result.candidates.length > 0) {
      recordHeroImpressions({ userId: user.id, candidates: result.candidates }).catch(
        (e) => console.error("[hero/impressions]", e)
      );
    }

    // Enriquece candidatos de série com nome e still em paralelo
    const episodeData = await Promise.all(
      result.candidates.map(async (cand) => {
        if (cand.mediaType !== "tv") return null;
        const tmdbId = parseInt(cand.id.replace("tv-", ""), 10);
        const season = cand.progress?.nextSeason;
        const episode = cand.progress?.nextEpisode;
        if (!tmdbId || !season || !episode) return null;
        return getCachedEpisode(tmdbId, season, episode);
      })
    );

    const mappedItems = result.candidates.map((cand, i) => {
      const isTv = cand.mediaType === "tv";
      const ep = episodeData[i];

      return {
        id: cand.id,
        user_id: user.id,
        content_id: cand.id,
        content_type: isTv ? "serie" : "filme",
        title: cand.title,
        overview: cand.overview,
        poster_path: cand.posterPath,
        backdrop_path: cand.backdropPath,
        dominant_color: cand.availability?.isPreferred ? "#231545" : "#111218",
        status: cand.context === "watchlist" ? "watchlist" : "watching",
        score: cand.score,
        year: cand.year,
        
        current_season: cand.progress?.nextSeason ?? null,
        current_episode: cand.progress?.nextEpisode ? Math.max(cand.progress.nextEpisode - 1, 0) : null,
        total_episodes_season: cand.progress?.totalEpisodes ?? null,
        episodes_watched: cand.progress?.watchedEpisodes ?? null,
        
        next_episode_name: isTv && cand.progress?.nextEpisode
          ? (ep?.name ?? `Episódio ${cand.progress.nextEpisode}`)
          : null,
        next_episode_duration: isTv ? 45 : cand.progress?.runtimeMinutes ?? null,
        next_episode_air_date: null,
        next_episode_still_path: ep?.still_path ?? null,
        new_episode_available: cand.context === "new_episode",
        
        runtime: cand.progress?.runtimeMinutes ?? null,
        watch_progress_minutes: cand.context === "resume" && !isTv ? 45 : null,
        
        // INTEGRAÇÃO EXCLUSIVA: O nome do streaming vai apenas para o local correto
        streaming_platform: cand.availability?.providerName ?? null,
        // HIGIENIZADO: Gêneros limpos passados sem carregar metadados paralelos
        genres: cand.labels, 
        
        serverEyebrow: (cand as any).serverEyebrow ?? { text: cand.contextLabel, color: "#a07ee0" },
        serverCta: (cand as any).actions?.serverCta ?? { primary: "Assistir agora", icon: "play" }
      };
    });

    return NextResponse.json({
      candidates: mappedItems,
      generatedAt: result.generatedAt
    });
  } catch (error) {
    console.error("[api/poplog3/continuity/hero] failed", error);
    return NextResponse.json(
      { error: "Erro ao gerar candidatos do Hero." },
      { status: 500 },
    );
  }
}