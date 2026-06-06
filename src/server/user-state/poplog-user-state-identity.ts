import {
  resolvePoplogTitleIdentity,
  type PoplogTitleExternalIds,
} from "@/server/titles/poplog-title-identity";
import { syntheticTmdbFromImdbId, isSyntheticTmdbId } from "@/lib/ids/synthetic-tmdb-id";
import type { MediaType, RatingMediaType } from "@/types/user";

export type UserStateIdentityInput = {
  mediaType: MediaType | RatingMediaType;
  poplogId?: unknown;
  tmdbId?: unknown;
  imdbId?: unknown;
  slug?: unknown;
  title?: unknown;
  year?: unknown;
};

export type UserStateIdentityResolution = {
  mediaType: MediaType;
  inputId: string | number | null;
  inputIdType:
    | "poplog_id"
    | "tmdb_id"
    | "imdb_id"
    | "slug"
    | "unknown";
  resolvedPoplogId: string | number | null;
  tmdbId: number | null;
  externalIds: PoplogTitleExternalIds;
  legacyUserStateMatched: boolean;
  userStateSource: "poplog_identity_resolver";
  usedTmdbApi: false;
  migrationNeeded: boolean;
  duplicatePrevented: boolean;
  fallbackReason: string | null;
};

function toCatalogMediaType(mediaType: MediaType | RatingMediaType): MediaType | null {
  if (mediaType === "movie" || mediaType === "tv") return mediaType;
  if (mediaType === "season" || mediaType === "episode") return "tv";
  return null;
}

function positiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Accepts both positive real tmdbIds and negative synthetic ones from imdbId. */
function anyTmdbId(value: unknown): number | null {
  const parsed =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : NaN;
  return Number.isInteger(parsed) && parsed !== 0 ? parsed : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function isLikelyTemporaryCatalogId(value: number | null): boolean {
  return value !== null && value >= 1_800_000_000 && value < 1_900_000_000;
}

function yearValue(value: unknown): number | undefined {
  const parsed = positiveInteger(value);
  return parsed && parsed >= 1800 && parsed <= 2200 ? parsed : undefined;
}

export async function resolveUserStateIdentity(
  input: UserStateIdentityInput,
): Promise<UserStateIdentityResolution | null> {
  const mediaType = toCatalogMediaType(input.mediaType);
  if (!mediaType) return null;

  const explicitPoplogId =
    typeof input.poplogId === "number"
      ? String(input.poplogId)
      : stringValue(input.poplogId);
  const tmdbId = anyTmdbId(input.tmdbId); // accepts negative synthetic IDs
  const imdbId = stringValue(input.imdbId);
  const slug = stringValue(input.slug);
  const title = stringValue(input.title) ?? undefined;
  const year = yearValue(input.year);

  // Positive tmdbId or imdbId for the identity resolution lookup
  const positiveTmdbId = tmdbId && tmdbId > 0 ? tmdbId : null;

  const shouldPreferImdb = Boolean(imdbId && (!positiveTmdbId || isLikelyTemporaryCatalogId(positiveTmdbId)));
  const inputId =
    explicitPoplogId ??
    (shouldPreferImdb ? imdbId : null) ??
    positiveTmdbId ??
    imdbId ??
    slug ??
    null;

  const inputIdType: UserStateIdentityResolution["inputIdType"] =
    explicitPoplogId
      ? "poplog_id"
      : shouldPreferImdb
          ? "imdb_id"
          : positiveTmdbId
            ? "tmdb_id"
            : imdbId
              ? "imdb_id"
              : slug
                ? "slug"
                : "unknown";

  if (inputId === null) return null;

  const sourceHint =
    inputIdType === "poplog_id"
      ? "poplog"
      : inputIdType === "tmdb_id"
        ? "tmdb"
        : inputIdType === "imdb_id"
          ? "imdb"
          : inputIdType === "slug"
            ? "slug"
            : "auto";

  const identity = await resolvePoplogTitleIdentity({
    mediaType,
    id: String(inputId),
    sourceHint,
    title,
    year,
  });

  // Prefer resolved tmdbId from DB; fall back to input synthetic; last resort: synthesise from imdbId
  const resolvedImdbId = identity.externalIds.imdbId ?? imdbId ?? null;
  const resolvedTmdbId =
    identity.externalIds.tmdbId ??
    (tmdbId && isSyntheticTmdbId(tmdbId) ? tmdbId : null) ??
    (tmdbId && !isLikelyTemporaryCatalogId(tmdbId) ? tmdbId : null) ??
    (resolvedImdbId ? syntheticTmdbFromImdbId(resolvedImdbId) : null) ??
    null;

  const resolvedPoplogId = identity.poplogId ?? explicitPoplogId ?? null;
  const isSynthetic = Boolean(resolvedTmdbId && isSyntheticTmdbId(resolvedTmdbId));

  return {
    mediaType,
    inputId,
    inputIdType,
    resolvedPoplogId,
    tmdbId: resolvedTmdbId,
    externalIds: {
      ...identity.externalIds,
      ...(resolvedImdbId ? { imdbId: resolvedImdbId } : {}),
    },
    legacyUserStateMatched: Boolean(resolvedTmdbId && !isSynthetic),
    userStateSource: "poplog_identity_resolver",
    usedTmdbApi: false,
    migrationNeeded: Boolean(resolvedTmdbId && resolvedPoplogId && !isSynthetic),
    duplicatePrevented: Boolean(
      resolvedTmdbId &&
        !isSynthetic &&
        resolvedPoplogId &&
        (inputIdType === "poplog_id" || inputIdType === "imdb_id" || inputIdType === "slug"),
    ),
    fallbackReason: resolvedTmdbId
      ? (isSynthetic ? "synthetic_tmdb_from_imdb_id" : null)
      : "missing_tmdb_alias_for_legacy_user_state_schema",
  };
}

export function userStateIdentityDebug(resolution: UserStateIdentityResolution | null) {
  return {
    identityUsed: resolution?.resolvedPoplogId ? "poplog_id" : "tmdb_id_alias",
    inputId: resolution?.inputId ?? null,
    inputIdType: resolution?.inputIdType ?? "unknown",
    resolvedPoplogId: resolution?.resolvedPoplogId ?? null,
    externalIds: resolution?.externalIds ?? {},
    legacyUserStateMatched: resolution?.legacyUserStateMatched ?? false,
    userStateSource: resolution?.userStateSource ?? "poplog_identity_resolver",
    usedTmdbApi: false,
    migrationNeeded: resolution?.migrationNeeded ?? false,
    duplicatePrevented: resolution?.duplicatePrevented ?? false,
    fallbackReason: resolution?.fallbackReason ?? null,
  };
}
