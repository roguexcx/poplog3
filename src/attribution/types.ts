export type ApiSourceId =
  | "tmdb"
  | "watchmode"
  | "omdb"
  | "trakt"
  | "movieofthenight"
  | "bancodeseries";

export type AttributionContext =
  | "metadata"
  | "images"
  | "availability"
  | "ratings"
  | "community"
  | "catalogRadar"
  | "calendar";

export type ApiSourceDefinition = {
  id: ApiSourceId;
  name: string;
  shortName?: string;
  role: string;
  officialUrl: string;
  logoUrl?: string;
  legalNotice?: string;
  contexts: AttributionContext[];
  alwaysInGlobalCredits?: boolean;
};
