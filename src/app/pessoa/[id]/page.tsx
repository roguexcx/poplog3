import type { Metadata } from "next";
import { notFound } from "next/navigation";
import IndexedTitleGrid from "@/components/titles/IndexedTitleGrid";
import TmdbImage from "@/components/images/TmdbImage";
import { fetchPersonIndex } from "@/lib/tmdb-index";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const personId = Number(id);
  if (!personId) return { title: "Pessoa — POPLOG" };
  const { person } = await fetchPersonIndex(personId);
  return {
    title: `${person.name} — POPLOG`,
    description: person.biography || `Filmografia e principais trabalhos de ${person.name}.`,
  };
}

export default async function PersonIndexPage({ params }: Props) {
  const { id } = await params;
  const personId = Number(id);
  if (!personId) notFound();

  const { person, knownFor, recent, cast, crew } = await fetchPersonIndex(personId);

  return (
    <main className="min-h-screen bg-[#020617] pb-24 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_36%),radial-gradient(circle_at_80%_0%,rgba(99,102,241,0.08),transparent_32%)]" />
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 md:py-12">
        <header className="mb-10 grid gap-6 md:grid-cols-[180px_1fr] md:items-end">
          <div className="relative aspect-[2/3] w-40 overflow-hidden rounded-2xl border border-white/[0.10] bg-white/[0.04] shadow-[0_24px_80px_rgba(0,0,0,0.55)] md:w-full">
            <TmdbImage
              path={person.profile_path ?? null}
              kind="profile"
              size="large"
              alt={person.name}
              fill
              priority
              sizes="180px"
              className="object-cover"
              fallback={<div className="h-full w-full bg-white/[0.04]" />}
            />
          </div>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.36em] text-sky-300">
              Elenco / direção
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-6xl">{person.name}</h1>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold text-zinc-500">
              {person.known_for_department && <span>{person.known_for_department}</span>}
              {person.place_of_birth && <span>· {person.place_of_birth}</span>}
            </div>
            {person.biography && (
              <p className="mt-5 line-clamp-4 max-w-3xl text-sm leading-relaxed text-zinc-400">
                {person.biography}
              </p>
            )}
          </div>
        </header>

        <div className="space-y-12">
          <section>
            <h2 className="mb-4 text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">
              Principais trabalhos
            </h2>
            <IndexedTitleGrid items={knownFor} />
          </section>

          <section>
            <h2 className="mb-4 text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">
              Recentes
            </h2>
            <IndexedTitleGrid items={recent} />
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div>
              <h2 className="mb-4 text-[11px] font-black uppercase tracking-[0.35em] text-zinc-500">
                Como elenco
              </h2>
              <IndexedTitleGrid items={cast.slice(0, 12)} columns="compact" />
            </div>
            <div>
              <h2 className="mb-4 text-[11px] font-black uppercase tracking-[0.35em] text-zinc-500">
                Direção / equipe
              </h2>
              <IndexedTitleGrid items={crew.slice(0, 12)} columns="compact" />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
