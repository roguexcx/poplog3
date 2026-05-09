// src/features/title/TitlePage.tsx

import type { TMDBTitleDetail } from "@/features/title/title-types";
import TitleHero from "@/features/title/TitleHero";
import TitleSynopsisTrailer from "@/features/title/TitleSynopsisTrailer";
import TitleWatchProviders from "@/features/title/TitleWatchProviders";
import TitleSeasons from "@/features/title/TitleSeasons";
import TitleCast from "@/features/title/TitleCast";
import TitleSimilar from "@/features/title/TitleSimilar";

type Props = {
  detail: TMDBTitleDetail;
  mediaType: "movie" | "tv";
};

function pickTrailer(detail: TMDBTitleDetail) {
  const videos = detail.videos?.results ?? [];
  return (
    videos.find((v) => v.site === "YouTube" && v.type === "Trailer" && v.official) ??
    videos.find((v) => v.site === "YouTube" && v.type === "Trailer") ??
    videos.find((v) => v.site === "YouTube" && v.type === "Teaser") ??
    null
  );
}

export default function TitlePage({ detail, mediaType }: Props) {
  const trailer = pickTrailer(detail);
  const trailerKey = trailer?.key ?? null;

  const brProviders = detail["watch/providers"]?.results?.BR;
  const streamProviders = [
    ...(brProviders?.flatrate ?? []).map((p) => ({ ...p, kind: "stream" as const })),
    ...(brProviders?.rent ?? []).map((p) => ({ ...p, kind: "rent" as const })),
  ];

  const cast = detail.credits?.cast?.slice(0, 5) ?? [];
  const crew = detail.credits?.crew ?? [];
  const director = crew.find((c) => c.job === "Director") ?? null;
  const createdBy = detail.created_by?.[0] ?? null;

  const relatedItems = [
    ...(detail.recommendations?.results ?? []),
    ...(detail.similar?.results ?? []),
  ]
    .filter((item, i, arr) => arr.findIndex((x) => x.id === item.id) === i)
    .slice(0, 5);

  const seasons = (detail.seasons ?? []).filter((s) => s.season_number > 0);

  return (
    <div style={{ background: "#080810", minHeight: "100vh" }}>
      <TitleHero detail={detail} mediaType={mediaType} />

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "32px 24px" }}>
        <TitleSynopsisTrailer
          overview={detail.overview ?? null}
          trailerKey={trailerKey}
          trailerName={trailer?.name ?? null}
        />

        {streamProviders.length > 0 && (
          <div style={{ marginTop: "24px" }}>
            <TitleWatchProviders providers={streamProviders} />
          </div>
        )}

        {mediaType === "tv" && seasons.length > 0 && (
          <div style={{ marginTop: "24px" }}>
            <TitleSeasons
              tmdbId={detail.id}
              seasons={seasons}
              totalEpisodes={detail.number_of_episodes ?? 0}
            />
          </div>
        )}

        <div style={{ marginTop: "24px" }}>
          <TitleCast
            cast={cast}
            director={director}
            createdBy={createdBy}
            detail={detail}
            mediaType={mediaType}
          />
        </div>

        {relatedItems.length > 0 && (
          <div style={{ marginTop: "24px" }}>
            <TitleSimilar items={relatedItems} mediaType={mediaType} />
          </div>
        )}
      </div>
    </div>
  );
}
