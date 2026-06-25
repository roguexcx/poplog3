const RESERVED_TOP_LEVEL_SLUGS = new Set([
  "acompanhando",
  "admin",
  "agenda",
  "api",
  "buscar",
  "debug",
  "estudio",
  "filmes",
  "franquia",
  "generos",
  "library",
  "network",
  "para-voce",
  "person",
  "pessoa",
  "profile",
  "radar",
  "series",
  "settings",
  "sorteio",
  "storage",
  "title",
  "u",
]);

export function normalizePublicTitleSlug(slug: string | null | undefined): string | null {
  const clean = slug?.trim().toLowerCase().replace(/^\/+|\/+$/g, "") ?? "";
  if (!clean) return null;
  if (!/^[a-z0-9][a-z0-9-]{1,180}$/.test(clean)) return null;
  if (RESERVED_TOP_LEVEL_SLUGS.has(clean)) return null;
  return clean;
}

export function publicTitlePathFromSlug(slug: string | null | undefined): string | null {
  const clean = normalizePublicTitleSlug(slug);
  return clean ? `/${clean}` : null;
}

export function legacyTitlePath(input: {
  mediaType: string;
  id: string | number | null | undefined;
}): string {
  return `/title/${input.mediaType}/${input.id ?? ""}`;
}
