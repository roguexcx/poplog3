"use client";

import Image from "next/image";
import Link from "next/link";
import { Clapperboard, Film, PenLine, Star, Tv, UserRound, Video } from "lucide-react";
import PageShell from "@/components/layout/PageShell";
import { resolveForRender as resolveCatalogImage } from "@/lib/images/proxy";
import { buildTitleHref } from "@/lib/title-href";
import type {
  PoplogPersonCredit,
  PoplogPersonPageData,
} from "@/server/poplog-people/getPersonPageData";

// ── Types ─────────────────────────────────────────────────────────────────────

type PersonInfo = NonNullable<PoplogPersonPageData["person"]>;

type Props = {
  person: PersonInfo;
  acting: PoplogPersonCredit[];
  directing: PoplogPersonCredit[];
  writing: PoplogPersonCredit[];
  producing: PoplogPersonCredit[];
  otherCrew: PoplogPersonCredit[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEPARTMENT_LABELS: Record<string, string> = {
  acting: "Atuação",
  directing: "Direção",
  writing: "Roteiro",
  production: "Produção",
  editing: "Edição",
  camera: "Fotografia",
  sound: "Som",
  art: "Arte",
  crew: "Equipe técnica",
  "costume & make-up": "Figurino e Maquiagem",
  "visual effects": "Efeitos visuais",
  creator: "Criação",
};

function departmentLabel(department: string | null | undefined): string {
  if (!department) return "Cinema & TV";
  return DEPARTMENT_LABELS[department.toLowerCase()] ?? department;
}

const JOB_LABELS: Record<string, string> = {
  director: "Direção",
  writer: "Roteiro",
  screenplay: "Roteiro",
  story: "História",
  producer: "Produção",
  "executive producer": "Produção executiva",
  editor: "Edição",
  creator: "Criação",
  novel: "Obra original",
};

function jobLabel(job: string | null | undefined): string | null {
  if (!job) return null;
  return JOB_LABELS[job.toLowerCase()] ?? job;
}

function creditHref(credit: PoplogPersonCredit): string | null {
  const ext = credit.externalIds;
  const hasAnyId =
    Boolean(ext?.imdbId) || Boolean(ext?.traktSlug) || ext?.traktId != null || ext?.tmdbId != null;
  if (!hasAnyId) return null;
  return buildTitleHref({
    mediaType: credit.mediaType,
    externalIds: {
      imdbId: ext?.imdbId ?? null,
      slug: ext?.traktSlug ?? null,
      traktId: ext?.traktId ?? null,
      tmdbId: ext?.tmdbId ?? null,
    },
  });
}

function creditYear(credit: PoplogPersonCredit): number | null {
  if (credit.year != null) return credit.year;
  const date = credit.releaseDate ?? credit.firstAirDate;
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) && year > 1800 ? year : null;
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

function CreditCard({ credit, showRole = true }: { credit: PoplogPersonCredit; showRole?: boolean }) {
  const href = creditHref(credit);
  const poster = resolveCatalogImage(credit.posterUrl, "w92");
  const year = creditYear(credit);
  const mediaLabel = credit.mediaType === "tv" ? "Série" : "Filme";
  const MediaIcon = credit.mediaType === "tv" ? Tv : Film;
  const role = jobLabel(credit.job);

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
          {year ?? "—"} · {mediaLabel}
        </p>
        {showRole && credit.character ? (
          <p className="mt-1 truncate text-[11px] text-white/35">como {credit.character}</p>
        ) : null}
        {showRole && role && !credit.character ? (
          <p className="mt-1 truncate text-[11px] text-indigo-300/60">{role}</p>
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
  items: PoplogPersonCredit[];
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
          <CreditCard key={`${credit.id}-${i}`} credit={credit} />
        ))}
      </div>
      {items.length > maxVisible ? (
        <p className="text-[11px] text-white/30">
          + {items.length - maxVisible} créditos não exibidos
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
  const profileUrl = resolveCatalogImage(person.profileImage, "w300");
  const birthday = formatDate(person.birthday);
  const deathday = formatDate(person.deathday);
  const totalActing = acting.length;
  const totalCrew = directing.length + writing.length + producing.length + otherCrew.length;
  const hasCrew = totalCrew > 0;
  const hasAnyCredit = totalActing > 0 || hasCrew;

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
                {departmentLabel(person.knownForDepartment)}
              </p>
              <h1 className="mt-1.5 text-2xl font-black tracking-[-0.035em] text-white sm:text-4xl">
                {person.name}
              </h1>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-white/40">
              {birthday ? <span>Nascimento: {birthday}</span> : null}
              {deathday ? <span>Falecimento: {deathday}</span> : null}
              {person.placeOfBirth ? <span>{person.placeOfBirth}</span> : null}
              {totalActing > 0 ? (
                <span className="text-white/30">
                  {totalActing} atuaç{totalActing !== 1 ? "ões" : "ão"}
                  {hasCrew ? ` · ${totalCrew} crédito${totalCrew !== 1 ? "s" : ""} técnicos` : ""}
                </span>
              ) : hasCrew ? (
                <span className="text-white/30">
                  {totalCrew} crédito{totalCrew !== 1 ? "s" : ""} técnicos
                </span>
              ) : null}
            </div>

            {person.biography ? (
              <p className="max-w-2xl text-[13px] leading-relaxed text-white/50 sm:text-sm sm:leading-7 line-clamp-6">
                {person.biography}
              </p>
            ) : (
              <p className="text-[12px] italic text-white/30">Sem biografia disponível.</p>
            )}
          </div>
        </section>

        {/* ── Divider ── */}
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.07] to-transparent" />

        {/* ── Credits ── */}
        <div className="flex flex-col gap-10">
          <CreditsSection title="Atuação" icon={Clapperboard} items={acting} />

          {acting.length > 0 && hasCrew ? (
            <div className="h-px bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
          ) : null}

          <CreditsSection title="Direção" icon={Video} items={directing} />
          <CreditsSection title="Roteiro" icon={PenLine} items={writing} />
          <CreditsSection title="Produção" icon={Star} items={producing} />
          <CreditsSection title="Outros créditos" icon={Film} items={otherCrew} maxVisible={20} />
        </div>

        {!hasAnyCredit ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] px-6 py-10 text-center">
            <UserRound className="mx-auto mb-3 size-8 text-white/20" />
            <p className="text-sm font-medium text-white/40">
              Nenhum crédito encontrado no catálogo POPLOG para esta pessoa.
            </p>
            <p className="mt-1 text-[12px] text-white/25">
              Os créditos podem aparecer aqui quando as fontes externas forem atualizadas.
            </p>
          </div>
        ) : null}

      </div>
    </PageShell>
  );
}
