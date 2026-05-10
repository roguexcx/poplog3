// src/features/title/TitleHero.tsx
"use client";

import { useWatchlistToggle } from "@/hooks/useWatchlistToggle";
import { useWatchedToggle } from "@/hooks/useWatchedToggle";
import { IconBookmark, IconCheck, IconStar } from "@/components/ui/icons";
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

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  detail: TMDBTitleDetail;
  mediaType: "movie" | "tv";
};

export default function TitleHero({ detail, mediaType }: Props) {
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

  // Badge: só mostra se lançado hoje ou ontem (genuinamente novo)
  const releaseBadge =
    days !== null && days >= 0 && days <= 1
      ? {
          label: days === 0 ? "Lançado hoje" : "Lançado ontem",
          bg: "rgba(220,150,50,0.12)",
          color: "#e09050",
          border: "rgba(220,150,50,0.25)",
        }
      : null;

  // Badge de status do usuário
  const userBadge = watched.isWatched
    ? { label: "✓ Assistido", bg: "rgba(90,160,90,0.15)", color: "#6abf6a", border: "rgba(90,160,90,0.3)" }
    : null;

  const isLoading = watchlist.loading || watched.loading;
  const isSaving = watchlist.saving || watched.saving;

  const btnBase = {
    borderRadius: "8px",
    padding: "8px 18px",
    fontSize: "12px",
    fontWeight: 500 as const,
    cursor: "pointer",
    transition: "opacity 0.15s",
    display: "flex",
    alignItems: "center",
    gap: "5px",
    border: "0.5px solid",
    whiteSpace: "nowrap" as const,
    lineHeight: 1,
  };

  return (
    <div className="relative w-full overflow-hidden" style={{ minHeight: 420 }}>
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

      {/* Main content — bottom-aligned, same max-width as page sections */}
      <div className="relative z-10 flex items-end" style={{ minHeight: 420 }}>
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            width: "100%",
            padding: "0 24px 32px",
            display: "flex",
            gap: 24,
            alignItems: "flex-end",
          }}
        >
          {/* Poster */}
          {posterUrl && (
            <div
              className="hidden sm:block flex-shrink-0"
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
            {/* Badges — só aparecem se tiverem conteúdo relevante */}
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
            <h1 style={{ fontSize: 32, fontWeight: 600, color: "#fff", lineHeight: 1.1, margin: 0 }}>
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
              {watched.isWatched ? (
                /* Já assistiu — destaque no "Assistido", clicar remove */
                <button
                  type="button"
                  onClick={watched.toggle}
                  disabled={isLoading || isSaving}
                  style={{
                    ...btnBase,
                    background: "rgba(90,160,90,0.2)",
                    color: "#6abf6a",
                    borderColor: "rgba(90,160,90,0.4)",
                    opacity: isLoading ? 0.5 : 1,
                  }}
                >
                  <IconCheck />
                  {isSaving ? "..." : "Assistido"}
                </button>
              ) : (
                /* Não assistiu — "Quero ver" como primário, "Assistido" como secundário */
                <>
                  <button
                    type="button"
                    onClick={watchlist.toggle}
                    disabled={isLoading || isSaving || !watchlist.isLoggedIn}
                    style={{
                      ...btnBase,
                      background: watchlist.inWatchlist
                        ? "rgba(80,130,210,0.2)"
                        : "rgba(120,100,220,0.85)",
                      color: watchlist.inWatchlist ? "#6a9fdf" : "#fff",
                      borderColor: watchlist.inWatchlist
                        ? "rgba(80,130,210,0.35)"
                        : "transparent",
                      opacity: isLoading ? 0.5 : 1,
                    }}
                  >
                    <IconBookmark filled={watchlist.inWatchlist} />
                    {isSaving ? "..." : watchlist.inWatchlist ? "Na lista" : "Quero ver"}
                  </button>

                  <button
                    type="button"
                    onClick={watched.toggle}
                    disabled={watched.loading || !watched.isLoggedIn}
                    style={{
                      ...btnBase,
                      background: "rgba(255,255,255,0.08)",
                      color: "rgba(255,255,255,0.75)",
                      borderColor: "rgba(255,255,255,0.15)",
                      opacity: watched.loading ? 0.5 : 1,
                    }}
                  >
                    <IconCheck />
                    {watched.saving ? "..." : "Assistido"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
