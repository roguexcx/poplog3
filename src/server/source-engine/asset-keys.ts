export type AssetKind = "poster" | "backdrop" | "profile" | "logo";

export const STORAGE_PATHS: Record<AssetKind, string> = {
  poster: "posters",
  backdrop: "backdrops",
  profile: "profiles",
  logo: "logos",
};

export function isAssetKey(value?: string | null): boolean {
  const key = value?.trim();
  if (!key) return false;
  return Object.values(STORAGE_PATHS).some((prefix) => key === prefix || key.startsWith(`${prefix}/`));
}

export function sanitizeAssetKey(assetKey: string): string {
  const normalized = assetKey.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!isAssetKey(normalized)) throw new Error("Invalid asset key prefix.");
  if (normalized.includes("\0") || normalized.split("/").some((part) => part === "..")) {
    throw new Error("Invalid asset key path.");
  }
  return normalized;
}
