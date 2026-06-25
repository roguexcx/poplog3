import { ImageResponse } from "next/og";

import { absoluteUrl } from "@/lib/seo/title-metadata";
import { resolveForRender } from "@/lib/images/proxy";
import { getPoplogTitleDetails, type PoplogTitleDetailsResult } from "@/server/titles/poplog-title-details";
import { resolvePoplogTitleIdentity } from "@/server/titles/poplog-title-identity";
import { normalizePublicTitleSlug } from "@/server/titles/title-public-routes";
import { normalizeCatalogLanguage, normalizeCatalogRegion } from "@/server/source-engine/locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const size = { width: 1200, height: 630 };

type OgTitle = {
  mediaType: "movie" | "tv";
  title: string;
  originalTitle: string | null;
  overview: string | null;
  year: number | string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
};

function safeMediaType(value: string | null): "movie" | "tv" | null {
  return value === "movie" || value === "tv" ? value : null;
}

function toOgTitle(details: PoplogTitleDetailsResult): OgTitle {
  return {
    mediaType: details.mediaType,
    title: details.title,
    originalTitle: details.originalTitle ?? null,
    overview: details.overview ?? null,
    year: details.year ?? null,
    posterUrl: details.posterUrl ?? null,
    backdropUrl: details.backdropUrl ?? null,
  };
}

function fromQuery(searchParams: URLSearchParams): OgTitle {
  return {
    mediaType: safeMediaType(searchParams.get("mediaType")) ?? "movie",
    title: searchParams.get("title")?.trim() || "POPLOG",
    originalTitle: null,
    overview: null,
    year: searchParams.get("year"),
    posterUrl: null,
    backdropUrl: null,
  };
}

async function resolveBySlug(slug: string, language: string, region: string): Promise<OgTitle | null> {
  const clean = normalizePublicTitleSlug(slug);
  if (!clean) return null;

  for (const mediaType of ["movie", "tv"] as const) {
    const identity = await resolvePoplogTitleIdentity({
      mediaType,
      id: clean,
      sourceHint: "slug",
    }).catch(() => null);
    if (!identity) continue;

    const id = String(identity.poplogId ?? identity.externalIds.imdbId ?? clean);
    const details = await getPoplogTitleDetails({
      mediaType: identity.mediaType,
      id,
      sourceHint: identity.poplogId ? "poplog" : identity.externalIds.imdbId ? "imdb" : "slug",
      region,
      locale: language,
    }).catch(() => null);
    if (details) return toOgTitle(details);
  }

  return null;
}

async function resolveOgTitle(searchParams: URLSearchParams): Promise<OgTitle> {
  const language = normalizeCatalogLanguage(searchParams.get("language"));
  const region = normalizeCatalogRegion(searchParams.get("region"));
  const slug = searchParams.get("slug");
  const bySlug = slug ? await resolveBySlug(slug, language, region) : null;
  if (bySlug) return bySlug;

  const mediaType = safeMediaType(searchParams.get("mediaType"));
  const id = searchParams.get("id")?.trim();
  if (mediaType && id) {
    const details = await getPoplogTitleDetails({
      mediaType,
      id,
      sourceHint: "auto",
      region,
      locale: language,
    }).catch(() => null);
    if (details) return toOgTitle(details);
  }

  return fromQuery(searchParams);
}

function truncate(value: string | null | undefined, limit: number): string | null {
  const clean = value?.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > limit ? `${clean.slice(0, limit - 1).trim()}...` : clean;
}

function imageForOg(src: string | null | undefined, sizeName: string): string | null {
  return absoluteUrl(resolveForRender(src, sizeName)) ?? null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = await resolveOgTitle(searchParams);
  const poster = imageForOg(title.posterUrl, "w780");
  const backdrop = imageForOg(title.backdropUrl ?? title.posterUrl, "w1280");
  const year = title.year ? String(title.year) : null;
  const mediaLabel = title.mediaType === "tv" ? "SERIE" : "FILME";
  const overview = truncate(title.overview, 155);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background: "#05070f",
          color: "white",
          fontFamily: "Arial",
        }}
      >
        {backdrop ? (
          <img
            src={backdrop}
            width={1200}
            height={630}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: 0.42,
            }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            background:
              "linear-gradient(90deg, rgba(3,7,18,0.96) 0%, rgba(3,7,18,0.86) 43%, rgba(3,7,18,0.58) 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            background:
              "radial-gradient(circle at 82% 16%, rgba(56,189,248,0.22), transparent 34%), radial-gradient(circle at 18% 92%, rgba(244,114,182,0.18), transparent 30%)",
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            width: "100%",
            height: "100%",
            padding: 58,
            gap: 46,
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              width: 292,
              height: 438,
              borderRadius: 26,
              overflow: "hidden",
              background: "linear-gradient(145deg, #172033, #070b14)",
              border: "1px solid rgba(255,255,255,0.18)",
              boxShadow: "0 28px 90px rgba(0,0,0,0.55)",
            }}
          >
            {poster ? (
              <img
                src={poster}
                width={292}
                height={438}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <div
                style={{
                  display: "flex",
                  width: "100%",
                  height: "100%",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "rgba(255,255,255,0.42)",
                  fontSize: 34,
                  fontWeight: 900,
                }}
              >
                POPLOG
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 24,
                color: "#67e8f9",
                fontSize: 24,
                fontWeight: 900,
                letterSpacing: 1,
              }}
            >
              <span>{mediaLabel}</span>
              {year ? <span style={{ color: "rgba(255,255,255,0.62)" }}>{year}</span> : null}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: title.title.length > 42 ? 58 : 70,
                lineHeight: 1.02,
                fontWeight: 900,
                letterSpacing: 0,
                maxWidth: 740,
              }}
            >
              {title.title}
            </div>
            {title.originalTitle && title.originalTitle !== title.title ? (
              <div
                style={{
                  display: "flex",
                  marginTop: 16,
                  fontSize: 26,
                  color: "rgba(255,255,255,0.58)",
                  fontWeight: 700,
                }}
              >
                {title.originalTitle}
              </div>
            ) : null}
            {overview ? (
              <div
                style={{
                  display: "flex",
                  marginTop: 28,
                  fontSize: 28,
                  lineHeight: 1.32,
                  color: "rgba(255,255,255,0.76)",
                  maxWidth: 760,
                }}
              >
                {overview}
              </div>
            ) : null}
            <div
              style={{
                display: "flex",
                marginTop: 46,
                alignItems: "center",
                gap: 16,
                color: "rgba(255,255,255,0.72)",
                fontSize: 24,
                fontWeight: 800,
              }}
            >
              <span style={{ color: "white", fontWeight: 950 }}>POPLOG</span>
              <span style={{ color: "rgba(255,255,255,0.34)" }}>Catalogo, disponibilidade e biblioteca</span>
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
