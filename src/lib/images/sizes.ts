// src/lib/images/sizes.ts

/**
 * Política semântica de tamanhos de imagem do TMDB.
 *
 * O TMDB serve várias resoluções por imagem (w92, w185, w342, w500,
 * w780, w1280, h632, original). Hard-codar essas strings em componentes
 * é frágil — usamos nomes semânticos por contexto de uso.
 *
 * Regra de ouro: `original` é caro (3–5 MB em backdrops) e estoura
 * os limites do otimizador da Vercel em produção. Use `hero` (w1280)
 * para o maior caso de uso e reserve `full` apenas quando o usuário
 * realmente vai querer baixar a imagem em tela cheia.
 */
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

/** Mapeia um `kind` para o nome do pool correspondente na resposta `/images`. */
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
