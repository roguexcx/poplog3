// src/app/title/[type]/[id]/page.tsx

import { notFound } from "next/navigation";
import { tmdbFetch } from "@/lib/tmdb";
import TitlePage from "@/features/title/TitlePage";
import type { TMDBTitleDetail } from "@/features/title/title-types";

type Props = {
  params: Promise<{ type: string; id: string }>;
};

export default async function TitleDetailPage({ params }: Props) {
  const { type, id } = await params;

  if (type !== "movie" && type !== "tv") notFound();

  const mediaType = type as "movie" | "tv";
  const appendTo =
    mediaType === "movie"
      ? "credits,videos,watch/providers,recommendations,similar,release_dates"
      : "credits,videos,watch/providers,recommendations,similar,content_ratings";

  try {
    const detail = await tmdbFetch<TMDBTitleDetail>(`/${mediaType}/${id}`, {
      append_to_response: appendTo,
    });
    return <TitlePage detail={detail} mediaType={mediaType} />;
  } catch {
    notFound();
  }
}
