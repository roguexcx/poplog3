// ─── Types ───────────────────────────────────────────────────────────────────

export type ShortcutAccent =
  | "rose" | "blue" | "violet" | "amber" | "green" | "indigo" | "teal" | "orange";

export type DiscoveryFilterMode = "any" | "all";

/** Editorial filter applied against Trakt genre slugs. */
export type DiscoveryFilter = {
  id: string;
  label: string;
  slugs: string[];
  mode: DiscoveryFilterMode;
  keywords?: string[];
  excludeSlugs?: string[];
  /** When true, genre match required (keywords alone are not sufficient). */
  strict?: boolean;
  /** Swap label to "Populares no gênero: X" when fallback is used. */
  fallbackPopularLabel?: boolean;
  /** Fetch popular-by-genre from local DB when Trakt Index result is thin. */
  popularFallback?: boolean;
  desc?: string;
  icon: string;
  accent: ShortcutAccent;
  group: "genre" | "mood";
};

export type TrendingShortcut = {
  id: string;
  label: string;
  icon: string;
  accent: ShortcutAccent;
  description: string;
  scope: "all" | "movie" | "tv";
};

// ─── Trending (Em alta) ───────────────────────────────────────────────────────

export const TRENDING_SHORTCUTS: TrendingShortcut[] = [
  {
    id: "bombando-agora",
    label: "Bombando agora",
    icon: "🔥",
    accent: "rose",
    description: "Os títulos mais populares no momento, filmes e séries.",
    scope: "all",
  },
  {
    id: "filmes-em-alta",
    label: "Filmes em alta",
    icon: "🎬",
    accent: "blue",
    description: "Os filmes mais assistidos e comentados desta semana.",
    scope: "movie",
  },
  {
    id: "series-em-alta",
    label: "Séries em alta",
    icon: "📺",
    accent: "violet",
    description: "As séries com mais maratonas e buzz agora.",
    scope: "tv",
  },
];

// ─── Curated genre groups ─────────────────────────────────────────────────────

export const CURATED_GROUPS: DiscoveryFilter[] = [
  {
    id: "acao-aventura",
    label: "Ação & Aventura",
    slugs: ["action", "adventure", "superhero", "western"],
    mode: "any",
    keywords: ["superhero", "super hero", "marvel", "dc", "hero", "heroes", "cowboy"],
    desc: "ação, aventura, super-heróis e western",
    icon: "💥",
    accent: "rose",
    group: "genre",
  },
  {
    id: "horror-thriller",
    label: "Horror & Thriller",
    slugs: ["horror", "thriller", "suspense"],
    mode: "any",
    desc: "horror, thriller e suspense",
    icon: "👻",
    accent: "violet",
    group: "genre",
  },
  {
    id: "familia-animacao-anime",
    label: "Família, Animação & Anime",
    slugs: ["family", "children", "animation", "anime", "donghua"],
    mode: "any",
    excludeSlugs: ["horror", "thriller", "crime", "war", "soap", "reality", "game-show", "adult"],
    strict: true,
    desc: "família, infantil, animação, anime e donghua",
    icon: "🎨",
    accent: "amber",
    group: "genre",
  },
  {
    id: "documentario-biografia-historia",
    label: "Documentário, Biografia & História",
    slugs: ["documentary", "biography", "history", "news"],
    mode: "any",
    keywords: [
      "documentary", "documentário", "docuseries", "docu-series", "true crime",
      "nature documentary", "wildlife", "biography", "biopic", "based on true story",
    ],
    excludeSlugs: ["comedy", "romance", "fantasy", "science-fiction", "sci-fi", "action", "adventure", "horror", "thriller", "animation", "anime"],
    strict: true,
    fallbackPopularLabel: true,
    popularFallback: true,
    desc: "documentários, biografias e histórias reais",
    icon: "🎥",
    accent: "teal",
    group: "genre",
  },
  {
    id: "musica-musical",
    label: "Música & Musical",
    slugs: ["music", "musical"],
    mode: "any",
    keywords: ["music", "música", "musical", "concert", "band", "singer", "cantor", "album", "tour"],
    fallbackPopularLabel: true,
    popularFallback: true,
    desc: "music e musical mesclados",
    icon: "🎵",
    accent: "orange",
    group: "genre",
  },
  {
    id: "drama-prestigio",
    label: "Drama / Prestígio",
    slugs: ["drama", "history", "biography", "war", "soap"],
    mode: "any",
    excludeSlugs: ["romance", "family", "children", "animation", "anime", "donghua"],
    desc: "drama, história, biografia, guerra e soap",
    icon: "🎭",
    accent: "indigo",
    group: "genre",
  },
  {
    id: "romance",
    label: "Romance",
    slugs: ["romance"],
    mode: "any",
    keywords: ["romance", "romantic", "romântico", "romantic comedy", "romcom", "love story"],
    excludeSlugs: ["crime", "horror", "thriller", "war", "action", "adventure", "documentary"],
    fallbackPopularLabel: true,
    popularFallback: true,
    desc: "romance e histórias de amor",
    icon: "❤️",
    accent: "rose",
    group: "genre",
  },
];

// ─── Standalone genre buttons (not merged into curated groups) ────────────────

export const STANDALONE_GENRES: DiscoveryFilter[] = [
  {
    id: "comedia",
    label: "Comédia",
    slugs: ["comedy"],
    mode: "any",
    desc: "comédias populares",
    icon: "😂",
    accent: "amber",
    group: "genre",
  },
  {
    id: "crime",
    label: "Crime",
    slugs: ["crime"],
    mode: "any",
    desc: "filmes e séries de crime",
    icon: "🔍",
    accent: "indigo",
    group: "genre",
  },
  {
    id: "fantasia",
    label: "Fantasia",
    slugs: ["fantasy"],
    mode: "any",
    excludeSlugs: ["animation", "anime", "children", "family"],
    desc: "mundos mágicos e fantasia épica",
    icon: "🧙",
    accent: "violet",
    group: "genre",
  },
  {
    id: "misterio",
    label: "Mistério",
    slugs: ["mystery"],
    mode: "any",
    desc: "mistério e suspense psicológico",
    icon: "🕵️",
    accent: "indigo",
    group: "genre",
  },
];

// ─── Moods editoriais ─────────────────────────────────────────────────────────

export const MOODS: DiscoveryFilter[] = [
  {
    id: "adrenalina",
    label: "Adrenalina",
    slugs: ["action", "adventure", "thriller"],
    mode: "any",
    desc: "ação, aventura e suspense de alta velocidade",
    icon: "⚡",
    accent: "rose",
    group: "mood",
  },
  {
    id: "assustador",
    label: "Assustador",
    slugs: ["horror", "thriller", "suspense"],
    mode: "any",
    desc: "terror, thriller e suspense",
    icon: "😱",
    accent: "violet",
    group: "mood",
  },
  {
    id: "leve",
    label: "Leve",
    slugs: ["comedy", "romance", "family"],
    mode: "any",
    excludeSlugs: ["horror", "thriller", "crime", "war"],
    desc: "comédia, romance e família — sem peso",
    icon: "😌",
    accent: "green",
    group: "mood",
  },
  {
    id: "investigacao",
    label: "Investigação",
    slugs: ["crime", "mystery", "thriller", "suspense"],
    mode: "any",
    keywords: ["true crime", "investigation", "investigação"],
    desc: "crime, mistério e true crime",
    icon: "🔎",
    accent: "indigo",
    group: "mood",
  },
  {
    id: "sci-fi-futurista",
    label: "Sci-fi / Futurista",
    slugs: ["science-fiction", "sci-fi", "fantasy"],
    mode: "any",
    desc: "ficção científica e fantasia especulativa",
    icon: "🚀",
    accent: "blue",
    group: "mood",
  },
  {
    id: "plot-twist",
    label: "Plot Twist",
    slugs: ["mystery", "thriller", "suspense", "crime", "science-fiction"],
    mode: "any",
    desc: "mistério, thriller e reviravoltas",
    icon: "🌀",
    accent: "orange",
    group: "mood",
  },
];

// ─── All genre/mood filters combined ─────────────────────────────────────────

export const ALL_FILTERS: DiscoveryFilter[] = [
  ...CURATED_GROUPS,
  ...STANDALONE_GENRES,
  ...MOODS,
];

// ─── Lookup helpers ───────────────────────────────────────────────────────────

export function findTrending(id: string): TrendingShortcut | undefined {
  return TRENDING_SHORTCUTS.find((s) => s.id === id);
}

export function findFilter(id: string): DiscoveryFilter | undefined {
  return ALL_FILTERS.find((f) => f.id === id);
}

/** Backward-compatible lookup used by shortcut route and view. */
export function findShortcut(
  slug: string,
): (Omit<DiscoveryFilter, "group"> & { group: { id: string; label: string } }) | (TrendingShortcut & { group: { id: string; label: string } }) | undefined {
  const trending = findTrending(slug);
  if (trending) {
    return { ...trending, group: { id: "em-alta", label: "Em alta" } };
  }
  const filter = findFilter(slug);
  if (filter) {
    return { ...filter, group: { id: filter.group, label: filter.group === "mood" ? "Moods" : "Gêneros" } };
  }
  return undefined;
}

// ─── Hidden / merged genre slugs (not shown as standalone buttons) ────────────

export const HIDDEN_GENRE_SLUGS = new Set([
  "talk-show", "talkshow", "sporting-event", "special-interest",
  "short", "none", "suspense", "thriller-suspense", "reality",
  "game-show", "game show", "holiday", "home-and-garden",
  "home-garden", "mini-series", "miniseries", "news",
]);
