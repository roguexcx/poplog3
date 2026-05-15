import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";

import PosterCard from "@/components/ui/PosterCard";
import EmptyState from "@/components/ui/EmptyState";
import SectionHeader from "@/components/ui/SectionHeader";

type PersonTitle = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  vote_average?: number | null;
  popularity?: number | null;
  overview?: string | null;
};

type PersonResponse = {
  ok: boolean;

  person: {
    tmdb_id: number;
    name: string;
    biography?: string | null;
    birthday?: string | null;
    deathday?: string | null;
    place_of_birth?: string | null;
    known_for_department?: string | null;
    popularity?: number;
    profile_path?: string | null;

    external_ids?: {
      imdb_id?: string | null;
      instagram_id?: string | null;
      twitter_id?: string | null;
      tiktok_id?: string | null;
    };

    images?: {
      file_path: string;
    }[];
  };

  knownFor: PersonTitle[];
  acting: PersonTitle[];
  directing: PersonTitle[];
  creating: PersonTitle[];
  appearances: PersonTitle[];
};

type PessoaPageProps = {
  params: Promise<{
    id: string;
  }>;
};

function imageUrl(path?: string | null, size = "w500") {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

function getYear(title: PersonTitle) {
  const date = title.release_date ?? title.first_air_date;
  if (!date) return undefined;

  const year = new Date(date).getFullYear();
  return Number.isFinite(year) ? year : undefined;
}

function TitleGrid({ titles }: { titles: PersonTitle[] }) {
  if (!titles.length) return null;

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4 lg:grid-cols-6">
      {titles.map((title) => (
        <PosterCard
          key={`${title.media_type}-${title.tmdb_id}`}
          href={`/title/${title.media_type}/${title.tmdb_id}`}
          mediaType={title.media_type}
          title={title.title}
          posterPath={title.poster_path}
          fallbackPath={title.backdrop_path}
          year={getYear(title)}
        />
      ))}
    </div>
  );
}

export default async function PessoaPage({ params }: PessoaPageProps) {
  const { id } = await params;

  const headersList = await headers();
  const host = headersList.get("host");
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";

  const response = await fetch(
    `${protocol}://${host}/api/poplog3/people/${id}`,
    {
      next: {
        revalidate: 3600,
      },
    }
  );

  if (!response.ok) {
    return (
      <EmptyState
        title="Pessoa não encontrada."
        description="Não foi possível carregar os dados."
      />
    );
  }

  const data: PersonResponse = await response.json();

  if (!data.ok || !data.person) {
    return (
      <EmptyState
        title="Pessoa não encontrada."
        description="Não foi possível carregar os dados."
      />
    );
  }

  const person = data.person;
  const profileImage = imageUrl(person.profile_path, "w780");

  const shortBiography =
    person.biography && person.biography.length > 560
      ? `${person.biography.slice(0, 560).trim()}...`
      : person.biography;

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[#030712]" />
      <div className="pointer-events-none fixed left-1/2 top-0 -z-10 h-[440px] w-[760px] -translate-x-1/2 rounded-full bg-indigo-500/12 blur-[130px]" />
      <div className="pointer-events-none fixed bottom-0 right-0 -z-10 h-[320px] w-[420px] rounded-full bg-cyan-500/8 blur-[110px]" />

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-5 pb-20 md:px-6">
        <section className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-white/[0.035] p-4 shadow-2xl shadow-black/25 backdrop-blur-2xl md:p-5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(99,102,241,0.18),transparent_28%),radial-gradient(circle_at_85%_20%,rgba(6,182,212,0.1),transparent_24%)]" />

          <div className="relative grid gap-5 lg:grid-cols-[180px_1fr]">
            <div className="relative aspect-[2/3] overflow-hidden rounded-[22px] border border-white/[0.08] bg-white/[0.04]">
              {profileImage ? (
                <Image
                  src={profileImage}
                  alt={person.name}
                  fill
                  priority
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-white/35">
                  Sem imagem
                </div>
              )}
            </div>

            <div className="flex flex-col justify-center">
              <div className="mb-3 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-200/75">
                <span className="h-px w-8 bg-indigo-300/65" />
                Pessoa
              </div>

              <h1 className="max-w-4xl text-3xl font-black tracking-[-0.055em] text-white md:text-5xl">
                {person.name}
              </h1>

              {person.known_for_department ? (
                <p className="mt-2 text-sm font-medium text-white/55">
                  {person.known_for_department}
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                {person.birthday ? (
                  <div className="rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 text-xs text-white/65">
                    Nascimento: {person.birthday}
                  </div>
                ) : null}

                {person.place_of_birth ? (
                  <div className="rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 text-xs text-white/65">
                    {person.place_of_birth}
                  </div>
                ) : null}
              </div>

              {shortBiography ? (
                <p className="mt-4 max-w-4xl text-sm leading-6 text-white/55">
                  {shortBiography}
                </p>
              ) : null}

              <div className="mt-5 flex flex-wrap gap-2">
                {person.external_ids?.imdb_id ? (
                  <Link
                    href={`https://www.imdb.com/name/${person.external_ids.imdb_id}`}
                    target="_blank"
                    className="rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/[0.08]"
                  >
                    IMDb
                  </Link>
                ) : null}

                {person.external_ids?.instagram_id ? (
                  <Link
                    href={`https://instagram.com/${person.external_ids.instagram_id}`}
                    target="_blank"
                    className="rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/[0.08]"
                  >
                    Instagram
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {data.knownFor?.length ? (
          <section className="space-y-5">
            <SectionHeader
              title="Conhecido por"
              subtitle="Principais trabalhos da carreira."
            />
            <TitleGrid titles={data.knownFor} />
          </section>
        ) : null}

        {data.acting?.length ? (
          <section className="space-y-5">
            <SectionHeader
              title="Atuação"
              subtitle="Filmes e séries com personagens creditados."
            />
            <TitleGrid titles={data.acting} />
          </section>
        ) : null}

        {data.directing?.length ? (
          <section className="space-y-5">
            <SectionHeader title="Direção" subtitle="Projetos dirigidos." />
            <TitleGrid titles={data.directing} />
          </section>
        ) : null}

        {data.creating?.length ? (
          <section className="space-y-5">
            <SectionHeader
              title="Criação"
              subtitle="Projetos criados ou escritos."
            />
            <TitleGrid titles={data.creating} />
          </section>
        ) : null}

        {data.appearances?.length ? (
          <section className="space-y-5 opacity-60">
            <SectionHeader
              title="Participações"
              subtitle="Especiais, documentários, reality shows e aparições de menor prioridade."
            />
            <TitleGrid titles={data.appearances.slice(0, 12)} />
          </section>
        ) : null}
      </div>
    </div>
  );
}