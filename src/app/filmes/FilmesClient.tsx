"use client";

import MediaBrowseClient from "@/components/MediaBrowseClient";

const FILTERS = [
  { key: "popular",     label: "Populares"          },
  { key: "upcoming",    label: "Lançamentos"         },
  { key: "top_rated",   label: "Melhores avaliados"  },
  { key: "now_playing", label: "Nos cinemas"         },
] as const;

export default function FilmesClient() {
  return (
    <MediaBrowseClient
      mediaType="movie"
      pageTitle="Filmes"
      pageSubtitle="Explore os melhores filmes"
      filters={FILTERS}
      defaultFilter="popular"
    />
  );
}
