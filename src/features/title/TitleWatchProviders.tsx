// src/features/title/TitleWatchProviders.tsx

type Provider = {
  provider_id: number;
  provider_name: string;
  logo_path: string;
  kind: "stream" | "rent";
};

type Props = {
  providers: Provider[];
};

const PROVIDER_COLORS: Record<string, string> = {
  "Netflix": "#e50914",
  "Amazon Prime Video": "#00a8e0",
  "Prime Video": "#00a8e0",
  "Disney+": "#113ccf",
  "Max": "#002be0",
  "HBO Max": "#5822c2",
  "Globoplay": "#f5821f",
  "Apple TV+": "#888",
  "Paramount+": "#0064ff",
  "Star+": "#3d3d8d",
  "Crunchyroll": "#f47521",
  "Telecine Play": "#003366",
  "MUBI": "#01c8b9",
  "Mubi": "#01c8b9",
  "Looke": "#e84040",
  "Claro video": "#d7000f",
  "Now": "#e10600",
};

const SECTION_LABEL = {
  fontSize: 11,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "rgba(255,255,255,0.35)",
  marginBottom: 10,
};

export default function TitleWatchProviders({ providers }: Props) {
  if (providers.length === 0) return null;

  return (
    <div>
      <p style={SECTION_LABEL}>Onde assistir</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {providers.map((p) => {
          const dotColor = PROVIDER_COLORS[p.provider_name] ?? "rgba(255,255,255,0.3)";
          const isRent = p.kind === "rent";

          return (
            <div
              key={`${p.provider_id}-${p.kind}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                padding: "5px 12px",
                borderRadius: 10,
                border: "0.5px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.65)",
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: dotColor,
                  flexShrink: 0,
                }}
              />
              {p.provider_name}
              {isRent && (
                <span style={{ color: "rgba(255,255,255,0.35)", marginLeft: 2 }}>
                  · aluguel
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
