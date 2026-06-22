import { PoplogTitle } from "@/server/types/title";

export function filterValidTitles(
  titles: Array<PoplogTitle | null | undefined>
) {
  return titles.filter(
    (item): item is PoplogTitle => {
      if (!item) return false;

      if (!item.poster_path) return false;

      if (
        item.media_type !== "movie" &&
        item.media_type !== "tv"
      ) {
        return false;
      }

      return true;
    }
  );
}