import { NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const tvId = searchParams.get("tvId");
  const season = searchParams.get("season");

  if (!tvId || !season) {
    return NextResponse.json({ episodes: [] }, { status: 400 });
  }

  try {
    const data = await tmdbFetch(`/tv/${tvId}/season/${season}`, {
      language: "pt-BR",
    });

    const today = new Date();

    const episodes = (data.episodes ?? []).map(
      (episode: {
        episode_number: number;
        name?: string;
        overview?: string;
        still_path?: string | null;
        air_date?: string | null;
      }) => {
        const airDate = episode.air_date ? new Date(episode.air_date) : null;

        return {
          episode_number: episode.episode_number,
          name: episode.name,
          overview: episode.overview,
          still_path: episode.still_path,
          air_date: episode.air_date,
          available: !airDate || airDate <= today,
        };
      },
    );

    return NextResponse.json({ episodes });
  } catch {
    return NextResponse.json({ episodes: [] }, { status: 200 });
  }
}