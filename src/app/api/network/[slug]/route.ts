import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { networkDisplayName } from "@/lib/networks/normalize";
import { resolveForRender as resolveCatalogImage } from "@/lib/images/proxy";

const PAGE_SIZE = 24;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const skip = (page - 1) * PAGE_SIZE;

  try {
    const [rows, total] = await Promise.all([
      db.poplog3Title.findMany({
        where: { primaryNetworkSlug: slug },
        orderBy: [{ popularity: "desc" }, { year: "desc" }],
        skip,
        take: PAGE_SIZE,
        select: {
          id: true,
          tmdbId: true,
          imdbId: true,
          mediaType: true,
          title: true,
          originalTitle: true,
          year: true,
          posterPath: true,
          voteAverage: true,
          genres: true,
          networksJson: true,
        },
      }),
      db.poplog3Title.count({ where: { primaryNetworkSlug: slug } }),
    ]);

    const titles = rows.map((r) => ({
      id: r.id,
      tmdbId: r.tmdbId,
      imdbId: r.imdbId,
      mediaType: r.mediaType,
      title: r.title,
      year: r.year,
      posterUrl: r.posterPath ? resolveCatalogImage(r.posterPath, "poster") : null,
      rating: r.voteAverage ? Number(r.voteAverage) : null,
      genres: Array.isArray(r.genres) ? (r.genres as string[]) : [],
    }));

    return NextResponse.json({
      slug,
      displayName: networkDisplayName(slug),
      titles,
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        total,
        totalPages: Math.ceil(total / PAGE_SIZE),
      },
    });
  } catch (err) {
    console.error("[network/route] erro:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
