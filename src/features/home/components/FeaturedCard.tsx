// src/features/home/components/FeaturedCard.tsx

import Link from "next/link";
import FeaturedCardActions from "@/features/home/components/FeaturedCardActions";
import SynopsisText from "@/features/home/components/SynopsisText";
import { getRating } from "@/lib/tmdb-utils";
import type { TMDBItem } from "@/lib/tmdb-types";

type Props = {
  item: TMDBItem;
  mediaType: "movie" | "tv";
  title: string;
  featuredRank: number | null;
  featuredTypeLabel: string;
  posterUrl: string | null;
  year: string | null;
  runtime: string | null;
  seasons: number | null;
  genres: string | null;
  overview: string | null;
};

export default function FeaturedCard({
  item,
  mediaType,
  title,
  featuredRank,
  featuredTypeLabel,
  posterUrl,
  year,
  runtime,
  seasons,
  genres,
  overview,
}: Props) {
  return (
    <div className="hidden justify-end lg:flex">
      <div className="w-full max-w-[500px] translate-y-4">
        <p className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.28em] text-sky-300">
  <span className="text-violet-300">↗</span>
  {featuredRank
  ? `#${featuredRank} entre ${featuredTypeLabel} em alta`
  : "Em alta agora"}
</p>

        <div className="grid grid-cols-[132px_1fr] gap-5">
          {/* Poster */}
          <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-white/5 shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
            {posterUrl && (
              <img src={posterUrl} alt={title} className="h-full w-full object-cover" />
            )}
          </div>

          {/* Info */}
          <div className="min-w-0 pt-2">
            <h2 className="text-[1.45rem] font-black leading-tight text-white">{title}</h2>

            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs font-semibold text-zinc-300">
              <span className="text-violet-300">★ {getRating(item) ?? "N/A"}</span>

              {year && <span>• {year}</span>}

              {mediaType === "movie" && runtime && <span>• {runtime}</span>}

              {mediaType === "tv" && seasons && (
                <span>• {seasons} {seasons === 1 ? "temporada" : "temporadas"}</span>
              )}

              {mediaType === "tv" && runtime && <span>• ~{runtime}/ep</span>}

              {genres && <span className="text-zinc-400">• {genres}</span>}
            </div>

            <SynopsisText
  text={overview}
  collapsedLines={3}
  className="mt-4 max-w-[320px]"
/>

            <div className="mt-5 flex items-center gap-2">
  <Link
    href={`/title/${mediaType}/${item.id}`}
    className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-xs font-bold text-white backdrop-blur-md transition hover:bg-white/15"
  >
    Ver detalhes
  </Link>

  <FeaturedCardActions
    tmdbId={item.id}
    mediaType={mediaType}
    title={title}
    releaseYear={year ? Number(year) : null}
  />
</div>
          </div>
        </div>
      </div>
    </div>
  );
}