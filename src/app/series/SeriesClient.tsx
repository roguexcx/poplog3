"use client";

import MediaBrowseClient from "@/components/MediaBrowseClient";

const FILTERS = [
  { key: "popular",    label: "Populares"        },
  { key: "on_the_air", label: "Em exibição"      },
  { key: "top_rated",  label: "Melhores avaliadas" },
] as const;

type Props = {
  genres?: readonly { id: number; name: string }[];
};

export default function SeriesClient({ genres = [] }: Props) {
  return (
    <MediaBrowseClient
      mediaType="tv"
      pageTitle="Séries"
      pageSubtitle="Explore as melhores séries"
      filters={FILTERS}
      defaultFilter="popular"
      genres={genres}
    />
  );
}
