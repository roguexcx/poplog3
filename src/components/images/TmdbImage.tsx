import Image from "next/image";

type TmdbImageProps = {
  path: string | null;
  fallbackPath?: string | null;
  size?: "w300" | "w500" | "w780" | "original";
  alt?: string;
  className?: string;
  priority?: boolean;
  fallbackLabel?: string;
};

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

function normalizePath(path: string | null | undefined) {
  if (!path) return null;
  return path.startsWith("/") ? path : `/${path}`;
}

export function TmdbImage({
  path,
  fallbackPath = null,
  size = "w500",
  alt = "",
  className = "",
  priority = false,
  fallbackLabel = "Sem imagem",
}: TmdbImageProps) {
  const imagePath = normalizePath(path) ?? normalizePath(fallbackPath);

  if (!imagePath) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-4 text-center text-xs font-semibold uppercase tracking-[0.18em] text-white/35 ${className}`}
      >
        {fallbackLabel}
      </div>
    );
  }

  const src = `${TMDB_IMAGE_BASE}/${size}${imagePath}`;

  return (
    <Image
      src={src}
      alt={alt}
      fill
      priority={priority}
      unoptimized
      sizes="(max-width: 768px) 50vw, (max-width: 1280px) 20vw, 16vw"
      className={className}
    />
  );
}