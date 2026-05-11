import type { Metadata } from "next";
import { notFound } from "next/navigation";
import IndexedTitleGrid from "@/components/titles/IndexedTitleGrid";
import TmdbImage from "@/components/images/TmdbImage";
import { fetchStudioIndex, type StudioKind } from "@/lib/tmdb-index";

type Props = {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ media?: string; page?: string }>;
};

function parseKind(value: string): StudioKind | null {
  return value === "company" || value === "network" ? value : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { kind, id } = await params;
  const studioKind = parseKind(kind);
  const studioId = Number(id);
  if (!studioKind || !studioId) return { title: "Estúdio — POPLOG" };
  const { studio } = await fetchStudioIndex(studioKind, studioId);
  return {
    title: `${studio.name} — POPLOG`,
    description: `Títulos ligados a ${studio.name} no POPLOG.`,
  };
}

export default async function StudioIndexPage({ params, searchParams }: Props) {
  const { kind, id } = await params;
  const { media = "all", page: rawPage } = await searchParams;
  const studioKind = parseKind(kind);
  const studioId = Number(id);
  if (!studioKind || !studioId) notFound();

  const selectedMedia = media === "movie" || media === "tv" ? media : "all";
  const page = Math.max(1, Number(rawPage ?? "1") || 1);
  const { studio, results, movies, series } = await fetchStudioIndex(studioKind, studioId, selectedMedia, page);

  return (
    <main className="min-h-screen bg-[#020617] pb-24 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_36%),radial-gradient(circle_at_80%_0%,rgba(99,102,241,0.08),transparent_32%)]" />
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 md:py-12">
        <header className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end">
          <div className="flex h-24 w-24 items-center justify-center rounded-2xl border border-white/[0.10] bg-white/[0.04] p-4">
            {studio.logo_path ? (
              <TmdbImage
                path={studio.logo_path}
                kind="logo"
                size="large"
                alt={studio.name}
                width={80}
                height={80}
                className="max-h-16 max-w-16 object-contain"
              />
            ) : (
              <span className="text-2xl font-black text-zinc-600">{studio.name.charAt(0)}</span>
            )}
          </div>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.36em] text-sky-300">
              {studioKind === "network" ? "Canal / rede" : "Estúdio / produtora"}
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-6xl">{studio.name}</h1>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold text-zinc-500">
              {studio.headquarters && <span>{studio.headquarters}</span>}
              {studio.origin_country && <span>· {studio.origin_country}</span>}
            </div>
          </div>
        </header>

        <div className="mb-8 flex flex-wrap gap-2">
          {[
            ["all", "Tudo"],
            ["movie", "Filmes"],
            ["tv", "Séries"],
          ].map(([value, label]) => (
            <a
              key={value}
              href={`?media=${value}`}
              className={`rounded-full border px-4 py-2 text-sm font-black transition ${
                selectedMedia === value
                  ? "border-sky-300/35 bg-sky-300/[0.12] text-sky-100"
                  : "border-white/[0.10] text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-300"
              }`}
            >
              {label}
            </a>
          ))}
        </div>

        {selectedMedia === "all" ? (
          <div className="space-y-12">
            <section>
              <h2 className="mb-4 text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">
                Filmes
              </h2>
              <IndexedTitleGrid items={movies} />
            </section>
            <section>
              <h2 className="mb-4 text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">
                Séries
              </h2>
              <IndexedTitleGrid items={series} />
            </section>
          </div>
        ) : (
          <IndexedTitleGrid items={results} />
        )}
      </div>
    </main>
  );
}
