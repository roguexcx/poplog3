import type { Metadata } from "next";
import { notFound } from "next/navigation";
import IndexedTitleGrid from "@/components/titles/IndexedTitleGrid";
import { fetchGenreName, fetchGenreTitles, mediaLabel, type IndexedMediaType } from "@/lib/tmdb-index";

type Props = {
  params: Promise<{ media: string; id: string }>;
  searchParams: Promise<{ page?: string }>;
};

function parseMedia(value: string): IndexedMediaType | null {
  return value === "movie" || value === "tv" ? value : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { media, id } = await params;
  const parsedMedia = parseMedia(media);
  const genreId = Number(id);
  if (!parsedMedia || !genreId) return { title: "Gêneros — POPLOG" };
  const name = await fetchGenreName(parsedMedia, genreId);
  return {
    title: `${name} em ${mediaLabel(parsedMedia)} — POPLOG`,
    description: `Explore títulos populares de ${name} no POPLOG.`,
  };
}

export default async function GenreIndexPage({ params, searchParams }: Props) {
  const { media, id } = await params;
  const { page: rawPage } = await searchParams;
  const parsedMedia = parseMedia(media);
  const genreId = Number(id);
  if (!parsedMedia || !genreId) notFound();

  const page = Math.max(1, Number(rawPage ?? "1") || 1);
  const [genreName, data] = await Promise.all([
    fetchGenreName(parsedMedia, genreId),
    fetchGenreTitles(parsedMedia, genreId, page),
  ]);

  return (
    <main className="min-h-screen bg-[#020617] pb-24 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_36%),radial-gradient(circle_at_80%_0%,rgba(99,102,241,0.08),transparent_32%)]" />
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 md:py-12">
        <header className="mb-8">
          <p className="text-[11px] font-black uppercase tracking-[0.36em] text-sky-300">
            Índice por gênero
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-6xl">{genreName}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Principais {mediaLabel(parsedMedia).toLowerCase()} desse gênero, ordenados por relevância e popularidade atual no TMDB.
          </p>
        </header>

        <IndexedTitleGrid items={data.results} />
      </div>
    </main>
  );
}
