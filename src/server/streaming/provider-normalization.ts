export type NormalizedProvider = {
  name: string;
  logoPath: string | null;
};

const PROVIDER_ALIASES: Record<string, NormalizedProvider> = {
  "apple tv+": {
    name: "Apple TV+",
    logoPath: "/68MNrwlkpF7WnmNPXLah69CR5cb.jpg",
  },
  "appletv+": {
    name: "Apple TV+",
    logoPath: "/68MNrwlkpF7WnmNPXLah69CR5cb.jpg",
  },
  "apple tv plus": {
    name: "Apple TV+",
    logoPath: "/68MNrwlkpF7WnmNPXLah69CR5cb.jpg",
  },
  "apple tv": {
    name: "Apple TV+",
    logoPath: "/68MNrwlkpF7WnmNPXLah69CR5cb.jpg",
  },

  "hbo max": {
    name: "Max",
    logoPath: null,
  },
  "max": {
    name: "Max",
    logoPath: null,
  },
};

export function normalizeProviderKey(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function normalizeProvider(
  providerName: string | null | undefined,
  logoPath?: string | null
): NormalizedProvider | null {
  const key = normalizeProviderKey(providerName);

  if (!key) return null;

  const normalized = PROVIDER_ALIASES[key];

  if (normalized) {
    return {
      name: normalized.name,
      logoPath: normalized.logoPath ?? logoPath ?? null,
    };
  }

  return {
    name: providerName ?? "",
    logoPath: logoPath ?? null,
  };
}