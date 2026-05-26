"use client";

import LocalizedTitle from "@/components/titles/LocalizedTitle";

export type WatchlistPickItem = {
  content_id: string;
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  original_title?: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number | null;
  release_year: number | null;
  number_of_episodes: number | null;
  number_of_seasons: number | null;
  runtime: number | null;
  runtime_label: string | null;
  total_runtime_label?: string | null;
  best_provider_name: string | null;
  best_provider_type: string | null;
  best_provider_logo: string | null;
  days_on_watchlist: number;
  overview?: string | null;
  genres?: string[];
  series_status?: string | null;
  editorial_reason?: string | null;
  contextual_badges?: string[];
  award_badges?: string[];
};

type Props = {
  item: WatchlistPickItem;
  onClick: () => void;
};

function ProviderBadge({
  name,
  logoPath,
  type,
}: {
  name: string | null;
  logoPath: string | null;
  type: string | null;
}) {
  if (!name) return null;

  const isSubscription = type === "subscription" || type === "free" || type === "ads";

  return (
    <div className="flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 backdrop-blur-sm">
      {logoPath ? (
        <img
          src={`https://image.tmdb.org/t/p/original${logoPath}`}
          alt={name}
          className="h-3 w-3 rounded-sm object-contain"
        />
      ) : null}
      <span
        className={[
          "text-[9px] font-bold leading-none",
          isSubscription ? "text-teal-300/90" : "text-white/60",
        ].join(" ")}
      >
        {name}
      </span>
    </div>
  );
}

export default function WatchlistPickCard({ item, onClick }: Props) {
  const posterUrl = item.poster_path
    ? `https://image.tmdb.org/t/p/w342${item.poster_path}`
    : item.backdrop_path
      ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}`
      : null;

  const isMovie = item.media_type === "movie";

  // Subtítulo: episódios/temporadas para série, ano para filme
  const subtitle = (() => {
    if (!isMovie) {
      if (item.number_of_episodes) {
        const seasons =
          item.number_of_seasons && item.number_of_seasons > 1
            ? ` · ${item.number_of_seasons} temp`
            : "";
        return `${item.number_of_episodes} ep${seasons}`;
      }
      return item.release_year ? String(item.release_year) : "Série";
    }
    return item.release_year ? String(item.release_year) : "Filme";
  })();

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full text-left"
    >
      {/* Poster */}
      <div className="relative mb-2.5 aspect-[2/3] overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.03] transition-shadow duration-300 group-hover:shadow-[0_14px_40px_rgba(0,0,0,0.45)]">
        {posterUrl ? (
          <img
            src={posterUrl}
            alt={item.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-[10px] text-white/20">{item.title[0]}</span>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

        {/* Top row: media type + rating */}
        <div className="absolute left-2 right-2 top-2 flex items-start justify-between gap-1">
          <span
            className={[
              "rounded-md border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide",
              isMovie
                ? "border-cyan-500/25 bg-cyan-950/80 text-cyan-300/75"
                : "border-indigo-500/25 bg-indigo-950/80 text-indigo-300/75",
            ].join(" ")}
          >
            {isMovie ? "Filme" : "Série"}
          </span>

          {item.vote_average != null && item.vote_average > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] font-bold text-amber-300">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              {item.vote_average.toFixed(1)}
            </span>
          )}
        </div>

        {/* Bottom: provider badge */}
        {item.best_provider_name && (
          <div className="absolute bottom-2 left-2 right-2">
            <ProviderBadge
              name={item.best_provider_name}
              logoPath={item.best_provider_logo}
              type={item.best_provider_type}
            />
          </div>
        )}
      </div>

      {/* Title + subtitle */}
      <div className="px-0.5">
        <LocalizedTitle
          as="div"
          title={item.title}
          originalTitle={item.original_title}
          variant="poster"
          className="mb-0.5 line-clamp-2 min-h-[2.15rem] text-[12px] font-semibold leading-tight text-white/85 transition-colors group-hover:text-white"
        />
        <p className="line-clamp-2 min-h-[2rem] text-[11px] leading-4 text-white/35">
          {item.runtime_label ? `${subtitle} · ${item.runtime_label}` : subtitle}
        </p>
      </div>
    </button>
  );
}
