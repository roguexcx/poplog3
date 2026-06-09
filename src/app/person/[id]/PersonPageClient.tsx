"use client";

import Image from "next/image";
import Link from "next/link";
import { Clapperboard, Film, PenLine, Star, Tv, UserRound, Video } from "lucide-react";
import PageShell from "@/components/layout/PageShell";
import { resolveForRender as resolveCatalogImage } from "@/lib/images/proxy";

// ── Types ─────────────────────────────────────────────────────────────────────

type CreditItem = {
  imdb_id?: string;
  title: string;
  media_type: "movie" | "tv";
  year?: number | null;
  character?: string;
  job?: string;
  department?: string;
  poster_path?: string | null;
};

type PersonData = {
  imdb_id: string;
  name: string;
  biography?: string | null;
  birthday?: string | null;
  deathday?: string | null;
  place_of_birth?: string | null;
  profile_path?: string | null;
  known_for_department?: string | null;
};

type Props = {
  person: PersonData;
  acting: CreditItem[];
  directing: CreditItem[];
  writing: CreditItem[];
  producing: CreditItem[];
  otherCrew: CreditItem[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function creditHref(credit: CreditItem): string | null {
  if (!credit.imdb_id) return null;
  return `/title/${credit.media_type === "tv" ? "tv" : "movie"}/${credit.imdb_id}`;
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("pt-BR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

// ── CreditCard ────────────────────────────────────────────────────────────────

function CreditCard({ credit, showRole = true }: { credit: CreditItem; showRole?: boolean }) {
  const href = creditHref(credit);
  const poster = resolveCatalogImage(credit.poster_path, "w92");
  const mediaLabel = credit.media_type === "tv" ? "Série" : "Filme";
  const MediaIcon = credit.media_type === "tv" ? Tv : Film;

  const inner = (
    <article className="group flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-2.5 transition hover:border-white/[0.12] hover:bg-white/[0.05]">
      <div className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/[0.06]">
        {poster ? (
          <Image
            src={poster}
            alt={credit.title}
            fill
            sizes="56px"
            className="object-cover transition group-hover:scale-105"
          />
        ) : (
          <MediaIcon className="size-5 text-white/30" />
        )}
      </div>
      <div className="min-w-0 py-0.5">
        <p className="truncate text-[13px] font-bold leading-snug text-white/90">{credit.title}</p>
        <p className="mt-0.5 text-[11px] text-white/40">
          {credit.year ?? "—"} · {mediaLabel}
        </p>
        {showRole && credit.character ? (
          <p className="mt-1 truncate text-[11px] text-white/35">como {credit.character}</p>
        ) : null}
        {showRole && credit.job && !credit.character ? (
          <p className="mt-1 truncate text-[11px] text-indigo-300/60">{credit.job}</p>
        ) : null}
      </div>
    </article>
  );

  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

// ── CreditsSection ────────────────────────────────────────────────────────────

function CreditsSection({
  title,
  icon: Icon,
  items,
  maxVisible = 30,
}: {
  title: string;
  icon: React.ElementType;
  items: CreditItem[];
  maxVisible?: number;
}) {
  if (!items.length) return null;
  const shown = items.slice(0, maxVisible);
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2.5">
        <Icon className="size-4 text-indigo-300/70 shrink-0" />
        <h2 className="text-[15px] font-bold tracking-tight text-white/80">{title}</h2>
        <span className="text-[11px] text-white/30">{items.length}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((credit, i) => (
          <CreditCard key={`${credit.imdb_id ?? credit.title}-${i}`} credit={credit} />
        ))}
      </div>
      {items.length > maxVisible ? (
        <p className="text-[11px] text-white/30">
          + {items.length - maxVisible} mais não exibidos
        </p>
      ) : null}
    </section>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function PersonPageClient({
  person,
  acting,
  directing,
  writing,
  producing,
  otherCrew,
}: Props) {
  const profileUrl = resolveCatalogImage(person.profile_path, "w300");
  const birthday = formatDate(person.birthday);
  const deathday = formatDate(person.deathday);
  const totalActing = acting.length;
  const totalCrew = directing.length + writing.length + producing.length + otherCrew.length;
  const hasCrew = totalCrew > 0;

  const departmentLabel = person.known_for_department ?? "Cinema & TV";

  return (
    <PageShell variant="wide">
      <div className="flex flex-col gap-10 py-6 pb-16">

        {/* ── Hero ── */}
        <section className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
          {/* Profile image */}
          <div className="relative mx-auto size-36 shrink-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.04] shadow-[0_18px_50px_rgba(0,0,0,0.4)] sm:mx-0 sm:size-52">
            {profileUrl ? (
              <Image
                src={profileUrl}
                alt={person.name}
                fill
                sizes="(max-width: 640px) 144px, 208px"
                className="object-cover object-top"
                priority
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <UserRound className="size-16 text-white/20" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex flex-col gap-3 sm:pt-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-300/70">
                {departmentLabel}
              </p>
              <h1 className="mt-1.5 text-2xl font-black tracking-[-0.035em] text-white sm:text-4xl">
                {person.name}
              </h1>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-white/40">
              {birthday ? <span>Nascimento: {birthday}</span> : null}
              {deathday ? <span>Falecimento: {deathday}</span> : null}
              {person.place_of_birth ? <span>{person.place_of_birth}</span> : null}
              {totalActing > 0 ? (
                <span className="text-white/30">
                  {totalActing} atuaç{totalActing !== 1 ? "ões" : "ão"}
                  {hasCrew ? ` · ${totalCrew} crédito${totalCrew !== 1 ? "s" : ""} técnicos` : ""}
                </span>
              ) : null}
            </div>

            {person.biography ? (
              <p className="max-w-2xl text-[13px] leading-relaxed text-white/50 sm:text-sm sm:leading-7 line-clamp-6">
                {person.biography}
              </p>
            ) : null}
          </div>
        </section>

        {/* ── Divider ── */}
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.07] to-transparent" />

        {/* ── Credits ── */}
        <div className="flex flex-col gap-10">
          <CreditsSection title="Atuações" icon={Clapperboard} items={acting} />

          {acting.length > 0 && hasCrew ? (
            <div className="h-px bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
          ) : null}

          <CreditsSection title="Direção" icon={Video} items={directing} />
          <CreditsSection title="Roteiro" icon={PenLine} items={writing} />
          <CreditsSection title="Produção" icon={Star} items={producing} />
          <CreditsSection title="Outros créditos" icon={Film} items={otherCrew} maxVisible={20} />
        </div>

        {totalActing === 0 && !hasCrew ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] px-6 py-10 text-center">
            <UserRound className="mx-auto mb-3 size-8 text-white/20" />
            <p className="text-sm font-medium text-white/40">
              Nenhum crédito encontrado no catálogo POPLOG para esta pessoa.
            </p>
          </div>
        ) : null}

      </div>
    </PageShell>
  );
}
