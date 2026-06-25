export type ApiSourceId =
  | "tmdb"
  | "watchmode"
  | "trakt"
  | "movieofthenight"
  | "bancodeseries"
  | "balloonerismm";

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
