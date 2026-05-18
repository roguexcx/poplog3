export type MediaType = "movie" | "tv";

export type UserTitle = {
  id: string;
  user_id: string;
  tmdb_id: number;
  media_type: MediaType;
  status: string;
  favorite: boolean;
  liked?: boolean | null;
  created_at: string;
  watched_at: string | null;
  title: string | null;
  release_year: number | null;
  fridge?: boolean | null;
  stream_status?: string | null;
  stream_status_checked_at?: string | null;
};
