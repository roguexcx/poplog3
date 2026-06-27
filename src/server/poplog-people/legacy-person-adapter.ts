/**
 * Adapter camelCase → snake_case para o contrato legado de
 * /api/people/[id] (campos person/acting/crew em snake_case).
 * O PersonPageClient já consome PoplogPersonPageData direto; remover este
 * adapter quando os consumidores da API migrarem para o campo `credits`.
 */

import type {
  PoplogPersonCredit,
  PoplogPersonPageData,
} from "@/server/poplog-people/getPersonPageData";

export type LegacyCreditItem = {
  imdb_id?: string;
  title: string;
  media_type: "movie" | "tv";
  year?: number | null;
  character?: string;
  job?: string;
  department?: string;
  poster_path?: string | null;
};

export type LegacyPersonData = {
  imdb_id: string;
  name: string;
  biography?: string | null;
  birthday?: string | null;
  deathday?: string | null;
  place_of_birth?: string | null;
  profile_path?: string | null;
  known_for_department?: string | null;
};

export function toLegacyCredit(credit: PoplogPersonCredit): LegacyCreditItem {
  return {
    imdb_id: credit.externalIds?.imdbId ?? undefined,
    title: credit.title,
    media_type: credit.mediaType,
    year: credit.year ?? null,
    character: credit.character ?? undefined,
    job: credit.job ?? undefined,
    department: credit.department ?? undefined,
    poster_path: credit.posterUrl ?? null,
  };
}

export function toLegacyPerson(
  person: NonNullable<PoplogPersonPageData["person"]>
): LegacyPersonData {
  return {
    imdb_id: person.externalIds?.imdbId ?? person.id,
    name: person.name,
    biography: person.biography ?? null,
    birthday: person.birthday ?? null,
    deathday: person.deathday ?? null,
    place_of_birth: person.placeOfBirth ?? null,
    profile_path: person.profileImage ?? null,
    known_for_department: person.knownForDepartment ?? null,
  };
}
