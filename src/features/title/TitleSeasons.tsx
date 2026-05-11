// src/features/title/TitleSeasons.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import { buildTmdbUrl } from "@/lib/images/url";
import type { TMDBSeason } from "@/features/title/title-types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Episode = {
  episode_number: number;
  name: string;
  air_date: string | null;
  available: boolean;
};

type Props = {
  tmdbId: number;
  seasons: TMDBSeason[];
  totalEpisodes: number;
};

// ─── Local storage for episode tracking ───────────────────────────────────────

function storageKey(tmdbId: number) {
  return `poplog_ep_${tmdbId}`;
}

function loadWatched(tmdbId: number): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(tmdbId));
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveWatched(tmdbId: number, watched: Set<string>) {
  try {
    localStorage.setItem(storageKey(tmdbId), JSON.stringify([...watched]));
  } catch {
    // ignore storage errors
  }
}

function epKey(season: number, ep: number) {
  return `S${season}E${ep}`;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{
        width: 14,
        height: 14,
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 0.2s",
        flexShrink: 0,
      }}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function IconCheckCircle() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx={12} cy={12} r={10} />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 16, height: 16 }} fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function IconStar() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 16, height: 16 }} fill="currentColor">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

// ─── Status card ──────────────────────────────────────────────────────────────

type StatusInfo = {
  icon: ReactNode;
  headline: string;
  sub: string;
  bg: string;
  border: string;
  color: string;
};

function computeStatus(
  watched: Set<string>,
  seasons: TMDBSeason[],
  episodes: Record<number, Episode[]>,
): StatusInfo | null {
  const totalWatched = watched.size;
  if (totalWatched === 0) return null;

  // Count available episodes across all fetched seasons
  let totalAvailable = 0;
  for (const [sn, eps] of Object.entries(episodes)) {
    const season = seasons.find((s) => s.season_number === Number(sn));
    if (!season) continue;
    totalAvailable += eps.filter((e) => e.available).length;
  }

  // If we haven't loaded all seasons yet, use episode_count sum as fallback
  if (totalAvailable === 0) {
    totalAvailable = seasons.reduce((acc, s) => acc + s.episode_count, 0);
  }

  if (totalWatched >= totalAvailable) {
    return {
      icon: <IconCheckCircle />,
      headline: "Você está em dia",
      sub: `Todos os ${totalAvailable} episódios vistos`,
      bg: "rgba(100,180,100,0.08)",
      border: "rgba(100,180,100,0.2)",
      color: "rgba(100,180,100,0.85)",
    };
  }

  const remaining = totalAvailable - totalWatched;
  return {
    icon: <IconPlay />,
    headline: "Faltam episódios",
    sub: `${remaining} ${remaining === 1 ? "episódio" : "episódios"} para ver`,
    bg: "rgba(120,100,220,0.08)",
    border: "rgba(120,100,220,0.2)",
    color: "rgba(160,140,240,0.9)",
  };
}

// ─── Season accordion row ─────────────────────────────────────────────────────

function SeasonRow({
  season,
  tmdbId,
  watched,
  onToggleEp,
  onMarkAll,
}: {
  season: TMDBSeason;
  tmdbId: number;
  watched: Set<string>;
  onToggleEp: (season: number, ep: number) => void;
  onMarkAll: (season: number, episodes: Episode[], available: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchEpisodes = useCallback(async () => {
    if (episodes.length > 0 || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/episodes?tvId=${tmdbId}&season=${season.season_number}`);
      const data = await res.json();
      setEpisodes(data.episodes ?? []);
    } catch {
      setEpisodes([]);
    } finally {
      setLoading(false);
    }
  }, [tmdbId, season.season_number, episodes.length, loading]);

  const handleOpen = () => {
    setOpen((prev) => {
      if (!prev) fetchEpisodes();
      return !prev;
    });
  };

  const watchedInSeason = episodes.filter((e) =>
    watched.has(epKey(season.season_number, e.episode_number)),
  ).length;
  const availableInSeason = episodes.filter((e) => e.available).length;

  // Find "next" episode: first available unwatched
  const nextEpNumber = episodes.find(
    (e) => e.available && !watched.has(epKey(season.season_number, e.episode_number)),
  )?.episode_number;

  const progressPct =
    availableInSeason > 0 ? (watchedInSeason / availableInSeason) * 100 : 0;

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "0.5px solid rgba(255,255,255,0.07)",
        borderRadius: 8,
      }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={handleOpen}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          cursor: "pointer",
          background: "transparent",
          border: "none",
          textAlign: "left",
        }}
      >
        {/* Thumbnail — w92 (poster:thumb) é suficiente para uma miniatura de 40px. */}
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 6,
            background: season.poster_path
              ? `url(${buildTmdbUrl("poster", "thumb", season.poster_path)}) center/cover`
              : "rgba(255,255,255,0.06)",
            flexShrink: 0,
          }}
        />

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "rgba(255,255,255,0.8)",
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {season.name}
          </p>
          <p
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.35)",
              margin: "2px 0 6px",
            }}
          >
            {season.episode_count} episódios
            {season.air_date && ` · ${season.air_date.slice(0, 4)}`}
            {episodes.length > 0 && ` · ${watchedInSeason}/${availableInSeason} vistos`}
          </p>
          {/* Progress bar */}
          <div
            style={{
              height: 3,
              borderRadius: 2,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progressPct}%`,
                background: "rgba(120,100,220,0.7)",
                borderRadius: 2,
                transition: "width 0.3s",
              }}
            />
          </div>
        </div>

        <IconChevron open={open} />
      </button>

      {/* Expanded: episode grid */}
      {open && (
        <div style={{ padding: "0 14px 14px" }}>
          {loading && (
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "8px 0" }}>
              Carregando episódios...
            </p>
          )}

          {!loading && episodes.length > 0 && (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(8, 1fr)",
                  gap: 5,
                  marginBottom: 10,
                }}
                className="max-sm:[grid-template-columns:repeat(6,1fr)]"
              >
                {episodes.map((ep) => {
                  const key = epKey(season.season_number, ep.episode_number);
                  const isWatched = watched.has(key);
                  const isNext = ep.episode_number === nextEpNumber;

                  let bg: string;
                  let color: string;
                  let border = "none";

                  if (!ep.available) {
                    bg = "rgba(255,255,255,0.03)";
                    color = "rgba(255,255,255,0.12)";
                  } else if (isWatched) {
                    bg = "rgba(100,180,100,0.25)";
                    color = "rgba(100,180,100,0.85)";
                  } else if (isNext) {
                    bg = "rgba(120,100,220,0.3)";
                    color = "rgba(160,140,240,0.95)";
                    border = "0.5px solid rgba(120,100,220,0.5)";
                  } else {
                    bg = "rgba(255,255,255,0.05)";
                    color = "rgba(255,255,255,0.2)";
                  }

                  return (
                    <button
                      key={ep.episode_number}
                      type="button"
                      title={ep.name}
                      onClick={() => ep.available && onToggleEp(season.season_number, ep.episode_number)}
                      style={{
                        aspectRatio: "1",
                        borderRadius: 4,
                        background: bg,
                        color,
                        border,
                        fontSize: 9,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: ep.available ? "pointer" : "default",
                        transition: "background 0.15s",
                      }}
                    >
                      {ep.episode_number}
                    </button>
                  );
                })}
              </div>

              {/* Bulk action buttons */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => onMarkAll(season.season_number, episodes, true)}
                  style={{
                    fontSize: 11,
                    padding: "5px 12px",
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.06)",
                    border: "0.5px solid rgba(255,255,255,0.12)",
                    color: "rgba(255,255,255,0.55)",
                    cursor: "pointer",
                  }}
                >
                  Vi tudo da temporada
                </button>
                <button
                  type="button"
                  onClick={() => onMarkAll(season.season_number, episodes, false)}
                  style={{
                    fontSize: 11,
                    padding: "5px 12px",
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.06)",
                    border: "0.5px solid rgba(255,255,255,0.12)",
                    color: "rgba(255,255,255,0.55)",
                    cursor: "pointer",
                  }}
                >
                  Desmarcar tudo
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const SECTION_LABEL = {
  fontSize: 11,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "rgba(255,255,255,0.35)",
  marginBottom: 10,
};

export default function TitleSeasons({ tmdbId, seasons }: Props) {
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [allEpisodes, setAllEpisodes] = useState<Record<number, Episode[]>>({});

  useEffect(() => {
    setWatched(loadWatched(tmdbId));
  }, [tmdbId]);

  const toggleEp = useCallback(
    (season: number, ep: number) => {
      setWatched((prev) => {
        const next = new Set(prev);
        const key = epKey(season, ep);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        saveWatched(tmdbId, next);
        return next;
      });
    },
    [tmdbId],
  );

  const markAll = useCallback(
    (season: number, episodes: Episode[], markAsWatched: boolean) => {
      setWatched((prev) => {
        const next = new Set(prev);
        const available = episodes.filter((e) => e.available);
        if (markAsWatched) {
          available.forEach((e) => next.add(epKey(season, e.episode_number)));
        } else {
          available.forEach((e) => next.delete(epKey(season, e.episode_number)));
        }
        saveWatched(tmdbId, next);
        return next;
      });

      setAllEpisodes((prev) => ({ ...prev, [season]: episodes }));
    },
    [tmdbId],
  );

  const statusInfo = computeStatus(watched, seasons, allEpisodes);

  return (
    <div>
      <p style={SECTION_LABEL}>Temporadas e episódios</p>

      {/* Status card */}
      {statusInfo && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 12,
            background: statusInfo.bg,
            border: `0.5px solid ${statusInfo.border}`,
            color: statusInfo.color,
          }}
        >
          {statusInfo.icon}
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{statusInfo.headline}</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: "2px 0 0" }}>
              {statusInfo.sub}
            </p>
          </div>
        </div>
      )}

      {/* Season accordions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {seasons.map((season) => (
          <SeasonRow
            key={season.id}
            season={season}
            tmdbId={tmdbId}
            watched={watched}
            onToggleEp={toggleEp}
            onMarkAll={markAll}
          />
        ))}
      </div>
    </div>
  );
}
