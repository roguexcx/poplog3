// src/features/title/TitleSynopsisTrailer.tsx
"use client";

type Props = {
  overview: string | null;
  trailerKey: string | null;
  trailerName: string | null;
};

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 16, height: 16 }} fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

const SECTION_LABEL = {
  fontSize: 11,
  fontWeight: 500,
  textTransform: "uppercase",
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

export default function TitleSynopsisTrailer({ overview, trailerKey, trailerName }: Props) {
  const hasTrailer = !!trailerKey;
  const hasSynopsis = !!overview;

  if (!hasSynopsis && !hasTrailer) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: hasSynopsis && hasTrailer ? "1fr 1fr" : "1fr",
        gap: 24,
      }}
      className="max-sm:grid-cols-1"
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

      {/* Trailer */}
      {hasTrailer && (
        <div>
          <p style={SECTION_LABEL}>Trailer</p>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("poplog:open-trailer"))}
            style={{
              ...CARD,
              display: "flex",
              alignItems: "center",
              gap: 14,
              width: "100%",
              cursor: "pointer",
              minHeight: 90,
              textAlign: "left",
              transition: "border-color 0.2s",
            }}
          >
            {/* Play circle */}
            <div
              style={{
                flexShrink: 0,
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgba(255,255,255,0.75)",
              }}
            >
              <IconPlay />
            </div>

            {/* Text */}
            <div>
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.75)",
                  margin: 0,
                }}
              >
                {trailerName ?? "Assista ao trailer oficial"}
              </p>
              <p
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.35)",
                  margin: "3px 0 0",
                }}
              >
                Abre em modal
              </p>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
