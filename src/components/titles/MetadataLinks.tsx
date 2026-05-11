import Link from "next/link";
import TmdbImage from "@/components/images/TmdbImage";
import { genreHref, personHref, studioHref, type IndexedMediaType, type StudioKind } from "@/lib/tmdb-index";

export type GenreLink = { id: number; name: string };
export type PersonLink = { id: number; name: string; subtitle?: string | null; image?: string | null };
export type StudioLink = { id: number; name: string; kind: StudioKind; logo?: string | null };

export function GenreChips({ genres, media }: { genres: GenreLink[]; media: IndexedMediaType }) {
  return (
    <div className="flex flex-wrap gap-2">
      {genres.map((genre) => (
        <Link
          key={genre.id}
          href={genreHref(media, genre.id)}
          className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs font-semibold text-zinc-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md transition hover:border-sky-300/35 hover:bg-sky-300/[0.10] hover:text-sky-100"
        >
          {genre.name}
        </Link>
      ))}
    </div>
  );
}

export function InlinePeopleLinks({ people }: { people: PersonLink[] }) {
  return (
    <>
      {people.map((person, index) => (
        <span key={person.id}>
          {index > 0 && ", "}
          <Link href={personHref(person.id)} className="font-bold text-zinc-300 transition hover:text-sky-200">
            {person.name}
          </Link>
        </span>
      ))}
    </>
  );
}

export function PeopleList({ people }: { people: PersonLink[] }) {
  return (
    <div className="space-y-3">
      {people.map((person) => (
        <Link key={person.id} href={personHref(person.id)} className="flex items-center gap-3 rounded-xl transition hover:bg-white/[0.04]">
          <TmdbImage
            path={person.image ?? null}
            kind="profile"
            size="medium"
            alt={person.name}
            width={40}
            height={40}
            className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/10"
            fallback={
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5 text-xs text-zinc-500 ring-1 ring-white/10">
                {person.name.charAt(0)}
              </div>
            }
          />
          <div className="min-w-0 py-1">
            <p className="truncate text-xs font-bold text-zinc-200">{person.name}</p>
            {person.subtitle && <p className="truncate text-[11px] text-zinc-500">{person.subtitle}</p>}
          </div>
        </Link>
      ))}
    </div>
  );
}

export function StudioLinks({ studios }: { studios: StudioLink[] }) {
  if (!studios.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {studios.map((studio) => (
        <Link
          key={`${studio.kind}-${studio.id}`}
          href={studioHref(studio.kind, studio.id)}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-zinc-300 transition hover:border-sky-300/35 hover:bg-sky-300/[0.10] hover:text-sky-100"
        >
          {studio.logo && (
            <TmdbImage
              path={studio.logo}
              kind="logo"
              size="small"
              alt={studio.name}
              width={18}
              height={18}
              className="h-4 w-4 rounded object-contain"
            />
          )}
          {studio.name}
        </Link>
      ))}
    </div>
  );
}
