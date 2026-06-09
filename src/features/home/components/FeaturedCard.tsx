import Image from "next/image";
import Link from "next/link";
import LibraryStateBadge from "@/components/ui/LibraryStateBadge";
import FeaturedCardActions from "@/features/home/components/FeaturedCardActions";
import SynopsisText from "@/features/home/components/SynopsisText";
import LocalizedTitle from "@/components/titles/LocalizedTitle";
import { getOriginalTitle, getRating } from "@/lib/tmdb-utils";
import type { TMDBItem } from "@/types/tmdb";

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
  const originalTitle = getOriginalTitle(item);
  const linkId = item.linkIdUsed ?? item.poplogId ?? item.externalIds?.imdbId ?? item.id;

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
          <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-white/5 shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
            {posterUrl && (
              <Image
                src={posterUrl}
                alt={title}
                fill
                priority
                sizes="132px"
                className="object-cover"
              />
            )}
            <LibraryStateBadge
              tmdbId={item.id > 0 ? item.id : undefined}
              poplogId={item.poplogId}
              imdbId={item.externalIds?.imdbId}
              mediaType={mediaType}
            />
          </div>

          <div className="min-w-0 pt-2">
            <LocalizedTitle
              as="h2"
              title={title}
              originalTitle={originalTitle}
              variant="large"
            />

            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs font-semibold text-zinc-300">
              <span className="text-violet-300">★ {getRating(item) ?? "N/A"}</span>

              {year && <span>• {year}</span>}

              {mediaType === "movie" && runtime && <span>• {runtime}</span>}

              {mediaType === "tv" && seasons && (
                <span>• {seasons} {seasons === 1 ? "temporada" : "temporadas"}</span>
              )}

              {mediaType === "tv" && runtime && <span>• {runtime}</span>}

              {genres && <span className="text-zinc-400">• {genres}</span>}
            </div>

            <SynopsisText
              text={overview}
              collapsedLines={3}
              className="mt-4 max-w-[320px]"
            />

            <div className="mt-5 flex items-center gap-2">
              <Link
                href={`/title/${mediaType}/${linkId}`}
                className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-xs font-bold text-white backdrop-blur-md transition hover:bg-white/15"
              >
                Ver detalhes
              </Link>

              <FeaturedCardActions
                tmdbId={item.id}
                poplogId={item.poplogId ?? null}
                imdbId={item.externalIds?.imdbId ?? null}
                slug={item.externalIds?.slug ?? null}
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
