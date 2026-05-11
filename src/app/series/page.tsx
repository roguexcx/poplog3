import type { Metadata } from "next";
import SeriesClient from "./SeriesClient";
import { fetchGenreList } from "@/lib/tmdb-index";

export const metadata: Metadata = {
  title: "Séries — POPLOG",
  description: "Explore as melhores séries no Poplog.",
};

export default async function SeriesPage() {
  const genres = await fetchGenreList("tv");
  return <SeriesClient genres={genres} />;
}
