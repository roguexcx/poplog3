import { NextRequest, NextResponse } from "next/server";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import {
  findCachedFuzzyTitles,
  normalizeSearchTerm,
  shouldUseFuzzyFallback,
} from "@/server/search/fuzzy-title-search";
import {
  catalogSearch,
  catalogSearchPeople,
  catalogSearchCompanies,
  isBalloonerismSearchEnabled,
  type PersonSearchResult,
  type CompanySearchResult,
} from "@/server/source-engine/engine";
import {
  hydrateCatalogResultsWithDebug,
  resolveCatalogIdentityFields,
  type HydratedPoplogTitle,
} from "@/server/source-engine/hydrate-catalog-results";

type SearchMediaType = "all" | "movie" | "tv";
const TMDB_MAX_SEARCH_PAGE = 500;

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

function formatPeople(people: PersonSearchResult[]) {
  return people
    .filter((p) => Boolean(p.name))
    .map((p) => ({
      // Use imdbId as id when available; fall back to name (React key only)
      id: p.imdbId ?? p.name,
      imdb_id: p.imdbId ?? null,
      name: p.name,
      profile_path: p.profilePath ?? null,
      known_for_department: p.knownForDepartment ?? null,
      known_for: (p.knownFor ?? []).map((kf) => ({
        title: kf.title,
        media_type: kf.mediaType,
        year: kf.year ?? null,
        poster_path: kf.posterPath ?? null,
      })),
      // Only linkable when we have an id the person page can use
      href: p.imdbId ? `/person/${p.imdbId}` : null,
    }))
    .filter((p) => Boolean(p.href)); // drop people we can't navigate to
}

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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q")?.trim();
  const mediaType = parseMediaType(searchParams.get("type"));
  const page = parsePage(searchParams.get("page"));
  const genre = parseGenre(searchParams.get("genre"));
  const debugSource = searchParams.get("debugSource") === "1";

  if (!query) {
    return NextResponse.json(
      { ok: false, error: "Missing search query. Use ?q=" },
      { status: 400 }
    );
  }

  try {
    // ── Balloonerismm primary path ─────────────────────────────────────────────
    if (isBalloonerismSearchEnabled() && page === 1) {
      try {
        // Three independent searches run in parallel; each fails safely.
        const [catalogResults, peopleResults, companyResults] = await Promise.all([
          catalogSearch({ query, mediaType: toCatalogMediaType(mediaType), page: 1 }).catch(() => []),
          catalogSearchPeople(query).catch(() => [] as PersonSearchResult[]),
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
          ? await findCachedFuzzyTitles({ query, mediaType, excludeKeys: seenKeys }).catch(() => [])
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

        const people = formatPeople(peopleResults);
        const companies = formatCompanies(companyResults);

        const hasResults = titleResults.length > 0 || people.length > 0 || companies.length > 0;

        if (hasResults) {
          console.log(
            `[poplog3/search] source=balloonerismm titles=${titleResults.length} people=${people.length} companies=${companies.length} fuzzy=${fuzzyTitles.length}`
          );

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
            titles: titleResults,
            people,
            companies,
            // Legacy compat alias
            results: titleResults,
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
    const fuzzyTitles = await findCachedFuzzyTitles({ query, mediaType, genre }).catch(() => []);
    const results = fuzzyTitles.map((title) => ({
      ...title,
      ...resolveCatalogIdentityFields(
        { ...title, externalIds: { tmdbId: title.tmdb_id } },
        "legacy"
      ),
    }));

    return NextResponse.json({
      ok: true,
      query,
      normalizedQuery: normalizeSearchTerm(query),
      type: mediaType,
      genre,
      page,
      totalPages: 1,
      totalResults: results.length,
      count: results.length,
      fuzzyCount: fuzzyTitles.length,
      peopleCount: 0,
      companiesCount: 0,
      titles: results,
      people: [],
      companies: [],
      results,
    });
  } catch (error) {
    console.error("[poplog3/search]", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to search titles",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
