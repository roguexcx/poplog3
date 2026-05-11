import Link from "next/link";
import IndexedTitleGrid from "@/components/titles/IndexedTitleGrid";
import TmdbImage from "@/components/images/TmdbImage";
import type { TmdbCollection } from "@/lib/tmdb-index";

type Props = {
  collection: TmdbCollection | null;
};

export default function FranchiseUniverse({ collection }: Props) {
  if (!collection?.parts?.length) return null;

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">
            Franquia / universo
          </p>
          <h2 className="mt-2 text-2xl font-black text-white">{collection.name}</h2>
        </div>
        {collection.id && (
          <Link
            href={`/franquia/${collection.id}`}
            className="hidden rounded-full border border-white/[0.10] bg-white/[0.04] px-4 py-2 text-xs font-black text-zinc-400 transition hover:bg-white/[0.08] hover:text-white sm:inline-flex"
          >
            Ver tudo
          </Link>
        )}
      </div>

      <div className="relative overflow-hidden rounded-[1.4rem] border border-white/[0.08] bg-white/[0.035] p-4">
        {collection.backdrop_path && (
          <div className="pointer-events-none absolute inset-0 opacity-20">
            <TmdbImage
              path={collection.backdrop_path}
              kind="backdrop"
              size="hero"
              alt={collection.name}
              fill
              sizes="100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-[#020617]/55 via-[#020617]/85 to-[#020617]" />
          </div>
        )}
        <div className="relative">
          {collection.overview && (
            <p className="mb-5 max-w-3xl text-sm leading-relaxed text-zinc-400">
              {collection.overview}
            </p>
          )}
          <IndexedTitleGrid items={collection.parts} columns="compact" />
        </div>
      </div>
    </section>
  );
}
