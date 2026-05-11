// src/features/title/TitleCast.tsx

import { buildTmdbUrl } from "@/lib/images/url";
import type { TMDBCastMember, TMDBCrewMember, TMDBTitleDetail } from "@/features/title/title-types";

type Props = {
  cast: TMDBCastMember[];
  director: TMDBCrewMember | null;
  createdBy: { id: number; name: string; profile_path: string | null } | null;
  detail: TMDBTitleDetail;
  mediaType: "movie" | "tv";
};

const LANG_LABELS: Record<string, string> = {
  en: "Inglês",
  pt: "Português",
  es: "Espanhol",
  fr: "Francês",
  de: "Alemão",
  ja: "Japonês",
  ko: "Coreano",
  zh: "Chinês",
  it: "Italiano",
  ru: "Russo",
  ar: "Árabe",
  hi: "Hindi",
  tr: "Turco",
  sv: "Sueco",
  da: "Dinamarquês",
  nl: "Holandês",
  pl: "Polonês",
};

function formatRuntime(min: number | undefined): string | null {
  if (!min) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ""}` : `${m}min`;
}

const SECTION_LABEL = {
  fontSize: 11,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "rgba(255,255,255,0.35)",
  marginBottom: 10,
};

const ROW_LABEL = {
  fontSize: 11,
  color: "rgba(255,255,255,0.3)",
  minWidth: 110,
};

const ROW_VALUE = {
  fontSize: 11,
  color: "rgba(255,255,255,0.65)",
  fontWeight: 500,
  flex: 1,
};

export default function TitleCast({ cast, director, createdBy, detail, mediaType }: Props) {
  const hasCast = cast.length > 0;

  const runtime =
    mediaType === "movie"
      ? formatRuntime(detail.runtime)
      : detail.episode_run_time?.[0]
      ? formatRuntime(detail.episode_run_time[0])
      : null;

  const releaseDate =
    mediaType === "movie"
      ? detail.release_date ?? null
      : detail.first_air_date ?? null;

  const country = detail.production_countries?.[0]?.name ?? null;
  const language = detail.original_language
    ? (LANG_LABELS[detail.original_language] ?? detail.original_language.toUpperCase())
    : null;
  const companies = detail.production_companies
    ?.slice(0, 3)
    .map((c) => c.name)
    .join(", ") ?? null;

  const STATUS_LABELS: Record<string, string> = {
    "Ended": "Encerrada",
    "Returning Series": "Em andamento",
    "Canceled": "Cancelada",
    "In Production": "Em produção",
    "Released": "Lançado",
  };
  const statusLabel = detail.status
    ? (STATUS_LABELS[detail.status] ?? detail.status)
    : null;

  const rows: Array<{ label: string; value: string | null }> = [
    {
      label: mediaType === "movie" ? "Direção" : "Criação",
      value:
        mediaType === "movie"
          ? director?.name ?? null
          : createdBy?.name ?? null,
    },
    { label: "País", value: country },
    { label: "Idioma original", value: language },
    { label: "Produtoras", value: companies },
    {
      label: "Lançamento",
      value: releaseDate
        ? new Date(releaseDate).toLocaleDateString("pt-BR", { year: "numeric", month: "long", day: "numeric" })
        : null,
    },
    {
      label: mediaType === "movie" ? "Duração" : "Duração/ep",
      value: runtime,
    },
    {
      label: "Temporadas",
      value: mediaType === "tv" && detail.number_of_seasons != null
        ? String(detail.number_of_seasons)
        : null,
    },
    {
      label: "Episódios",
      value: mediaType === "tv" && detail.number_of_episodes != null
        ? String(detail.number_of_episodes)
        : null,
    },
    { label: "Status", value: statusLabel },
  ].filter((r) => r.value !== null && r.value !== "");

  if (!hasCast && rows.length === 0) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: hasCast ? "1fr 1fr" : "1fr",
        gap: 24,
        alignItems: "start",
      }}
      className="max-sm:grid-cols-1"
    >
      {/* Cast */}
      {hasCast && (
        <div>
          <p style={SECTION_LABEL}>Elenco principal</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {cast.map((member) => {
              const avatarUrl = buildTmdbUrl("profile", "medium", member.profile_path);
              return (
                <div
                  key={member.id}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 48 }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: "50%",
                      background: avatarUrl
                        ? `url(${avatarUrl}) center/cover`
                        : "rgba(255,255,255,0.07)",
                      border: "0.5px solid rgba(255,255,255,0.1)",
                      flexShrink: 0,
                    }}
                  />
                  <p
                    style={{
                      fontSize: 10,
                      color: "rgba(255,255,255,0.55)",
                      textAlign: "center",
                      margin: 0,
                      lineHeight: 1.3,
                      wordBreak: "break-word",
                    }}
                  >
                    {member.name}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Technical details */}
      {rows.length > 0 && (
        <div>
          <p style={SECTION_LABEL}>Detalhes</p>
          <div
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "0.5px solid rgba(255,255,255,0.06)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            {rows.map((row, i) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "9px 14px",
                  borderBottom:
                    i < rows.length - 1
                      ? "0.5px solid rgba(255,255,255,0.05)"
                      : "none",
                }}
              >
                <span style={ROW_LABEL}>{row.label}</span>
                <span style={ROW_VALUE}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
