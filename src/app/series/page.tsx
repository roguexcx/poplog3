import type { Metadata } from "next";
import SeriesClient from "./SeriesClient";

export const metadata: Metadata = {
  title: "Séries — POPLOG",
  description: "Explore as melhores séries no Poplog.",
};

export default function SeriesPage() {
  return <SeriesClient />;
}
