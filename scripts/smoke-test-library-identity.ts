import assert from "node:assert/strict";

import {
  titleIdentityKeys,
  userTitleIdentityKeys,
} from "@/lib/user-title-identity";
import type { UserTitle } from "@/types/user";

const synthetic = titleIdentityKeys({ mediaType: "tv", tmdbId: -9419884 });
assert(synthetic.includes("tv:tmdb:-9419884"));
assert(synthetic.includes("g:imdb:tt9419884"));

const aliases = titleIdentityKeys({
  mediaType: "movie",
  tmdbId: 550,
  poplogId: "POPLOG-CUID",
  imdbId: "TT0137523",
  traktId: 727,
  slug: "Fight-Club",
});
assert.deepEqual(new Set(aliases), new Set([
  "g:poplog:poplog-cuid",
  "g:imdb:tt0137523",
  "g:trakt:727",
  "g:slug:fight-club",
  "movie:tmdb:550",
]));
assert(!aliases.includes("tv:tmdb:550"), "movie and TV ID spaces must stay isolated");

const saved = {
  id: "state-1",
  user_id: "user-1",
  tmdb_id: 550,
  media_type: "movie",
  poplogId: "POPLOG-CUID",
  externalIds: {
    tmdbId: 550,
    imdbId: "TT0137523",
    traktId: "727",
    slug: "Fight-Club",
  },
  status: "fridge",
  favorite: false,
  created_at: new Date(0).toISOString(),
  watched_at: null,
  title: "Clube da Luta",
  release_year: 1999,
} satisfies UserTitle;

const savedKeys = new Set(userTitleIdentityKeys(saved));
for (const candidate of [
  { mediaType: "movie" as const, imdbId: "tt0137523" },
  { mediaType: "movie" as const, traktId: 727 },
  { mediaType: "movie" as const, slug: "fight-club" },
  { mediaType: "movie" as const, poplogId: "POPLOG-CUID" },
  { mediaType: "movie" as const, tmdbId: 550 },
]) {
  assert(
    titleIdentityKeys(candidate).some((key) => savedKeys.has(key)),
    `saved title must match candidate alias: ${JSON.stringify(candidate)}`,
  );
}

console.log("[smoke:library-identity] canonical alias coverage ok");
