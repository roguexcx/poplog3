// src/features/title/TitleSimilar.tsx

import Link from "next/link";
import { buildTmdbUrl } from "@/lib/images/url";
import type { TMDBRelatedItem } from "@/features/title/title-types";

type Props = {
  items: TMDBRelatedItem[];
  mediaType: "movie" | "tv";
};

const SECTION_LABEL = {
  fontSize: 11,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "rgba(255,255,255,0.35)",
  marginBottom: 4,
};

const SUB_LABEL = {
  fontSize: 11,
  color: "rgba(255,255,255,0.3)",
  marginBottom: 10,
};

export default function TitleSimilar({ items, mediaType }: Props) {
  if (items.length === 0) return null;

  const visible = items.slice(0, 5);

  return (
    <div>
      <p style={SECTION_LABEL}>Mais como este</p>
      <p style={SUB_LABEL}>Com clima parecido</p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${visible.length}, 1fr)`,
          gap: 10,
        }}
        className="max-sm:grid-cols-2"
      >
        {visible.map((item) => {
          const title = item.title ?? item.name ?? "Título";
          const year = (item.release_date ?? item.first_air_date)?.slice(0, 4) ?? null;
          const itemMediaType = item.media_type ?? mediaType;

          const imageUrl =
            buildTmdbUrl("poster",   "card",   item.poster_path) ??
            buildTmdbUrl("backdrop", "medium", item.backdrop_path);

          return (
            <Link
              key={item.id}
              href={`/title/${itemMediaType}/${item.id}`}
              style={{
                display: "block",
                borderRadius: 10,
                background: "rgba(255,255,255,0.04)",
                border: "0.5px solid rgba(255,255,255,0.08)",
                overflow: "hidden",
                textDecoration: "none",
                transition: "border-color 0.2s",
              }}
            >
              {/* Thumbnail */}
              <div
                style={{
                  aspectRatio: "16/9",
                  background: imageUrl
                    ? `url(${imageUrl}) center/cover`
                    : "rgba(255,255,255,0.05)",
                }}
              />

              {/* Meta */}
              <div style={{ padding: 8 }}>
                <p
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: "rgba(255,255,255,0.7)",
                    margin: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {title}
                </p>
                {year && (
                  <p
                    style={{
                      fontSize: 10,
                      color: "rgba(255,255,255,0.3)",
                      margin: "2px 0 0",
                    }}
                  >
                    {year}
                  </p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
