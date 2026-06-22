import Link from "next/link";

import { formatEpisodeRuntimeLabel, formatRuntimeLabel } from "@/lib/domain-labels";

import type {
  TitleMediaType,
  TitleMetadataBlock,
} from "./types";

type TitleMetadataProps = {
  metadata?: TitleMetadataBlock | null;
  mediaType: TitleMediaType;
};

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

type NetworkItem = {
  name: string;
  slug: string;
};

type DetailItem = {
  label: string;
  value: string;
  networks?: NetworkItem[];
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

  if (mediaType === "tv") {
    const runtime = formatEpisodeRuntimeLabel(metadata.episodeRunTimeMinutes, {
      estimated: metadata.episodeRunTimeEstimated,
      spaced: true,
    });

    if (runtime) {
      details.push({
        label: "Duração média",
        value: runtime,
      });
    }

    const totalRuntime = formatRuntimeLabel(metadata.totalRuntimeMinutes, {
      estimated: metadata.totalRuntimeEstimated,
      spaced: true,
    });

    if (totalRuntime) {
      details.push({
        label: "Duração prevista",
        value: totalRuntime,
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

  const networksWithSlugs = (metadata.networks ?? [])
    .filter((n) => Boolean(n.name))
    .slice(0, 3)
    .map((n) => ({ name: n.name!, slug: n.slug ?? "" }));

  if (networksWithSlugs.length > 0) {
    details.push({
      label: "Emissora",
      value: networksWithSlugs.map((n) => n.name).join(" • "),
      networks: networksWithSlugs,
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
    <section className="relative overflow-hidden rounded-[1.5rem] border border-white/[0.08] bg-white/[0.035] p-5 backdrop-blur-xl">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_0%,rgba(148,163,184,0.07),transparent_50%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"
        aria-hidden
      />

      <div className="relative">
        <div className="mb-3 flex items-center gap-2 text-white/55">
          <span aria-hidden className="text-[13px]">{"✦"}</span>
          <span className="text-xs font-black uppercase tracking-[0.18em]">
            Ficha técnica
          </span>
        </div>

        {details.length > 0 && (
          <dl className="mt-3 flex flex-col divide-y divide-white/[0.05]">
            {details.map((item, index) => (
              <div
                key={`${item.label}-${item.value}-${index}`}
                className="grid gap-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(100px,0.55fr)_minmax(0,1fr)] sm:items-start sm:gap-3"
              >
                <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-white/32">
                  {item.label}
                </dt>
                <dd className="min-w-0 text-left text-[11.5px] font-semibold leading-[1.45] tracking-[-0.01em] text-white/70 break-words sm:text-right">
                  {item.networks && item.networks.length > 0 ? (
                    <span className="inline-flex flex-wrap justify-start gap-x-1 gap-y-0.5 sm:justify-end">
                      {item.networks.map((n, i) => (
                        <span key={n.slug || n.name} className="inline-flex items-center">
                          {i > 0 && <span className="mr-1 text-white/30">•</span>}
                          {n.slug ? (
                            <Link
                              href={`/network/${n.slug}`}
                              className="transition-colors hover:text-white"
                            >
                              {n.name}
                            </Link>
                          ) : (
                            <span>{n.name}</span>
                          )}
                        </span>
                      ))}
                    </span>
                  ) : (
                    item.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {metadata.homepage && (
          <div className="mt-4 border-t border-white/[0.06] pt-4">
            <Link
              href={metadata.homepage}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white/52 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white/80"
            >
              Site oficial →
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
