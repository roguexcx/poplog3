import type { StreamStatus } from "@/lib/streaming";
import type { MediaType, UserTitle } from "@/types/user";

export type UserTitleInput = Pick<UserTitle, "id" | "tmdb_id" | "media_type" | "status" | "favorite" | "created_at">;

export type TmdbEnrichedTitle<TTmdb = unknown> = UserTitleInput & {
  tmdb: TTmdb | null;
};

export type WatchlistLiveRawTitle = {
  id: number;
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  release_year: number | null;
  created_at: string;
  fridge: boolean;
  stream_status: StreamStatus | null;
  stream_status_checked_at: string | null;
};

export type WatchlistLiveProviderType = "flatrate" | "rent" | "buy";

export type WatchlistLiveTitle = {
  id: number;
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  original_title_label: string | null;
  poster_path: string | null;
  year: string | null;
  genre: string | null;
  runtime: number | null;
  runtime_label: string | null;
  seasons: number | null;
  origin: "cinema" | "streaming";
  release_date: string;
  created_at: string;
  stream_status: StreamStatus;
  providers: { name: string; logo: string; type: WatchlistLiveProviderType }[];
  estimated_platform: string | null;
  estimated_month: string | null;
  context_pool: string[];
  fridge: boolean;
  stream_status_updated: boolean;
};
