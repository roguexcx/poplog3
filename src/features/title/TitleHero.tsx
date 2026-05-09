// src/features/title/TitleHero.tsx
"use client";

import { useWatchlistToggle } from "@/hooks/useWatchlistToggle";
import { useWatchedToggle } from "@/hooks/useWatchedToggle";
import type { TMDBTitleDetail } from "@/features/title/title-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDetailTitle(d: TMDBTitleDetail): string {
  return d.title ?? d.name ?? "Título desconhecido";
}

function getReleaseYear(d: TMDBTitleDetail): string | null {
  const date = d.release_date ?? d.first_air_date;
  return date ? date.slice(0, 4) : null;
}

function daysSinceRelease(d: TMDBTitleDetail): number | null {
  const date = d.release_date ?? d.first_air_date;
  if (!date) return null;
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  return diff >= 0 ? diff : null;
}

function getCertification(d: TMDBTitleDetail, mediaType: "movie" | "tv"): string | null {
  if (mediaType === "movie") {
    const br = d.release_dates?.results.find((r) => r.iso_3166_1 === "BR");
    return br?.release_dates?.find((rd) => rd.certification)?.certification ?? null;
  }
  return d.content_ratings?.results.find((r) => r.iso_3166_1 === "BR")?.rating ?? null;
}

function formatRuntime(min: number | undefined): string | null {
  if (!min) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ""}` : `${m}min`;
}

const STATUS_LABELS: Record<string, string> = {
  "Ended": "Encerrada",
  "Returning Series": "Em andamento",
  "Canceled": "Cancelada",
  "In Production": "Em produção",
  "Planned": "Planejada",
};

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 14, height: 14 }} fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function IconBookmark({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: 13, height: 13 }}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: 13, height: 13 }}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function IconStar() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 13, height: 13 }} fill="#f5c518">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  detail: TMDBTitleDetail;
  mediaType: "movie" | "tv";
  hasTrailer: boolean;
};

export default function TitleHero({ detail, mediaType, hasTrailer }: Props) {
  const title = getDetailTitle(detail);
  const year = getReleaseYear(detail);
  const days = daysSinceRelease(detail);
  const certification = getCertification(detail, mediaType);
  const releaseYear = year ? Number(year) : null;

  const watchlist = useWatchlistToggle({ tmdbId: detail.id, mediaType, title, releaseYear });
  const watched = useWatchedToggle({ tmdbId: detail.id, mediaType, title, releaseYear });

  const backdropUrl = detail.backdrop_path
    ? `https://image.tmdb.org/t/p/w1280${detail.backdrop_path}`
    : null;
  const posterUrl = detail.poster_path
    ? `https://image.tmdb.org/t/p/w342${detail.poster_path}`
    : null;

  const runtime =
    mediaType === "movie"
      ? formatRuntime(detail.runtime)
      : detail.episode_run_time?.[0]
      ? formatRuntime(detail.episode_run_time[0])
      : null;

  const rating =
    typeof detail.vote_average === "number" ? detail.vote_average.toFixed(1) : null;
  const voteCount = detail.vote_count ?? 0;
  const genres = detail.genres?.slice(0, 4) ?? [];
  const seasons = detail.number_of_seasons;
  const statusLabel = detail.status ? (STATUS_LABELS[detail.status] ?? detail.status) : null;

  // Contextual badges
  const userBadge = watched.isWatched
    ? { label: "✓ Assistido", bg: "rgba(90,160,90,0.15)", color: "#6abf6a", border: "rgba(90,160,90,0.3)" }
    : watchlist.inWatchlist
    ? { label: "🔖 Na lista", bg: "rgba(80,130,210,0.15)", color: "#6a9fdf", border: "rgba(80,130,210,0.3)" }
    : null;

  const releaseBadge =
    days !== null && days >= 0 && days <= 30
      ? {
          label: days === 0 ? "Lançado hoje" : `Lançado há ${days} ${days === 1 ? "dia" : "dias"}`,
          bg: "rgba(220,150,50,0.12)",
          color: "#e09050",
          border: "rgba(220,150,50,0.25)",
        }
      : days !== null && days > 30 && days <= 90
      ? {
          label: `Lançado há ${Math.round(days / 30)} meses`,
          bg: "rgba(150,150,150,0.08)",
          color: "rgba(255,255,255,0.4)",
          border: "rgba(255,255,255,0.1)",
        }
      : null;

  // Primary button logic
  let primaryLabel: string;
  let primaryBg: string;
  let primaryColor: string;
  let primaryBorder: string;
  let primaryAction: () => void;

  const isPrimaryLoading = watchlist.loading || watched.loading;
  const isPrimarySaving = watchlist.saving || watched.saving;

  if (watched.isWatched) {
    primaryLabel = isPrimarySaving ? "..." : "✓ Assistido";
    primaryBg = "rgba(90,160,90,0.2)";
    primaryColor = "#6abf6a";
    primaryBorder = "rgba(90,160,90,0.4)";
    primaryAction = watched.toggle;
  } else if (watchlist.inWatchlist) {
    primaryLabel = isPrimarySaving ? "..." : "▶ Na lista";
    primaryBg = "rgba(80,130,210,0.2)";
    primaryColor = "#6a9fdf";
    primaryBorder = "rgba(80,130,210,0.35)";
    primaryAction = watchlist.toggle;
  } else {
    primaryLabel = isPrimarySaving ? "..." : "Quero ver";
    primaryBg = "rgba(120,100,220,0.85)";
    primaryColor = "#fff";
    primaryBorder = "transparent";
    primaryAction = watchlist.toggle;
  }

  const btnBase = {
    borderRadius: "8px",
    padding: "8px 18px",
    fontSize: "12px",
    fontWeight: 500,
    cursor: "pointer",
    transition: "opacity 0.15s",
    display: "flex",
    alignItems: "center",
    gap: "5px",
    border: "0.5px solid",
    whiteSpace: "nowrap",
  };

  const btnSecondary = {
    ...btnBase,
    background: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.75)",
    borderColor: "rgba(255,255,255,0.15)",
  };

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ minHeight: 420 }}
    >
      {/* Backdrop */}
      {backdropUrl ? (
        <div className="absolute inset-0">
          <img src={backdropUrl} alt="" className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="absolute inset-0" style={{ background: "#0a0a16" }} />
      )}

      {/* Overlay 1: global darkening */}
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.55)" }} />

      {/* Overlay 2: horizontal gradient */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to right, rgba(8,10,18,0.98) 30%, rgba(8,10,18,0.5) 70%, rgba(8,10,18,0.15) 100%)",
        }}
      />

      {/* Overlay 3: vertical fade to page background */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(8,10,18,1) 0%, rgba(8,10,18,0.45) 30%, transparent 65%)",
        }}
      />

      {/* Floating play button */}
      {hasTrailer && (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("poplog:open-trailer"))}
          style={{
            position: "absolute",
            top: 20,
            right: 20,
            zIndex: 10,
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.12)",
            border: "0.5px solid rgba(255,255,255,0.2)",
            color: "rgba(255,255,255,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "background 0.2s",
          }}
          title="Assistir trailer"
        >
          <IconPlay />
        </button>
      )}

      {/* Main content — bottom-aligned */}
      <div
        className="relative z-10 flex items-end"
        style={{ minHeight: 420, padding: "32px" }}
      >
        <div
          className="flex w-full gap-6"
          style={{ maxWidth: 920, alignItems: "flex-end" }}
        >
          {/* Poster */}
          {posterUrl && (
            <div
              className="flex-shrink-0 hidden sm:block"
              style={{
                width: 110,
                aspectRatio: "2/3",
                borderRadius: 10,
                overflow: "hidden",
                boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                border: "1px solid rgba(255,255,255,0.1)",
                background: "#0e0e1a",
              }}
            >
              <img src={posterUrl} alt={title} className="h-full w-full object-cover" />
            </div>
          )}

          {/* Info block */}
          <div className="flex min-w-0 flex-col gap-2.5 pb-1">
            {/* Contextual badges */}
            {(userBadge || releaseBadge) && (
              <div className="flex flex-wrap items-center gap-2">
                {userBadge && (
                  <span
                    style={{
                      background: userBadge.bg,
                      color: userBadge.color,
                      border: `0.5px solid ${userBadge.border}`,
                      borderRadius: 20,
                      fontSize: 11,
                      padding: "3px 10px",
                    }}
                  >
                    {userBadge.label}
                  </span>
                )}
                {releaseBadge && (
                  <span
                    style={{
                      background: releaseBadge.bg,
                      color: releaseBadge.color,
                      border: `0.5px solid ${releaseBadge.border}`,
                      borderRadius: 20,
                      fontSize: 11,
                      padding: "3px 10px",
                    }}
                  >
                    {releaseBadge.label}
                  </span>
                )}
              </div>
            )}

            {/* Metadata */}
            <div
              className="flex flex-wrap items-center gap-x-1.5 gap-y-1"
              style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}
            >
              {year && <span>{year}</span>}
              <span>·</span>
              <span>{mediaType === "movie" ? "Filme" : "Série"}</span>
              {mediaType === "tv" && seasons != null && (
                <>
                  <span>·</span>
                  <span>{seasons} {seasons === 1 ? "temporada" : "temporadas"}</span>
                </>
              )}
              {runtime && (
                <>
                  <span>·</span>
                  <span>{mediaType === "tv" ? `~${runtime}/ep` : runtime}</span>
                </>
              )}
              {certification && (
                <>
                  <span>·</span>
                  <span>{certification}</span>
                </>
              )}
              {statusLabel && (
                <>
                  <span>·</span>
                  <span>{statusLabel}</span>
                </>
              )}
            </div>

            {/* Title */}
            <h1
              style={{
                fontSize: 32,
                fontWeight: 600,
                color: "#fff",
                lineHeight: 1.1,
                margin: 0,
              }}
            >
              {title}
            </h1>

            {/* Genre pills */}
            {genres.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {genres.map((g) => (
                  <span
                    key={g.id}
                    style={{
                      fontSize: 11,
                      padding: "3px 10px",
                      borderRadius: 20,
                      border: "0.5px solid rgba(255,255,255,0.15)",
                      background: "rgba(255,255,255,0.06)",
                      color: "rgba(255,255,255,0.6)",
                    }}
                  >
                    {g.name}
                  </span>
                ))}
              </div>
            )}

            {/* Rating */}
            {rating && (
              <div className="flex items-center gap-1.5">
                <IconStar />
                <span style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>{rating}</span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                  / 10 · {voteCount.toLocaleString("pt-BR")} votos
                </span>
              </div>
            )}

            {/* Action buttons */}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {/* Primary */}
              <button
                type="button"
                onClick={primaryAction}
                disabled={isPrimaryLoading || isPrimarySaving}
                style={{
                  ...btnBase,
                  background: primaryBg,
                  color: primaryColor,
                  borderColor: primaryBorder,
                  opacity: isPrimaryLoading ? 0.5 : 1,
                }}
              >
                {primaryLabel}
              </button>

              {/* Secondary: mark as watched (only when not yet watched) */}
              {!watched.isWatched && (
                <button
                  type="button"
                  onClick={watched.toggle}
                  disabled={watched.loading || !watched.isLoggedIn}
                  style={{
                    ...btnSecondary,
                    opacity: watched.loading ? 0.5 : 1,
                  }}
                >
                  <IconCheck />
                  {watched.saving ? "..." : "Já vi"}
                </button>
              )}

              {/* Icon button: watchlist */}
              <button
                type="button"
                onClick={watchlist.toggle}
                disabled={watchlist.loading || !watchlist.isLoggedIn}
                style={{
                  ...btnBase,
                  background: watchlist.inWatchlist
                    ? "rgba(80,130,210,0.15)"
                    : "rgba(255,255,255,0.08)",
                  color: watchlist.inWatchlist ? "#6a9fdf" : "rgba(255,255,255,0.75)",
                  borderColor: watchlist.inWatchlist
                    ? "rgba(80,130,210,0.35)"
                    : "rgba(255,255,255,0.15)",
                  opacity: watchlist.loading ? 0.5 : 1,
                  padding: "8px 14px",
                }}
              >
                <IconBookmark filled={watchlist.inWatchlist} />
                Lista
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
