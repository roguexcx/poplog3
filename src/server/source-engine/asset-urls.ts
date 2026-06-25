function publicBaseUrl(): string {
  return (
    process.env.POPLOG_ASSET_PUBLIC_BASE_URL?.replace(/\/+$/, "") ??
    process.env.NEXT_PUBLIC_POPLOG_ASSET_PUBLIC_BASE_URL?.replace(/\/+$/, "") ??
    "/storage"
  );
}

export function resolveAssetUrl(assetKey?: string | null): string | null {
  const key = assetKey?.trim();
  if (!key) return null;
  if (/^https?:\/\//i.test(key)) return key;
  if (key.startsWith("/")) return key;
  return `${publicBaseUrl()}/${key.replace(/^\/+/, "")}`;
}
