// src/features/home/components/HeroSection.tsx

import SearchBar from "@/features/search/SearchBar";
import FeaturedCard from "@/features/home/components/FeaturedCard";
import FilterChips from "@/features/home/components/FilterChips";
import { getHeroHeadline } from "@/features/home/home-utils";
import type { TMDBItem } from "@/types/tmdb";

type Props = {
  backdropUrl: string | null;
  featuredItem: TMDBItem | null;
  featuredType: "movie" | "tv";
  featuredTitle: string;
  featuredRank: number | null;
  featuredTypeLabel: string;
  posterUrl: string | null;
  year: string | null;
  runtime: string | null;
  seasons: number | null;
  genres: string | null;
  overview: string | null;
};

export default function HeroSection({
  backdropUrl,
  featuredItem,
  featuredType,
  featuredTitle,
  featuredRank,
  featuredTypeLabel,
  posterUrl,
  year,
  runtime,
  seasons,
  genres,
  overview,
}: Props) {
  const heroHeadline = getHeroHeadline();

  return (
    <section className="relative z-30 min-h-[66vh] overflow-visible">
      {/* Background layers */}
      {backdropUrl && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${backdropUrl})` }}
        />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(2,6,23,0.96)_0%,rgba(2,6,23,0.78)_32%,rgba(2,6,23,0.26)_64%,rgba(2,6,23,0.70)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.86)_0%,transparent_22%,rgba(2,6,23,0.28)_54%,#020617_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_38%_12%,rgba(56,189,248,0.22),transparent_32%)]" />
      <div className="absolute inset-y-0 right-0 w-[48%] bg-[linear-gradient(to_left,rgba(2,6,23,0.98)_0%,rgba(2,6,23,0.88)_28%,rgba(2,6,23,0.46)_58%,rgba(2,6,23,0.10)_82%,transparent_100%)]" />
      <div className="absolute inset-0 opacity-[0.035] [background-image:radial-gradient(circle_at_center,white_1px,transparent_1px)] [background-size:24px_24px]" />

      {/* Navbar */}
      <nav className="relative z-20 mx-auto flex max-w-[1560px] items-center justify-between px-6 pt-8 md:px-10">
        <p className="text-sm font-black tracking-tight text-white">POPLOG</p>

        <div className="hidden items-center gap-3 text-zinc-300 md:flex">
          <button
            type="button"
            aria-label="Favoritos"
            className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-black/20 backdrop-blur-md"
          >
            ♡
          </button>
          <button
            type="button"
            aria-label="Configurações"
            className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-black/20 backdrop-blur-md"
          >
            ⚙
          </button>
        </div>
      </nav>

      {/* Hero content */}
      <div className="relative z-10 mx-auto grid min-h-[calc(66vh-72px)] max-w-[1560px] items-center gap-10 px-6 pb-16 pt-8 md:px-10 lg:grid-cols-[1fr_500px]">
        {/* Left: headline + search */}
        <div className="max-w-3xl">
          <p className="mb-7 text-[11px] font-bold uppercase leading-5 tracking-[0.38em] text-zinc-300">
            Descubra, salve e acompanhe
            <br />
            o que assistir.
          </p>

          <h1 className="max-w-3xl text-[3.2rem] font-black leading-[0.88] tracking-tight text-white sm:text-[4.1rem] md:text-[5.4rem]">
            {heroHeadline.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h1>

          <div className="relative z-50 mt-8 max-w-2xl">
            <SearchBar />
          </div>

          <FilterChips />
        </div>

        {/* Right: featured card (desktop only) */}
        {featuredItem && (
          <FeaturedCard
  item={featuredItem}
  mediaType={featuredType}
  title={featuredTitle}
  featuredRank={featuredRank}
  featuredTypeLabel={featuredTypeLabel}
  posterUrl={posterUrl}
  year={year}
  runtime={runtime}
  seasons={seasons}
  genres={genres}
  overview={overview}
/>
        )}
      </div>
    </section>
  );
}
