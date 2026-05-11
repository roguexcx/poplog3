"use client";

import MediaBrowseClient from "@/components/MediaBrowseClient";

const FILTERS = [
  { key: "popular",     label: "Populares"          },
  { key: "upcoming",    label: "Lançamentos"         },
  { key: "top_rated",   label: "Melhores avaliados"  },
  { key: "now_playing", label: "Nos cinemas"         },
] as const;

type Props = {
  genres?: readonly { id: number; name: string }[];
};

export default function FilmesClient({ genres = [] }: Props) {
  return (
    <MediaBrowseClient
      mediaType="movie"
      pageTitle="Filmes"
      pageSubtitle="Explore os melhores filmes"
      filters={FILTERS}
      defaultFilter="popular"
      genres={genres}
    />
  );
}
