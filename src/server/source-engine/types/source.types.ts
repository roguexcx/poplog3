export type SourceConfidence =
  | "very_high"
  | "high"
  | "medium"
  | "low"
  | "predicted"
  | "stale"
  | "unverified";

export type SourceMeta = {
  primary: string;
  confidence: SourceConfidence;
  usedFallback: boolean;
  fetchedAt?: string;
};
