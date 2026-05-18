import { tmdbFetch as v3Fetch } from "@/server/api-clients/tmdb/client";

export type ExternalApiParams = Record<string, string | number | boolean | undefined>;

export async function tmdbFetch<T>(
  path: string,
  params: ExternalApiParams = {},
  revalidate = 3600,
  _language: string | null = "pt-BR",
): Promise<T> {
  return v3Fetch<T>(path, { params, revalidate });
}
