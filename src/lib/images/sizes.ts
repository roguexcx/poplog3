export const IMAGE_SIZES = {
  poster: {
    thumb:  "w92",
    small:  "w185",
    card:   "w342",
    detail: "w500",
    hero:   "w780",
  },
  backdrop: {
    card:   "w300",
    medium: "w780",
    hero:   "w1280",
    full:   "original",
  },
  profile: {
    small:  "w45",
    medium: "w185",
    large:  "h632",
  },
  still: {
    small:  "w92",
    medium: "w185",
    large:  "w300",
  },
  logo: {
    small:  "w45",
    medium: "w92",
    large:  "w185",
  },
} as const;

export type ImageKind = keyof typeof IMAGE_SIZES;

export type ImageSizeOf<K extends ImageKind> = keyof (typeof IMAGE_SIZES)[K];

export const KIND_TO_POOL: Record<
  ImageKind,
  "posters" | "backdrops" | "profiles" | "stills" | "logos"
> = {
  poster:   "posters",
  backdrop: "backdrops",
  profile:  "profiles",
  still:    "stills",
  logo:     "logos",
};
