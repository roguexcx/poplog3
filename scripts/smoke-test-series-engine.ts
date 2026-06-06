import assert from "node:assert/strict";

import { mergeEpisodeSources } from "@/server/source-engine/merge/episode-merge";
import type { CatalogEpisode } from "@/server/source-engine/types/catalog.types";

function ep(input: {
  source: "tvdb" | "trakt" | "balloonerismm";
  season: number;
  number: number;
  title?: string;
  airDate?: string;
  imdbId?: string;
  tvdbId?: number;
  traktId?: number;
  tmdbId?: number;
  stillPath?: string;
}): CatalogEpisode {
  return {
    ids: {
      imdbId: input.imdbId,
      tvdbId: input.tvdbId,
      traktId: input.traktId,
      tmdbId: input.tmdbId,
    },
    season: input.season,
    number: input.number,
    title: input.title,
    firstAired: input.airDate,
    stillPath: input.stillPath,
    source: {
      primary: input.source,
      confidence: "high",
      usedFallback: false,
    },
  };
}

function run() {
  // Série com TheTVDB completo + Trakt com datas melhores.
  const mergedComplete = mergeEpisodeSources(
    [
      ep({ source: "tvdb", season: 1, number: 1, title: "Piloto", tvdbId: 10, stillPath: "tvdb.jpg" }),
      ep({ source: "tvdb", season: 1, number: 2, title: "Segundo", tvdbId: 11 }),
    ],
    [
      ep({ source: "trakt", season: 1, number: 1, title: "Pilot", tvdbId: 10, traktId: 20, airDate: "2026-01-01T02:00:00.000Z" }),
      ep({ source: "trakt", season: 1, number: 2, title: "Second", tvdbId: 11, traktId: 21, airDate: "2026-01-08T02:00:00.000Z" }),
    ],
  );
  assert.equal(mergedComplete.length, 2);
  assert.equal(mergedComplete[0].title, "Piloto");
  assert.equal(mergedComplete[0].firstAired, "2026-01-01T02:00:00.000Z");
  assert.equal(mergedComplete[0].stillPath, "tvdb.jpg");
  assert.deepEqual(mergedComplete[0].mergedFrom.sort(), ["trakt", "tvdb"]);

  // Trakt parcial: TVDB cobre gaps, Trakt não apaga estrutura.
  const mergedPartial = mergeEpisodeSources(
    [
      ep({ source: "tvdb", season: 1, number: 1, title: "A", tvdbId: 100 }),
      ep({ source: "tvdb", season: 1, number: 2, title: "B", tvdbId: 101 }),
      ep({ source: "tvdb", season: 1, number: 3, title: "C", tvdbId: 102 }),
    ],
    [ep({ source: "trakt", season: 1, number: 2, title: "B", tvdbId: 101, traktId: 201 })],
  );
  assert.equal(mergedPartial.length, 3);
  assert.equal(mergedPartial[1].ids.traktId, 201);

  // IMDb/Balloonerismm forte: dados entram quando outras fontes estão vazias.
  const mergedBalloon = mergeEpisodeSources(
    [],
    [],
    [
      ep({ source: "balloonerismm", season: 1, number: 1, title: "IMDb only", imdbId: "tt1000001" }),
    ],
  );
  assert.equal(mergedBalloon.length, 1);
  assert.equal(mergedBalloon[0].ids.imdbId, "tt1000001");

  // Série nova/em exibição: episódios futuros permanecem indexados com data.
  const mergedAiring = mergeEpisodeSources(
    [ep({ source: "tvdb", season: 1, number: 5, title: "Finale", tvdbId: 500 })],
    [ep({ source: "trakt", season: 1, number: 5, title: "Finale", tvdbId: 500, airDate: "2027-12-01T00:00:00.000Z" })],
  );
  assert.equal(mergedAiring[0].firstAired, "2027-12-01T00:00:00.000Z");

  // Série antiga/finalizada e sem tradução PT-BR: título inglês não é descartado.
  const mergedNoPt = mergeEpisodeSources(
    [ep({ source: "tvdb", season: 2, number: 1, title: "Original English", tvdbId: 600 })],
  );
  assert.equal(mergedNoPt[0].title, "Original English");

  // Temporadas especiais: season 0 é preservada.
  const mergedSpecials = mergeEpisodeSources(
    [ep({ source: "tvdb", season: 0, number: 1, title: "Special", tvdbId: 700 })],
  );
  assert.equal(mergedSpecials.length, 1);
  assert.equal(mergedSpecials[0].season, 0);

  // Fonte vazia não sobrescreve fonte válida.
  const mergedEmptySource = mergeEpisodeSources(
    [],
    [ep({ source: "trakt", season: 1, number: 1, title: "Valid", traktId: 800 })],
  );
  assert.equal(mergedEmptySource.length, 1);
  assert.equal(mergedEmptySource[0].title, "Valid");

  // Dedup por ID externo mesmo quando a numeração diverge.
  const mergedById = mergeEpisodeSources(
    [ep({ source: "tvdb", season: 1, number: 1, title: "Canonical", tvdbId: 900 })],
    [ep({ source: "trakt", season: 1, number: 99, title: "Canonical", tvdbId: 900, traktId: 901 })],
  );
  assert.equal(mergedById.length, 1);
  assert.equal(mergedById[0].number, 1);
  assert.equal(mergedById[0].ids.traktId, 901);

  console.log("[smoke-test-series-engine] OK");
}

run();
