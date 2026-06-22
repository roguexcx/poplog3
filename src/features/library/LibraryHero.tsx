import { TmdbImageLegacy as TmdbImage } from "@/components/images/TmdbImage";
import { resolveDisplayTitle } from "@/lib/titles/display-title";
import type { Poplog3UserLibraryItem } from "@/server/library/library-service";

type LibraryHeroProps = {
  library: Poplog3UserLibraryItem[];
  totalCount: number;
};

export default function LibraryHero({ library, totalCount }: LibraryHeroProps) {
  const heroItem =
    library.find((item) => item.title?.backdrop_path) ??
    library.find((item) => item.title?.poster_path) ??
    null;

  const heroTitle = heroItem
    ? resolveDisplayTitle({
        title: heroItem.title?.title,
        originalTitle: heroItem.title?.original_title,
        tmdbId: heroItem.tmdb_id,
        imdbId: heroItem.imdb_id,
        mediaType: heroItem.media_type,
      })
    : "Biblioteca";

  return (
    <section className="relative w-full">
      <div className="relative min-h-[230px] overflow-hidden rounded-[1.65rem] border border-white/[0.06] bg-[#03040a] shadow-[0_32px_120px_rgba(0,0,0,0.58)] sm:min-h-[300px] sm:rounded-[2rem] md:min-h-[340px] lg:rounded-[2.5rem]">
        <div className="absolute inset-0">
          {heroItem?.title && (
            <TmdbImage
              path={heroItem.title.backdrop_path ?? heroItem.title.poster_path}
              fallbackPath={heroItem.title.poster_path ?? null}
              size="w1280"
              alt={heroTitle}
              fallbackLabel={heroTitle}
              className="h-full w-full object-cover opacity-[0.18] blur-[2px] scale-105 saturate-[0.85]"
            />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(3,4,10,0.99)_0%,rgba(3,4,10,0.82)_55%,rgba(3,4,10,0.94)_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(3,4,10,1.0)_0%,rgba(3,4,10,0.28)_65%,rgba(3,4,10,0.72)_100%)]" />
          <div className="absolute left-[-8%] top-[-20%] h-[28rem] w-[28rem] rounded-full bg-indigo-500/[0.18] blur-[130px]" />
          <div className="absolute right-[-6%] bottom-[-14%] h-[22rem] w-[22rem] rounded-full bg-fuchsia-500/[0.10] blur-[110px]" />
        </div>

        <div className="relative flex h-full min-h-[230px] flex-col justify-end p-5 sm:min-h-[300px] sm:p-8 md:min-h-[340px] md:p-10 lg:p-12">
          <div className="mb-3 flex items-center gap-3 sm:mb-4">
            <span className="h-px w-8 rounded-full bg-cyan-200/75" />
            <span className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100/65">
              Sua coleção
            </span>
          </div>

          <h1 className="text-[42px] font-black leading-[0.9] tracking-[-0.04em] text-white sm:text-7xl sm:tracking-[-0.07em] md:text-8xl lg:text-[7rem]">
            Biblioteca
          </h1>

          <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-white/42 sm:mt-4 sm:text-[15px]">
            {totalCount > 0
              ? `${totalCount} ${totalCount === 1 ? "título organizado" : "títulos organizados"} no seu acervo — watchlist, favoritos, obras em andamento, pausas e memória da sua jornada.`
              : "Seu acervo pessoal de filmes e séries — organizado, registrado e curado."}
          </p>
        </div>
      </div>
    </section>
  );
}
