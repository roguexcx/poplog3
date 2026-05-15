import Image from "next/image";
import Link from "next/link";

import SectionHeader from "@/components/ui/SectionHeader";

import type {
  TitleCollection,
  TitleMediaType,
  TitleMetadataBlock,
} from "./types";

type TitleMetadataProps = {
  metadata?: TitleMetadataBlock | null;
  mediaType: TitleMediaType;
};

const USD = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatRuntimeMinutes(min: number | null | undefined): string | null {
  if (!min || !Number.isFinite(min)) return null;
  if (min < 60) return `${min} min`;

  const h = Math.floor(min / 60);
  const m = min % 60;

  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

function cleanName(name?: string | null) {
  const value = name?.trim();
  return value && value.length > 0 ? value : null;
}

function joinStringNames(items?: string[] | null, limit = 4) {
  const names = Array.from(
    new Set(
      (items ?? [])
        .map((name) => cleanName(name))
        .filter((name): name is string => Boolean(name))
    )
  ).slice(0, limit);

  return names.length > 0 ? names.join(" • ") : null;
}

function joinNames(
  items?: Array<{ name?: string | null }> | null,
  limit = 4
) {
  const names = (items ?? [])
    .map((item) => cleanName(item.name))
    .filter((name): name is string => Boolean(name))
    .slice(0, limit);

  return names.length > 0 ? names.join(" • ") : null;
}

function formatLanguageName(language: {
  name?: string | null;
  code?: string | null;
}) {
  const name = cleanName(language.name);

  if (name) {
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  return cleanName(language.code);
}

type DetailItem = {
  label: string;
  value: string;
};

function buildDetails(
  metadata: TitleMetadataBlock,
  mediaType: TitleMediaType
): DetailItem[] {
  const details: DetailItem[] = [];

  const creators = joinStringNames(metadata.creators, 3);
  const directors = joinStringNames(metadata.directors, 3);
  const showrunners = joinStringNames(metadata.showrunners, 2);
  const writers = joinStringNames(metadata.writers, 3);
  const composers = joinStringNames(metadata.composers, 2);

  if (creators) {
    details.push({
      label: mediaType === "tv" ? "Criação" : "Criador",
      value: creators,
    });
  }

  if (directors) {
    details.push({
      label: "Direção",
      value: directors,
    });
  }

  if (showrunners && mediaType === "tv") {
    details.push({
      label: "Showrunner",
      value: showrunners,
    });
  }

  if (writers) {
    details.push({
      label: "Roteiro",
      value: writers,
    });
  }

  if (composers) {
    details.push({
      label: "Trilha",
      value: composers,
    });
  }

  if (mediaType === "movie") {
    if (typeof metadata.budget === "number" && metadata.budget > 0) {
      details.push({
        label: "Orçamento",
        value: USD.format(metadata.budget),
      });
    }

    if (typeof metadata.revenue === "number" && metadata.revenue > 0) {
      details.push({
        label: "Bilheteria",
        value: USD.format(metadata.revenue),
      });
    }
  } else {
    const runtime = formatRuntimeMinutes(metadata.episodeRunTimeMinutes);

    if (runtime) {
      details.push({
        label: "Duração média",
        value: runtime,
      });
    }

    if (metadata.seriesType) {
      details.push({
        label: "Formato",
        value: metadata.seriesType,
      });
    }
  }

  const countries = joinNames(metadata.productionCountries, 3);

  if (countries) {
    details.push({
      label: "País",
      value: countries,
    });
  }

  const languages = (metadata.spokenLanguages ?? [])
    .map(formatLanguageName)
    .filter((name): name is string => Boolean(name))
    .slice(0, 3)
    .join(" • ");

  if (languages) {
    details.push({
      label: "Idioma",
      value: languages,
    });
  }

  const networks = joinNames(metadata.networks, 3);

  if (networks) {
    details.push({
      label: "Emissora",
      value: networks,
    });
  }

  const companies = joinNames(metadata.productionCompanies, 4);

  if (companies) {
    details.push({
      label: "Produção",
      value: companies,
    });
  }

  return details;
}

function isMeaningful(metadata: TitleMetadataBlock, mediaType: TitleMediaType) {
  return (
    buildDetails(metadata, mediaType).length > 0 ||
    Boolean(metadata.collection) ||
    Boolean(metadata.homepage)
  );
}

export default function TitleMetadata({
  metadata,
  mediaType,
}: TitleMetadataProps) {
  if (!metadata || !isMeaningful(metadata, mediaType)) return null;

  const details = buildDetails(metadata, mediaType);

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        eyebrow="Bastidores"
        title="Produção"
        accent="neutral"
        size="sm"
      />

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.018] p-4 backdrop-blur-md sm:p-5">
        {details.length > 0 && (
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
            {details.map((item, index) => (
              <div
                key={`${item.label}-${item.value}-${index}`}
                className="min-w-0"
              >
                <dt className="text-[10px] font-black uppercase tracking-[0.18em] text-white/32">
                  {item.label}
                </dt>

                <dd className="mt-1 text-[12px] font-semibold leading-[1.45] tracking-[-0.01em] text-white/72 sm:text-[12.5px]">
  {item.value}
</dd>
              </div>
            ))}
          </dl>
        )}

        {(metadata.collection || metadata.homepage) && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
            {metadata.collection && (
              <CollectionPill collection={metadata.collection} />
            )}

            {metadata.homepage && (
              <Link
                href={metadata.homepage}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white/52 transition hover:border-cyan-200/25 hover:bg-cyan-300/[0.06] hover:text-cyan-100"
              >
                Site oficial →
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function CollectionPill({ collection }: { collection: TitleCollection }) {
  const poster = collection.posterPath
    ? `https://image.tmdb.org/t/p/w92${
        collection.posterPath.startsWith("/")
          ? collection.posterPath
          : `/${collection.posterPath}`
      }`
    : null;

  return (
    <Link
      href={`/franquia/${collection.id}`}
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 pr-3 text-white/70 transition hover:border-fuchsia-200/25 hover:bg-fuchsia-300/[0.06] hover:text-white"
    >
      {poster && (
        <Image
          src={poster}
          alt=""
          width={22}
          height={32}
          unoptimized
          className="h-7 w-5 rounded object-cover opacity-80"
        />
      )}

      <span className="min-w-0 truncate text-[10px] font-black uppercase tracking-[0.16em]">
        {collection.name}
      </span>
    </Link>
  );
}