import { NextRequest, NextResponse } from "next/server";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import {
  findCachedFuzzyTitles,
  normalizeSearchTerm,
  shouldUseFuzzyFallback,
} from "@/server/search/fuzzy-title-search";
import {
  catalogSearch,
  catalogSearchCompanies,
  isBalloonerismSearchEnabled,
  type CompanySearchResult,
} from "@/server/source-engine/engine";
import {
  hydrateCatalogResultsWithDebug,
  resolveCatalogIdentityFields,
  type HydratedPoplogTitle,
} from "@/server/source-engine/hydrate-catalog-results";
import { searchEntities } from "@/server/poplog-search/searchEntities";
import { attachBestProvider } from "@/server/availability/attach-best-provider";
import {
  entityToLegacyTitle,
  entityToLegacyPerson,
  type LegacySearchPerson,
} from "@/server/poplog-search/legacy-search-adapter";
import type { PoplogSearchEntitiesResult } from "@/server/poplog-search/types";
import { resolveLocaleScope } from "@/server/source-engine/locale";

type SearchMediaType = "all" | "movie" | "tv";
const TMDB_MAX_SEARCH_PAGE = 500;

/**
 * P7: anexa disponibilidade (best_provider_*) aos resultados de busca via fluxo canônico.
 * cacheOnly (busca é alta frequência → não disparar fetch ao vivo por tecla): reaproveita
 * o cache global e aquece em background os títulos frios. Nunca bloqueia a resposta.
 */
async function withSearchAvailability<
  T extends { tmdb_id: number; media_type: string },
>(titles: T[], locale: { region: string; language: string }) {
  return attachBestProvider(titles, {
    block: "search",
    getMediaType: (t) => (t.media_type === "tv" ? "tv" : "movie"),
    getTmdbId: (t) => t.tmdb_id,
    getImdbId: (t) =>
      (t as { externalIds?: { imdbId?: string } }).externalIds?.imdbId ??
      (t as { imdb_id?: string }).imdb_id ??
      null,
    region: locale.region,
    language: locale.language,
  });
}

function parseMediaType(value: string | null): SearchMediaType {
  if (value === "movie" || value === "tv") return value;
  return "all";
}

function parsePage(value: string | null): number {
  const page = Number(value);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), TMDB_MAX_SEARCH_PAGE);
}

function parseGenre(value: string | null): number | undefined {
  if (!value) return undefined;
  const genre = Number(value);
  if (!Number.isFinite(genre)) return undefined;
  return Math.floor(genre);
}

function toCatalogMediaType(type: SearchMediaType): "movie" | "show" | undefined {
  if (type === "movie") return "movie";
  if (type === "tv") return "show";
  return undefined;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatCompanies(companies: CompanySearchResult[]) {
  return companies
    .filter((c) => Boolean(c.name))
    .map((c) => ({
      id: c.id ?? c.name,
      name: c.name,
      logo_path: c.logoPath ?? null,
      origin_country: c.originCountry ?? null,
      description: c.description ?? null,
    }));
}

/** Pessoas vêm sempre do resolver unificado (cache local + roteamento por id). */
function peopleFromEntities(result: PoplogSearchEntitiesResult | null): LegacySearchPerson[] {
  return (result?.grouped.people ?? [])
    .map(entityToLegacyPerson)
    .filter((p): p is LegacySearchPerson => p !== null);
}

/**
 * Second-pass deduplication of hydrated results by imdbId.
 * The adapter already deduplicates raw items, but the hydration step may resolve
 * two different raw items to different canonical rows for the same underlying title.
 */
function deduplicateTitles(titles: HydratedPoplogTitle[]): HydratedPoplogTitle[] {
  const seenImdb = new Set<string>();
  const seenPoplog = new Set<string>();
  const out: HydratedPoplogTitle[] = [];

  for (const t of titles) {
    const imdbKey = t.imdb_id ?? t.externalIds?.imdbId;
    const poplogKey = t.poplogId != null ? String(t.poplogId) : null;

    if (imdbKey && seenImdb.has(imdbKey)) continue;
    if (poplogKey && seenPoplog.has(poplogKey)) continue;

    if (imdbKey) seenImdb.add(imdbKey);
    if (poplogKey) seenPoplog.add(poplogKey);
    out.push(t);
  }
  return out;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function richSearchHandler(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = (searchParams.get("q") ?? searchParams.get("query"))?.trim();
  const mediaType = parseMediaType(searchParams.get("type"));
  const page = parsePage(searchParams.get("page"));
  const genre = parseGenre(searchParams.get("genre"));
  const forceRefresh = searchParams.get("refresh") === "1";
  const debugSource = searchParams.get("debugSource") === "1";
  const localeScope = resolveLocaleScope({
    language:
      searchParams.get("language") ??
      searchParams.get("locale") ??
      request.cookies.get("poplog_catalog_language")?.value,
    region: searchParams.get("region") ?? request.cookies.get("poplog_region")?.value,
  });

  if (!query) {
    return NextResponse.json(
      { ok: false, error: "Missing search query. Use ?q=" },
      { status: 400 }
    );
  }

  // ── Resolver unificado: pessoas (todas as queries) + roteamento por id ─────────
  let entitiesResult: PoplogSearchEntitiesResult | null = null;
  try {
    entitiesResult = await searchEntities({
      query,
      language: localeScope.catalogLanguage,
      region: localeScope.region,
      forceRefresh,
    });
  } catch (err) {
    console.warn(
      "[poplog3/search] searchEntities failed:",
      err instanceof Error ? err.message : err
    );
  }

  const people = peopleFromEntities(entitiesResult);
  const meta = entitiesResult?.meta ?? null;
  const queryType = entitiesResult?.queryType ?? "text";

  try {
    // ── Query por ID (tt/nm/tmdb:/trakt:/slug:) → títulos do resolver ────────────
    if (entitiesResult && queryType !== "text") {
      const idTitles = [...entitiesResult.grouped.movies, ...entitiesResult.grouped.tv]
        .filter((e) => mediaType === "all" || e.type === mediaType)
        .map(entityToLegacyTitle);

      const idTitlesWithAvail = await withSearchAvailability(idTitles, {
        language: localeScope.catalogLanguage,
        region: localeScope.region,
      });

      return NextResponse.json({
        ok: true,
        query,
        normalizedQuery: entitiesResult.queryNormalized,
        type: mediaType,
        genre,
        page: 1,
        totalPages: 1,
        totalResults: idTitles.length + people.length,
        count: idTitles.length,
        fuzzyCount: 0,
        peopleCount: people.length,
        companiesCount: 0,
        titles: idTitlesWithAvail,
        people,
        companies: [],
        results: idTitlesWithAvail,
        meta,
        queryType,
      });
    }

    // ── Busca textual: pipeline de hidratação (títulos ricos) ────────────────────
    if (isBalloonerismSearchEnabled() && page === 1) {
      try {
        // Títulos + empresas em paralelo; pessoas já vieram do resolver unificado.
        const [catalogResults, companyResults] = await Promise.all([
          catalogSearch({
            query,
            mediaType: toCatalogMediaType(mediaType),
            page: 1,
            language: localeScope.catalogLanguage,
            region: localeScope.region,
          }).catch(() => []),
          catalogSearchCompanies(query).catch(() => [] as CompanySearchResult[]),
        ]);

        const hydratedResult = await hydrateCatalogResultsWithDebug(catalogResults);
        const hydrated = hydratedResult.titles;

        // Apply genre filter (from local DB genres if present)
        const filtered = genre
          ? hydrated.filter((t) => (t.genres ?? []).includes(genre))
          : hydrated;

        const validTitles = filterValidTitles(filtered);

        // Second-pass dedup (adapter deduped raw, hydration may have re-introduced dupes)
        const dedupedTitles = deduplicateTitles(validTitles);

        // Fuzzy supplement for thin results
        const seenKeys = new Set(dedupedTitles.map((t) => `${t.media_type}-${t.tmdb_id}`));
        const fuzzyTitles = shouldUseFuzzyFallback(dedupedTitles.length, page) && !genre
          ? await findCachedFuzzyTitles({
              query,
              mediaType,
              excludeKeys: seenKeys,
              language: localeScope.catalogLanguage,
            }).catch(() => [])
          : [];

        const titleResults = [
          ...dedupedTitles,
          ...fuzzyTitles.map((title) => ({
            ...title,
            ...resolveCatalogIdentityFields(
              { ...title, externalIds: { tmdbId: title.tmdb_id } },
              "cache-fuzzy"
            ),
          })),
        ];

        const companies = formatCompanies(companyResults);

        const hasResults = titleResults.length > 0 || people.length > 0 || companies.length > 0;

        if (hasResults) {
          console.log(
            `[poplog3/search] source=balloonerismm titles=${titleResults.length} people=${people.length} companies=${companies.length} fuzzy=${fuzzyTitles.length}`
          );

          const titleResultsWithAvail = await withSearchAvailability(titleResults, {
            language: localeScope.catalogLanguage,
            region: localeScope.region,
          });

          return NextResponse.json({
            ok: true,
            query,
            normalizedQuery: normalizeSearchTerm(query),
            type: mediaType,
            genre,
            page: 1,
            totalPages: 1,
            totalResults: titleResults.length + people.length + companies.length,
            count: titleResults.length,
            fuzzyCount: fuzzyTitles.length,
            peopleCount: people.length,
            companiesCount: companies.length,
            // Structured entities (new)
            titles: titleResultsWithAvail,
            people,
            companies,
            // Legacy compat alias
            results: titleResultsWithAvail,
            meta,
            queryType,
            ...(debugSource ? { debugSource: hydratedResult.debug } : {}),
          });
        }

        console.log("[poplog3/search] source=balloonerismm_fallback reason=empty");
      } catch (err) {
        console.warn(
          "[poplog3/search] source=balloonerismm_fallback reason=error",
          err instanceof Error ? err.message : err
        );
      }
    }

    // ── Local fuzzy fallback ───────────────────────────────────────────────────
    const fuzzyTitles = await findCachedFuzzyTitles({
      query,
      mediaType,
      genre,
      language: localeScope.catalogLanguage,
    }).catch(() => []);
    const results = fuzzyTitles.map((title) => ({
      ...title,
      ...resolveCatalogIdentityFields(
        { ...title, externalIds: { tmdbId: title.tmdb_id } },
        "legacy"
      ),
    }));

    const resultsWithAvail = await withSearchAvailability(results, {
      language: localeScope.catalogLanguage,
      region: localeScope.region,
    });

    return NextResponse.json({
      ok: true,
      query,
      normalizedQuery: normalizeSearchTerm(query),
      type: mediaType,
      genre,
      page,
      totalPages: 1,
      totalResults: results.length + people.length,
      count: results.length,
      fuzzyCount: fuzzyTitles.length,
      peopleCount: people.length,
      companiesCount: 0,
      titles: resultsWithAvail,
      people,
      companies: [],
      results: resultsWithAvail,
      meta,
      queryType,
    });
  } catch (error) {
    // Falha inesperada: resposta segura (200, arrays vazios) — não derruba a UI.
    console.error("[poplog3/search]", error);
    return NextResponse.json({
      ok: true,
      query,
      normalizedQuery: normalizeSearchTerm(query),
      type: mediaType,
      genre,
      page,
      totalPages: 1,
      totalResults: people.length,
      count: 0,
      fuzzyCount: 0,
      peopleCount: people.length,
      companiesCount: 0,
      titles: [],
      people,
      companies: [],
      results: [],
      meta,
      queryType,
    });
  }
}
