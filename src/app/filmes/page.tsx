import type { Metadata } from "next";
import FilmesClient from "./FilmesClient";
import { fetchGenreList } from "@/lib/tmdb-index";

export const metadata: Metadata = {
  title: "Filmes — POPLOG",
  description: "Explore os melhores filmes no Poplog.",
};

export default async function FilmesPage() {
  const genres = await fetchGenreList("movie");
  return <FilmesClient genres={genres} />;
}
