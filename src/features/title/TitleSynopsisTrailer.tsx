// src/features/title/TitleSynopsisTrailer.tsx

type Props = {
  overview: string | null;
  trailerKey: string | null;
  trailerName: string | null;
};

const SECTION_LABEL = {
  fontSize: 11,
  fontWeight: 500,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  color: "rgba(255,255,255,0.35)",
  marginBottom: 8,
};

const CARD = {
  background: "rgba(255,255,255,0.02)",
  border: "0.5px solid rgba(255,255,255,0.06)",
  borderRadius: 10,
  padding: 14,
};

export default function TitleSynopsisTrailer({ overview, trailerKey }: Props) {
  const hasTrailer = !!trailerKey;
  const hasSynopsis = !!overview;

  if (!hasSynopsis && !hasTrailer) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: hasSynopsis && hasTrailer ? "1fr 1fr" : "1fr",
        gap: 24,
        alignItems: "start",
      }}
      className="max-sm:!grid-cols-1"
    >
      {/* Synopsis */}
      {hasSynopsis && (
        <div>
          <p style={SECTION_LABEL}>Sinopse</p>
          <div style={CARD}>
            <p
              style={{
                fontSize: 14,
                color: "rgba(255,255,255,0.6)",
                lineHeight: 1.7,
                margin: 0,
              }}
            >
              {overview}
            </p>
          </div>
        </div>
      )}

      {/* Trailer — iframe direto, sem botão */}
      {hasTrailer && (
        <div>
          <p style={SECTION_LABEL}>Trailer</p>
          <div
            style={{
              borderRadius: 10,
              overflow: "hidden",
              border: "0.5px solid rgba(255,255,255,0.08)",
              aspectRatio: "16/9",
            }}
          >
            <iframe
              src={`https://www.youtube.com/embed/${trailerKey}?rel=0&modestbranding=1`}
              allowFullScreen
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              style={{ width: "100%", height: "100%", border: "none", display: "block" }}
              title="Trailer"
              loading="lazy"
            />
          </div>
        </div>
      )}
    </div>
  );
}
