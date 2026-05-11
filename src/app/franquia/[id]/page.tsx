import type { Metadata } from "next";
import { notFound } from "next/navigation";
import IndexedTitleGrid from "@/components/titles/IndexedTitleGrid";
import TmdbImage from "@/components/images/TmdbImage";
import { fetchCollectionUniverse } from "@/lib/tmdb-index";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const collectionId = Number(id);
  if (!collectionId) return { title: "Franquia — POPLOG" };
  const collection = await fetchCollectionUniverse(collectionId);
  return {
    title: `${collection.name} — POPLOG`,
    description: collection.overview || `Filmes da franquia ${collection.name}.`,
  };
}

export default async function FranchisePage({ params }: Props) {
  const { id } = await params;
  const collectionId = Number(id);
  if (!collectionId) notFound();

  const collection = await fetchCollectionUniverse(collectionId);

  return (
    <main className="min-h-screen bg-[#020617] pb-24 text-white">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0">
          <TmdbImage
            path={collection.backdrop_path ?? collection.poster_path ?? null}
            kind={collection.backdrop_path ? "backdrop" : "poster"}
            size="hero"
            alt={collection.name}
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-35"
            fallback={<div className="h-full w-full bg-[#020617]" />}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#020617]/55 via-[#020617]/80 to-[#020617]" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <p className="text-[11px] font-black uppercase tracking-[0.36em] text-sky-300">
            Franquia / universo
          </p>
          <h1 className="mt-2 max-w-4xl text-4xl font-black tracking-tight sm:text-6xl">{collection.name}</h1>
          {collection.overview && (
            <p className="mt-5 max-w-3xl text-sm leading-relaxed text-zinc-300">
              {collection.overview}
            </p>
          )}
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <IndexedTitleGrid items={collection.parts ?? []} />
      </div>
    </main>
  );
}
