import { db } from "@/server/db/client";

export type StreamingProviderLocal = {
  id: string;
  provider_name: string;
  provider_slug: string | null;
  logo_url: string | null;
  tmdb_provider_id: number | null;
  country: string;
  is_active: boolean;
};

export type UserStreamingPreferenceLocal = {
  provider_id: string;
  country: string;
  is_enabled: boolean;
  priority_order: number;
};

export async function listActiveStreamingProviders(country = "BR"): Promise<StreamingProviderLocal[]> {
  const rows = await db.streamingProvider.findMany({
    where: {
      country,
      isActive: true,
    },
    orderBy: { name: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    provider_name: row.name,
    provider_slug: row.providerSlug,
    logo_url: row.logoPath,
    tmdb_provider_id: row.tmdbProviderId,
    country: row.country,
    is_active: row.isActive,
  }));
}

export async function listUserStreamingPreferences(
  userId: string,
  country = "BR",
): Promise<UserStreamingPreferenceLocal[]> {
  const rows = await db.userStreamingPreference.findMany({
    where: {
      userId,
      country,
    },
    orderBy: { priorityOrder: "asc" },
  });

  return rows.map((row) => ({
    provider_id: row.providerId,
    country: row.country,
    is_enabled: row.isEnabled,
    priority_order: row.priorityOrder,
  }));
}

export async function replaceUserStreamingPreferences(input: {
  userId: string;
  country?: string;
  providerIds: string[];
}): Promise<void> {
  const country = input.country ?? "BR";
  const now = new Date();

  await db.userStreamingPreference.updateMany({
    where: {
      userId: input.userId,
      country,
    },
    data: {
      isEnabled: false,
      priorityOrder: 999,
      updatedAt: now,
    },
  });

  for (const [index, providerId] of input.providerIds.entries()) {
    await db.userStreamingPreference.upsert({
      where: {
        userId_providerId_country: {
          userId: input.userId,
          providerId,
          country,
        },
      },
      update: {
        isEnabled: true,
        priorityOrder: index + 1,
        updatedAt: now,
      },
      create: {
        userId: input.userId,
        providerId,
        country,
        isEnabled: true,
        priorityOrder: index + 1,
      },
    });
  }
}

export async function getFavoriteTmdbProviderIds(input: {
  userId: string;
  country?: string;
}): Promise<number[]> {
  const rows = await db.userStreamingPreference.findMany({
    where: {
      userId: input.userId,
      country: input.country ?? "BR",
      isEnabled: true,
    },
    include: {
      provider: true,
    },
    orderBy: { priorityOrder: "asc" },
  });

  return rows
    .map((row) => row.provider.tmdbProviderId)
    .filter((id): id is number => typeof id === "number");
}
