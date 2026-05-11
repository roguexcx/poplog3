import { NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";
import { normalizeEpisode } from "@/lib/series-normalization";

type TMDBEpisode = {
  episode_number: number;
  name?: string;
  overview?: string;
  still_path?: string | null;
  air_date?: string | null;
};

type TMDBSeasonResponse = {
  episodes?: TMDBEpisode[];
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const tvId = searchParams.get("tvId");
  const season = searchParams.get("season");

  if (!tvId || !season) {
    return NextResponse.json({ episodes: [] }, { status: 400 });
  }

  try {
    const data = (await tmdbFetch(`/tv/${tvId}/season/${season}`, {
      language: "pt-BR",
    })) as TMDBSeasonResponse;

    const episodes = (data.episodes ?? [])
      .map((episode) => normalizeEpisode(episode))
      .filter((episode) => episode.status === "released" || episode.status === "scheduled");

    return NextResponse.json({ episodes });
  } catch {
    return NextResponse.json({ episodes: [] }, { status: 200 });
  }
}
