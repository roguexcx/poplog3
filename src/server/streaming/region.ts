export type StreamingRegion = "BR" | "US";

export const DEFAULT_STREAMING_REGION: StreamingRegion = "BR";

const loggedRegionDecisions = new Set<string>();

function logRegionDecision(message: string, source: string, region: string | null) {
  const key = `${message}:${source}:${region ?? "-"}`;
  if (loggedRegionDecisions.has(key)) return;
  loggedRegionDecisions.add(key);
  console.log("[region:audit]", { source, region, decision: message });
}

export function normalizeStreamingRegion(
  value: string | null | undefined,
  options: {
    source: string;
    explicit?: boolean;
    allowUS?: boolean;
  },
): StreamingRegion {
  const raw = value?.trim().toUpperCase() ?? "";
  const explicit = Boolean(options.explicit);
  const allowUS = options.allowUS ?? true;

  if (raw === "BR" || raw === "") return "BR";

  if (raw === "US") {
    if (explicit && allowUS) {
      logRegionDecision("explicit_us", options.source, raw);
      return "US";
    }

    logRegionDecision("implicit_us_ignored_default_br", options.source, raw);
    return DEFAULT_STREAMING_REGION;
  }

  logRegionDecision("invalid_region_default_br", options.source, raw);
  return DEFAULT_STREAMING_REGION;
}
