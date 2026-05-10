import type { Metadata } from "next";
import FilmesClient from "./FilmesClient";

export const metadata: Metadata = {
  title: "Filmes — POPLOG",
  description: "Explore os melhores filmes no Poplog.",
};

export default function FilmesPage() {
  return <FilmesClient />;
}
