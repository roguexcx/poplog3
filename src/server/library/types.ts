export const POPLOG3_LIBRARY_STATUSES = [
  "watchlist",
  "watching",
  "watched",
  "abandoned",
  "fridge",
] as const;

export type Poplog3LibraryStatus =
  (typeof POPLOG3_LIBRARY_STATUSES)[number];

export type Poplog3UserTitle = {
  id: string;
  user_id: string;
  tmdb_id: number;
  media_type: "movie" | "tv";
  status: Poplog3LibraryStatus;
  rating: number | null;
  liked: boolean | null;
  favorite: boolean;
  notes: string | null;
  started_at: string | null;
  finished_at: string | null;
  abandoned_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UpsertUserTitleInput = {
  userId: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  status: Poplog3LibraryStatus;
  rating?: number | null;
  liked?: boolean | null;
  favorite?: boolean;
  notes?: string | null;
};