import type { TMDBImage } from "@/types/tmdb";
import {
  BACKDROP_RANDOMIZATION_LANGUAGES,
  POSTER_RANDOMIZATION_LANGUAGES,
} from "./config";
import { KIND_TO_POOL, type ImageKind } from "./sizes";
import { fetchTitleImages } from "./fetch";

type PickOptions = {
  languages?: readonly (string | null)[];
};

function getDefaultLanguagesForKind(kind: ImageKind): readonly (string | null)[] {
  return kind === "backdrop"
    ? BACKDROP_RANDOMIZATION_LANGUAGES
    : POSTER_RANDOMIZATION_LANGUAGES;
}

export function pickRandomImage(
  images: TMDBImage[] | undefined,
  options: PickOptions = {},
): TMDBImage | null {
  const { languages = POSTER_RANDOMIZATION_LANGUAGES } = options;
  if (!images || images.length === 0) return null;

  const buckets: TMDBImage[][] = languages
    .map((lang) =>
      images.filter((img) => {
        const imgLang = img.iso_639_1 ?? null;
        return imgLang === lang && Boolean(img.file_path);
      }),
    )
    .filter((bucket) => bucket.length > 0);

  if (buckets.length === 0) return null;

  const bucket = buckets[Math.floor(Math.random() * buckets.length)];
  return bucket[Math.floor(Math.random() * bucket.length)] ?? null;
}

export async function getRandomTitleImagePath(
  mediaType: "movie" | "tv",
  id: number,
  kind: ImageKind,
  options: PickOptions = {},
): Promise<string | null> {
  const images = await fetchTitleImages(mediaType, id);
  const pool = images[KIND_TO_POOL[kind]];
  const picked = pickRandomImage(pool, {
    languages: options.languages ?? getDefaultLanguagesForKind(kind),
  });
  return picked?.file_path ?? null;
}

export async function getRandomTitleImages(
  mediaType: "movie" | "tv",
  id: number,
  options: PickOptions = {},
): Promise<{
  posterPath: string | null;
  backdropPath: string | null;
}> {
  const images = await fetchTitleImages(mediaType, id);
  return {
    posterPath:
      pickRandomImage(images.posters, {
        languages: options.languages ?? POSTER_RANDOMIZATION_LANGUAGES,
      })?.file_path ?? null,
    backdropPath:
      pickRandomImage(images.backdrops, {
        languages: options.languages ?? BACKDROP_RANDOMIZATION_LANGUAGES,
      })?.file_path ?? null,
  };
}
