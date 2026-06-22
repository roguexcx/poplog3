import {
  POPLOG3_LIBRARY_STATUSES,
  type Poplog3LibraryStatus,
} from "./types";

export function isValidMediaType(value: unknown): value is "movie" | "tv" {
  return value === "movie" || value === "tv";
}

export function isValidLibraryStatus(
  value: unknown
): value is Poplog3LibraryStatus {
  return (
    typeof value === "string" &&
    POPLOG3_LIBRARY_STATUSES.includes(value as Poplog3LibraryStatus)
  );
}

export function parsePositiveInteger(value: unknown): number | null {
  const numberValue =
    typeof value === "string" ? Number(value) : value;

  if (
    typeof numberValue !== "number" ||
    !Number.isInteger(numberValue) ||
    numberValue <= 0
  ) {
    return null;
  }

  return numberValue;
}