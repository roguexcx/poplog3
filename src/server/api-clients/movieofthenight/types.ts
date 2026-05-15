export type MotnStreamingOption = {
  service?: {
    id?: string;
    name?: string;
  };
  type?: "subscription" | "rent" | "buy" | "free" | "addon";
  link?: string;
  quality?: string;
  audios?: Array<{
    language?: string;
  }>;
  subtitles?: Array<{
    locale?: {
      language?: string;
    };
  }>;
  expiresSoon?: boolean;
  expiresOn?: string;
  availableSince?: number;
};

export type MotnTitleResponse = {
  itemType?: "movie" | "show";
  showType?: string;
  id?: string;
  imdbId?: string;
  tmdbId?: string;
  title?: string;
  overview?: string;
  releaseYear?: number;
  firstAirYear?: number;
  lastAirYear?: number;
  genres?: Array<{
    id?: string;
    name?: string;
  }>;
  rating?: number;
  runtime?: number;
  imageSet?: {
    verticalPoster?: {
      w240?: string;
      w360?: string;
      w480?: string;
    };
    horizontalBackdrop?: {
      w360?: string;
      w720?: string;
      w1080?: string;
    };
  };
  streamingOptions?: Record<string, MotnStreamingOption[]>;
};