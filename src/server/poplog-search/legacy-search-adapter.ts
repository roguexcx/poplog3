/**
 * Adapter do formato unificado (PoplogSearchEntity) para o contrato legado
 * consumido pela UI de busca (SearchPageView): SearchTitle / SearchPerson.
 *
 * Mantido enquanto a UI não migrar para PoplogSearchEntitiesResult.
 * Os links já vêm dos helpers canônicos (buildTitleHref / buildPersonHref)
 * dentro das entidades; aqui só remapeamos os nomes de campos.
 */

import type { PoplogSearchEntity } from "./types";

export type LegacySearchTitle = {
  tmdb_id: number;
  poplogId: string | number | null;
  externalIds: {
    tmdbId?: number;
    imdbId?: string;
    traktId?: number | string;
    slug?: string;
  };
  media_type: "movie" | "tv";
  title: string;
  original_title: string | null;
  release_date: string | null;
  first_air_date: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number | null;
  overview: string | null;
};

export type LegacySearchPerson = {
  id: string;
  imdb_id: string | null;
  name: string;
  profile_path: string | null;
  known_for_department: string | null;
  known_for: Array<{ title: string; media_type?: string; year?: number | null; poster_path?: string | null }>;
  href: string;
};

/** Departamento (Trakt/Balloonerismm vêm em inglês) → pt-BR para os cards. */
const DEPARTMENT_LABELS_PT: Record<string, string> = {
  acting: "Atuação",
  directing: "Direção",
  writing: "Roteiro",
  production: "Produção",
  crew: "Equipe técnica",
  creator: "Criação",
  sound: "Som",
  camera: "Fotografia",
  editing: "Edição",
  art: "Arte",
  "costume & make-up": "Figurino e maquiagem",
  "visual effects": "Efeitos visuais",
};

function translateDepartment(department: string | null | undefined): string | null {
  if (!department) return null;
  return DEPARTMENT_LABELS_PT[department.trim().toLowerCase()] ?? department;
}

function compactExternalIds(ext: PoplogSearchEntity["externalIds"]): LegacySearchTitle["externalIds"] {
  const out: LegacySearchTitle["externalIds"] = {};
  if (ext?.tmdbId != null) out.tmdbId = ext.tmdbId;
  if (ext?.imdbId) out.imdbId = ext.imdbId;
  if (ext?.traktId != null) out.traktId = ext.traktId;
  if (ext?.traktSlug) out.slug = ext.traktSlug;
  return out;
}

export function entityToLegacyTitle(entity: PoplogSearchEntity): LegacySearchTitle {
  const mediaType = entity.type === "tv" ? "tv" : "movie";
  // year → release/first_air date para a UI calcular o ano (getYear lê essas datas).
  const dateStr = entity.year != null ? `${entity.year}-01-01` : null;
  return {
    tmdb_id: entity.externalIds?.tmdbId ?? 0,
    poplogId: null,
    externalIds: compactExternalIds(entity.externalIds),
    media_type: mediaType,
    title: entity.title ?? entity.name ?? "",
    original_title: entity.originalTitle ?? null,
    release_date: mediaType === "movie" ? dateStr : null,
    first_air_date: mediaType === "tv" ? dateStr : null,
    poster_path: entity.posterUrl ?? null,
    backdrop_path: null,
    vote_average: null,
    overview: entity.overview ?? null,
  };
}

export function entityToLegacyPerson(entity: PoplogSearchEntity): LegacySearchPerson | null {
  // href sempre presente nas entidades de pessoa (buildPersonHref garante),
  // mas o contrato legado exige string — descarta defensivamente se faltar.
  if (!entity.href) return null;
  const knownFor = (entity.knownFor ?? [])
    .map((kf) => ({
      title: kf.title ?? kf.name ?? "",
      media_type: kf.mediaType ?? undefined,
      year: kf.year ?? null,
      poster_path: kf.posterUrl ?? null,
    }))
    .filter((kf) => Boolean(kf.title));
  return {
    id: entity.id,
    imdb_id: entity.externalIds?.imdbId ?? null,
    name: entity.name ?? entity.title ?? "",
    profile_path: entity.profileImage ?? null,
    known_for_department: translateDepartment(entity.knownForDepartment),
    known_for: knownFor,
    href: entity.href,
  };
}
