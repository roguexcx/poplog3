/**
 * Camada única de dados da página de pessoa/artista.
 *
 * Fluxo: cache persistente local (Prisma) → fontes externas → normalização → cache.
 *   - fresh (pessoa E créditos)          → retorna cache direto
 *   - missing/stale/expired ou refresh   → busca fontes, salva, retorna atualizado
 *   - fontes falharam + cache antigo     → retorna cache antigo (usedStaleFallback)
 *   - fontes falharam + sem cache        → person null + arrays vazios, sem lançar
 *
 * Fontes:
 *   - Balloonerismm: fonte funcional atual (/person/{id} + combined_credits).
 *   - Trakt: fonte principal planejada. Não existe helper de pessoa no projeto
 *     (apenas traktGet genérico) e o id canônico atual é IMDb "nm...", que o
 *     Trakt só resolve via /search/imdb/{id}?type=person. A integração entra em
 *     etapa futura via fetchPersonFromTrakt() abaixo — TODO controlado.
 */

import type { Prisma } from "@prisma/client";
import { balloonerismGet } from "@/server/api-clients/balloonerismm/client";
import { traktGet } from "@/server/api-clients/trakt/client";
import type {
  BalloonerismPersonDetails,
  BalloonerismPersonCombinedCredits,
  BalloonerismPersonCreditItem,
} from "@/server/api-clients/balloonerismm/types";
import {
  type CacheState,
  readPersonCache,
  upsertPersonCache,
  readPersonCreditsCache,
  upsertPersonCreditsCache,
} from "@/server/poplog-cache/entity-cache";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type PoplogPersonCredit = {
  id: string;
  mediaType: "movie" | "tv";
  title: string;
  originalTitle?: string | null;
  year?: number | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  character?: string | null;
  job?: string | null;
  department?: string | null;
  episodeCount?: number | null;
  releaseDate?: string | null;
  firstAirDate?: string | null;
  externalIds?: {
    imdbId?: string | null;
    tmdbId?: number | null;
    traktId?: number | string | null;
    traktSlug?: string | null;
  };
};

export type PoplogPersonPageData = {
  person: {
    id: string;
    name: string;
    originalName?: string | null;
    biography?: string | null;
    profileImage?: string | null;
    knownForDepartment?: string | null;
    birthday?: string | null;
    deathday?: string | null;
    placeOfBirth?: string | null;
    externalIds?: {
      imdbId?: string | null;
      tmdbId?: number | null;
      traktId?: number | string | null;
      traktSlug?: string | null;
    };
  } | null;
  acting: PoplogPersonCredit[];
  directing: PoplogPersonCredit[];
  writing: PoplogPersonCredit[];
  producing: PoplogPersonCredit[];
  otherCrew: PoplogPersonCredit[];
  meta: {
    cache: {
      person: CacheState;
      credits: CacheState;
      usedStaleFallback?: boolean;
    };
    sources: {
      trakt?: boolean;
      balloonerismm?: boolean;
    };
  };
};

type PersonProfile = NonNullable<PoplogPersonPageData["person"]>;

type CreditBuckets = {
  acting: PoplogPersonCredit[];
  directing: PoplogPersonCredit[];
  writing: PoplogPersonCredit[];
  producing: PoplogPersonCredit[];
  otherCrew: PoplogPersonCredit[];
};

const EMPTY_BUCKETS: CreditBuckets = {
  acting: [],
  directing: [],
  writing: [],
  producing: [],
  otherCrew: [],
};

// ─── Normalização Balloonerismm ──────────────────────────────────────────────

function normalizePersonProfile(
  id: string,
  raw: BalloonerismPersonDetails
): PersonProfile {
  return {
    id,
    name: raw.name,
    originalName: null,
    biography: raw.biography ?? null,
    profileImage: raw.profile_path ?? null,
    knownForDepartment: raw.known_for_department ?? null,
    birthday: raw.birthday ?? null,
    deathday: raw.deathday ?? null,
    placeOfBirth: raw.place_of_birth ?? null,
    externalIds: {
      imdbId: raw.imdb_id ?? (id.startsWith("nm") ? id : null),
      tmdbId: null,
      traktId: null,
      traktSlug: null,
    },
  };
}

type RawCredit = BalloonerismPersonCreditItem & {
  // Formato real do /person/{id}/combined_credits (estilo TMDB):
  // `id` é o IMDb id ("tt..."), poster/backdrop são URLs absolutas e o ano
  // vem só em release_date/first_air_date. Os campos do tipo declarado
  // (imdb_id, images, year) ficam como fallback caso a API evolua.
  id?: string | number | null;
  original_title?: string | null;
  original_name?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  tmdb_id?: number | null;
  trakt_id?: number | null;
  episode_count?: number | null;
  release_date?: string | null;
  first_air_date?: string | null;
};

function yearFromDate(date: string | null | undefined): number | null {
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) && year > 1800 ? year : null;
}

function normalizeCredit(item: RawCredit): PoplogPersonCredit | null {
  const title = item.title ?? item.name;
  if (!title) return null;
  const rawId = typeof item.id === "string" ? item.id : null;
  const imdbId = item.imdb_id ?? (rawId && /^tt\d+$/.test(rawId) ? rawId : null);
  const tmdbId = item.tmdb_id ?? (typeof item.id === "number" ? item.id : null);
  const mediaType =
    item.media_type === "tv" || (!item.media_type && item.first_air_date) ? "tv" : "movie";
  const year =
    item.year ?? yearFromDate(item.release_date) ?? yearFromDate(item.first_air_date);
  return {
    id: imdbId ?? (tmdbId != null ? `tmdb:${tmdbId}` : `${mediaType}:${title}:${year ?? ""}`),
    mediaType,
    title,
    originalTitle: item.original_title ?? item.original_name ?? null,
    year,
    posterUrl: item.images?.poster ?? item.poster_path ?? null,
    backdropUrl: item.images?.backdrop ?? item.backdrop_path ?? null,
    character: item.character ?? null,
    job: item.job ?? null,
    department: item.department ?? null,
    episodeCount: item.episode_count ?? null,
    releaseDate: item.release_date ?? null,
    firstAirDate: item.first_air_date ?? null,
    externalIds: {
      imdbId,
      tmdbId,
      traktId: item.trakt_id ?? null,
      traktSlug: null,
    },
  };
}

// ─── Deduplicação ─────────────────────────────────────────────────────────────

function creditDedupKey(credit: PoplogPersonCredit): string {
  const ext = credit.externalIds;
  if (ext?.imdbId) return `imdb:${ext.imdbId}`;
  if (ext?.traktId != null) return `trakt:${ext.traktId}`;
  if (ext?.tmdbId != null) return `tmdb:${ext.tmdbId}`;
  const titleKey = (credit.title || credit.originalTitle || "").toLowerCase();
  return `title:${credit.mediaType}:${titleKey}:${credit.year ?? ""}`;
}

function creditCompleteness(credit: PoplogPersonCredit): number {
  let score = 0;
  if (credit.posterUrl) score += 4;
  if (credit.releaseDate || credit.firstAirDate || credit.year != null) score += 2;
  const ext = credit.externalIds;
  score += [ext?.imdbId, ext?.tmdbId, ext?.traktId, ext?.traktSlug].filter(
    (v) => v != null
  ).length;
  if (credit.title) score += 1;
  if (credit.character || credit.job) score += 1;
  return score;
}

function dedupeCredits(credits: PoplogPersonCredit[]): PoplogPersonCredit[] {
  const byKey = new Map<string, PoplogPersonCredit>();
  for (const credit of credits) {
    const key = creditDedupKey(credit);
    const existing = byKey.get(key);
    if (!existing || creditCompleteness(credit) > creditCompleteness(existing)) {
      byKey.set(key, credit);
    }
  }
  return [...byKey.values()];
}

// ─── Separação de crew em buckets ─────────────────────────────────────────────

function classifyCrew(credit: PoplogPersonCredit): keyof CreditBuckets {
  const dept = (credit.department ?? "").toLowerCase();
  const job = (credit.job ?? "").toLowerCase();
  if (dept === "directing" || job.includes("direct")) return "directing";
  if (dept === "writing" || job.includes("writ") || job.includes("screenplay") || job.includes("story")) {
    return "writing";
  }
  if (dept === "production" || job.includes("produc") || job.includes("executive")) {
    return "producing";
  }
  return "otherCrew";
}

const byYearDesc = (a: PoplogPersonCredit, b: PoplogPersonCredit) =>
  (b.year ?? 0) - (a.year ?? 0);

function buildCreditBuckets(raw: BalloonerismPersonCombinedCredits): CreditBuckets {
  const acting = dedupeCredits(
    (raw.cast ?? [])
      .map((c) => normalizeCredit(c as RawCredit))
      .filter((c): c is PoplogPersonCredit => c !== null)
  ).sort(byYearDesc);

  const crew = dedupeCredits(
    (raw.crew ?? [])
      .map((c) => normalizeCredit(c as RawCredit))
      .filter((c): c is PoplogPersonCredit => c !== null)
  );

  const buckets: CreditBuckets = {
    acting,
    directing: [],
    writing: [],
    producing: [],
    otherCrew: [],
  };
  for (const credit of crew) buckets[classifyCrew(credit)].push(credit);
  buckets.directing.sort(byYearDesc);
  buckets.writing.sort(byYearDesc);
  buckets.producing.sort(byYearDesc);
  buckets.otherCrew.sort(byYearDesc);
  return buckets;
}

// ─── Fontes externas ──────────────────────────────────────────────────────────

type ExternalFetchResult = {
  person: PersonProfile | null;
  buckets: CreditBuckets | null;
  balloonProfileRaw: BalloonerismPersonDetails | null;
  balloonCreditsRaw: BalloonerismPersonCombinedCredits | null;
  traktPersonRaw: unknown | null;
  sources: { trakt: boolean; balloonerismm: boolean };
};

// ─── Trakt (identidade + metadados de pessoa) ─────────────────────────────────

type TraktPersonSearchItem = {
  type?: string;
  person?: {
    name?: string;
    ids?: { trakt?: number; slug?: string; imdb?: string; tmdb?: number };
    biography?: string | null;
    birthday?: string | null;
    death?: string | null;
    birthplace?: string | null;
    known_for_department?: string | null;
  };
};

type TraktPersonResult = {
  name: string | null;
  ids: { trakt: number | null; slug: string | null; imdb: string | null; tmdb: number | null };
  biography: string | null;
  birthday: string | null;
  deathday: string | null;
  placeOfBirth: string | null;
  knownForDepartment: string | null;
  raw: unknown;
};

/**
 * Resolve pessoa no Trakt a partir do IMDb person id (nm...) via
 * /search/imdb/{id}?type=person&extended=full. Trakt é a fonte principal de
 * IDs (trakt/slug/tmdb) e preenche bio/datas quando o Balloonerismm não traz.
 * Retorna null se não for um nm-id ou se o Trakt não responder.
 */
async function fetchPersonFromTrakt(id: string): Promise<TraktPersonResult | null> {
  if (!/^nm\d+$/.test(id)) return null; // só temos lookup seguro por IMDb person id
  const results = await traktGet<TraktPersonSearchItem[]>(`/search/imdb/${id}`, {
    params: { type: "person", extended: "full" },
    ttlSeconds: 86_400,
  });
  if (!results || results.length === 0) return null;
  const match =
    results.find((r) => r.person?.ids?.imdb === id)?.person ?? results[0]?.person;
  if (!match) return null;
  return {
    name: match.name ?? null,
    ids: {
      trakt: match.ids?.trakt ?? null,
      slug: match.ids?.slug ?? null,
      imdb: match.ids?.imdb ?? id,
      tmdb: match.ids?.tmdb ?? null,
    },
    biography: match.biography ?? null,
    birthday: match.birthday ?? null,
    deathday: match.death ?? null,
    placeOfBirth: match.birthplace ?? null,
    knownForDepartment: match.known_for_department ?? null,
    raw: match,
  };
}

/**
 * Mescla os dados do Trakt no perfil base (Balloonerismm). Trakt manda nos IDs
 * (trakt/slug/tmdb); Balloonerismm continua dono de imagem e créditos e tem
 * prioridade em bio/datas pt-BR, com Trakt preenchendo lacunas.
 */
function mergeTraktIntoProfile(base: PersonProfile, trakt: TraktPersonResult): PersonProfile {
  return {
    ...base,
    name: base.name || trakt.name || base.name,
    biography: base.biography ?? trakt.biography,
    birthday: base.birthday ?? trakt.birthday,
    deathday: base.deathday ?? trakt.deathday,
    placeOfBirth: base.placeOfBirth ?? trakt.placeOfBirth,
    knownForDepartment: base.knownForDepartment ?? trakt.knownForDepartment,
    externalIds: {
      imdbId: base.externalIds?.imdbId ?? trakt.ids.imdb,
      tmdbId: trakt.ids.tmdb ?? base.externalIds?.tmdbId ?? null,
      traktId: trakt.ids.trakt ?? base.externalIds?.traktId ?? null,
      traktSlug: trakt.ids.slug ?? base.externalIds?.traktSlug ?? null,
    },
  };
}

function emptyProfile(id: string, name: string | null): PersonProfile {
  return {
    id,
    name: name ?? id,
    originalName: null,
    biography: null,
    profileImage: null,
    knownForDepartment: null,
    birthday: null,
    deathday: null,
    placeOfBirth: null,
    externalIds: {
      imdbId: /^nm\d+$/.test(id) ? id : null,
      tmdbId: null,
      traktId: null,
      traktSlug: null,
    },
  };
}

async function fetchPersonFromBalloonerismm(
  id: string,
  language: string
): Promise<{
  profile: BalloonerismPersonDetails | null;
  credits: BalloonerismPersonCombinedCredits | null;
}> {
  const [profile, credits] = await Promise.all([
    balloonerismGet<BalloonerismPersonDetails>(`/person/${id}`, { ttlSeconds: 86_400 }),
    balloonerismGet<BalloonerismPersonCombinedCredits>(`/person/${id}/combined_credits`, {
      params: { language },
      ttlSeconds: 86_400,
    }),
  ]);
  return { profile, credits };
}

async function fetchFromExternalSources(
  id: string,
  language: string
): Promise<ExternalFetchResult> {
  const sources = { trakt: false, balloonerismm: false };

  // Trakt (identidade/metadados) e Balloonerismm (perfil/créditos) em paralelo;
  // cada um falha de forma isolada e nunca derruba a página.
  const [trakt, balloon] = await Promise.all([
    fetchPersonFromTrakt(id).catch(() => null),
    fetchPersonFromBalloonerismm(id, language),
  ]);

  if (trakt) sources.trakt = true;
  if (balloon.profile) sources.balloonerismm = true;

  let person: PersonProfile | null = null;
  if (balloon.profile) {
    person = normalizePersonProfile(id, balloon.profile);
    if (trakt) person = mergeTraktIntoProfile(person, trakt);
  } else if (trakt) {
    // Balloonerismm fora: monta perfil mínimo a partir do Trakt (sem imagem).
    person = mergeTraktIntoProfile(emptyProfile(id, trakt.name), trakt);
  }

  // Créditos seguem sendo do Balloonerismm (Trakt não é consultado para créditos).
  const buckets = balloon.credits ? buildCreditBuckets(balloon.credits) : null;

  return {
    person,
    buckets,
    balloonProfileRaw: balloon.profile,
    balloonCreditsRaw: balloon.credits,
    traktPersonRaw: trakt?.raw ?? null,
    sources,
  };
}

// ─── Reconstrução a partir do cache ──────────────────────────────────────────

function personFromCachePayload(payload: Prisma.JsonValue): PersonProfile | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const data = payload as Record<string, unknown>;
  if (typeof data.id !== "string" || typeof data.name !== "string") return null;
  return data as unknown as PersonProfile;
}

function bucketsFromCachePayload(payload: Prisma.JsonValue): CreditBuckets {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return EMPTY_BUCKETS;
  const data = payload as Record<string, unknown>;
  const list = (key: keyof CreditBuckets): PoplogPersonCredit[] =>
    Array.isArray(data[key]) ? (data[key] as PoplogPersonCredit[]) : [];
  return {
    acting: list("acting"),
    directing: list("directing"),
    writing: list("writing"),
    producing: list("producing"),
    otherCrew: list("otherCrew"),
  };
}

// ─── Persistência ─────────────────────────────────────────────────────────────

async function persistToCache(input: {
  personId: string;
  person: PersonProfile;
  buckets: CreditBuckets;
  balloonProfileRaw: BalloonerismPersonDetails | null;
  balloonCreditsRaw: BalloonerismPersonCombinedCredits | null;
  traktPersonRaw: unknown | null;
  sources: { trakt: boolean; balloonerismm: boolean };
  language: string;
  region: string;
}): Promise<void> {
  const { person, buckets } = input;
  const traktIdNum =
    typeof person.externalIds?.traktId === "number" ? person.externalIds.traktId : null;

  await Promise.all([
    upsertPersonCache({
      personId: input.personId,
      source: input.sources.trakt ? "trakt" : "balloonerismm",
      traktId: traktIdNum,
      traktSlug: person.externalIds?.traktSlug ?? null,
      tmdbId: person.externalIds?.tmdbId ?? null,
      imdbId: person.externalIds?.imdbId ?? null,
      name: person.name,
      originalName: person.originalName ?? null,
      profileImage: person.profileImage ?? null,
      payload: person as unknown as Prisma.InputJsonValue,
      balloonPayload: input.balloonProfileRaw
        ? (input.balloonProfileRaw as unknown as Prisma.InputJsonValue)
        : undefined,
      traktPayload: input.traktPersonRaw
        ? (input.traktPersonRaw as Prisma.InputJsonValue)
        : undefined,
      language: input.language,
      region: input.region,
    }),
    upsertPersonCreditsCache({
      personId: input.personId,
      acting: buckets.acting as unknown as Prisma.InputJsonValue,
      directing: buckets.directing as unknown as Prisma.InputJsonValue,
      writing: buckets.writing as unknown as Prisma.InputJsonValue,
      producing: buckets.producing as unknown as Prisma.InputJsonValue,
      otherCrew: buckets.otherCrew as unknown as Prisma.InputJsonValue,
      payload: buckets as unknown as Prisma.InputJsonValue,
      sourceCoverage: input.sources as unknown as Prisma.InputJsonValue,
      language: input.language,
      region: input.region,
    }),
  ]);
}

// ─── Função principal ─────────────────────────────────────────────────────────

export async function getPersonPageData(input: {
  id: string;
  language?: string;
  region?: string;
  forceRefresh?: boolean;
}): Promise<PoplogPersonPageData> {
  const language = input.language ?? "pt-BR";
  const region = input.region ?? "BR";
  const personId = input.id;

  const [personCache, creditsCache] = await Promise.all([
    readPersonCache(personId),
    readPersonCreditsCache({ personId, language, region }),
  ]);

  // 1. Cache fresh em ambos → retorna direto
  if (
    !input.forceRefresh &&
    personCache.state === "fresh" &&
    creditsCache.state === "fresh" &&
    personCache.record &&
    creditsCache.record
  ) {
    return {
      person: personFromCachePayload(personCache.record.payload),
      ...bucketsFromCachePayload(creditsCache.record.payload),
      meta: {
        cache: { person: "fresh", credits: "fresh" },
        sources: sourcesFromRecord(personCache.record.source),
      },
    };
  }

  // 2. Revalidação durante o acesso
  let external: ExternalFetchResult | null = null;
  try {
    external = await fetchFromExternalSources(personId, language);
  } catch (err) {
    console.warn(
      `[poplog-people] external fetch failed for "${personId}":`,
      err instanceof Error ? err.message : err
    );
  }

  if (external?.person) {
    const buckets = external.buckets ?? EMPTY_BUCKETS;
    try {
      await persistToCache({
        personId,
        person: external.person,
        buckets,
        balloonProfileRaw: external.balloonProfileRaw,
        balloonCreditsRaw: external.balloonCreditsRaw,
        traktPersonRaw: external.traktPersonRaw,
        sources: external.sources,
        language,
        region,
      });
    } catch (err) {
      console.warn(
        `[poplog-people] cache persist failed for "${personId}":`,
        err instanceof Error ? err.message : err
      );
    }
    return {
      person: external.person,
      ...buckets,
      meta: {
        cache: { person: personCache.state, credits: creditsCache.state },
        sources: external.sources,
      },
    };
  }

  // 3. Fontes falharam → fallback para cache antigo (stale/expired)
  if (personCache.record) {
    const buckets = creditsCache.record
      ? bucketsFromCachePayload(creditsCache.record.payload)
      : EMPTY_BUCKETS;
    return {
      person: personFromCachePayload(personCache.record.payload),
      ...buckets,
      meta: {
        cache: {
          person: personCache.state,
          credits: creditsCache.state,
          usedStaleFallback: true,
        },
        sources: sourcesFromRecord(personCache.record.source),
      },
    };
  }

  // 4. Sem fontes e sem cache → resultado vazio, página decide o que exibir
  return {
    person: null,
    ...EMPTY_BUCKETS,
    meta: {
      cache: { person: personCache.state, credits: creditsCache.state },
      sources: external?.sources ?? {},
    },
  };
}

export async function getPersonPageDataById(id: string): Promise<PoplogPersonPageData> {
  return getPersonPageData({ id });
}

function sourcesFromRecord(source: string): { trakt?: boolean; balloonerismm?: boolean } {
  if (source === "trakt") return { trakt: true };
  if (source === "balloonerismm") return { balloonerismm: true };
  return {};
}
