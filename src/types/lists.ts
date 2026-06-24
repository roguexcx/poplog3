export type ListMediaType = "movie" | "tv";

export type UserListRecord = {
  id: string;
  shortId: string;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  itemCount: number;
  isPublic: false;
  createdAt: string;
  updatedAt: string;
};

export type UserListTitleItem = {
  id: string;
  listId: string;
  tmdbId: number;
  mediaType: ListMediaType;
  position: number;
  addedAt: string;
  title: string;
  originalTitle: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  year: number | null;
  /** Runtime em minutos: duração do filme ou do episódio (séries). Null quando desconhecido. */
  runtime: number | null;
  /** Data de lançamento (filmes) ou estreia (séries) em ISO (YYYY-MM-DD). Null quando desconhecida. */
  releaseDate: string | null;
  href: string;
};

export type UserListSummary = UserListRecord & {
  ownerUsername: string;
  covers: UserListTitleItem[];
};

export type UserListDetail = {
  list: UserListSummary;
  items: UserListTitleItem[];
};

export type ListsApiSuccess<T> = {
  success: true;
  data: T;
};

export type ListsApiError = {
  error: string;
};
