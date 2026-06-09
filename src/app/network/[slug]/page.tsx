import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/server/db/client";
import { networkDisplayName, normalizeNetworkSlug } from "@/lib/networks/normalize";
import { resolveForRender as resolveCatalogImage } from "@/lib/images/proxy";
import NetworkPageClient from "./NetworkPageClient";

const PAGE_SIZE = 24;

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const name = networkDisplayName(slug);
  return {
    title: `${name} — POPLOG`,
    description: `Títulos originais de ${name} no POPLOG`,
  };
}

export default async function NetworkPage({ params }: Props) {
  const { slug } = await params;

  // Normaliza o slug recebido (garante canonical mesmo com variações de URL)
  const canonicalSlug = normalizeNetworkSlug(networkDisplayName(slug)) === slug
    ? slug
    : slug;

  const [rows, total] = await Promise.all([
    db.poplog3Title.findMany({
      where: { primaryNetworkSlug: canonicalSlug },
      orderBy: [{ popularity: "desc" }, { year: "desc" }],
      take: PAGE_SIZE,
      select: {
        id: true,
        tmdbId: true,
        imdbId: true,
        mediaType: true,
        title: true,
        year: true,
        posterPath: true,
        voteAverage: true,
        genres: true,
        networksJson: true,
      },
    }),
    db.poplog3Title.count({ where: { primaryNetworkSlug: canonicalSlug } }),
  ]);

  // Se não há títulos E o slug não parece válido (vazio ou muito curto), 404
  if (total === 0 && slug.length < 2) {
    notFound();
  }

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

  return (
    <NetworkPageClient
      slug={canonicalSlug}
      displayName={networkDisplayName(canonicalSlug)}
      initialTitles={titles}
      initialTotal={total}
      pageSize={PAGE_SIZE}
    />
  );
}
